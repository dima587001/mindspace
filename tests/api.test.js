/**
 * Интеграционные тесты Synapse Net Backend.
 * PostgreSQL в среде недоступен, поэтому слой БД (src/config/db) мок-ается через jest.mock.
 * Проверяются: валидация pulse, этика согласий, Low_Energy_Protection и формула CI.
 */

// Мокаем модуль доступа к БД ДО подключения контроллеров
jest.mock('../src/config/db', () => {
  const state = {
    users: {}, // id -> { id, role, active_context }
    profiles: {}, // id -> socionics_type
    dynamic: {}, // id -> energy_level
    consents: {}, // id -> true/false (is_granted для cognitive_profile_processing)
    relations: [], // [{type_a,type_b,base_score}]
    tasks: {}, // id -> task row
    pulseUpserts: [],
    assignUpdates: [],
  };

  const query = async (text, params = []) => {
    const sql = text.replace(/\s+/g, ' ').trim();

    // SELECT id FROM users WHERE id = $1
    if (/^SELECT id FROM users WHERE id/i.test(sql)) {
      const id = params[0];
      return { rows: state.users[id] ? [{ id }] : [] };
    }

    // UPSERT dynamic_state
    if (/INSERT INTO dynamic_state/i.test(sql)) {
      const [userId, energy] = params;
      state.dynamic[userId] = energy;
      state.pulseUpserts.push(params);
      return {
        rows: [{ user_id: userId, energy_level: energy, last_pulse_check: new Date() }],
      };
    }

    // Проверка согласий
    if (/FROM consents/i.test(sql)) {
      const ids = params;
      return {
        rows: ids.filter((id) => state.consents[id]).map((id) => ({ user_id: id })),
      };
    }

    // Запрос профилей пользователей
    if (/FROM users u JOIN cognitive_profiles cp/i.test(sql)) {
      const ids = params;
      const rows = ids
        .filter((id) => state.users[id] && state.profiles[id])
        .map((id) => ({
          id,
          active_context: state.users[id].active_context,
          socionics_type: state.profiles[id],
          energy_level: state.dynamic[id] !== undefined ? state.dynamic[id] : 2,
        }));
      return { rows };
    }

    // Справочник интертипных отношений
    if (/FROM intertype_relations/i.test(sql)) {
      const [a, b] = params;
      const rel = state.relations.find(
        (r) => (r.type_a === a && r.type_b === b) || (r.type_a === b && r.type_b === a)
      );
      return { rows: rel ? [{ base_score: rel.base_score }] : [] };
    }

    // SELECT * FROM tasks WHERE id = $1
    if (/SELECT \* FROM tasks WHERE id/i.test(sql)) {
      const task = state.tasks[params[0]];
      return { rows: task ? [task] : [] };
    }

    // Поиск owner
    if (/role = 'owner'/i.test(sql)) {
      const owners = Object.values(state.users)
        .filter((u) => u.role === 'owner')
        .sort((x, y) => x.id - y.id);
      return { rows: owners.length ? [{ id: owners[0].id }] : [] };
    }

    // UPDATE tasks SET assigned_to
    if (/UPDATE tasks SET assigned_to/i.test(sql)) {
      state.assignUpdates.push(params);
      return { rows: [] };
    }

    throw new Error('Unexpected SQL in mock: ' + sql);
  };

  return {
    query,
    pool: { end: async () => {} },
    __state: state,
    __reset: () => {
      state.users = {};
      state.profiles = {};
      state.dynamic = {};
      state.consents = {};
      state.relations = [];
      state.tasks = {};
      state.pulseUpserts = [];
      state.assignUpdates = [];
    },
  };
});

process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../src/app');
const dbMock = require('../src/config/db');
const { calculate_compatibility } = require('../src/services/compatibility.service');

beforeEach(() => {
  dbMock.__reset();
});

// ==================== PULSE ====================
describe('POST /api/pulse/:id', () => {
  it('валидирует некорректный ID (400)', async () => {
    const res = await request(app).post('/api/pulse/abc').send({ energy_level: 2 });
    expect(res.status).toBe(400);
  });

  it('валидирует недопустимый energy_level (422)', async () => {
    const res = await request(app).post('/api/pulse/1').send({ energy_level: 5 });
    expect(res.status).toBe(422);
    expect(res.body.error).toBeDefined();
  });

  it('возвращает 404 для несуществующего пользователя', async () => {
    const res = await request(app).post('/api/pulse/99').send({ energy_level: 2 });
    expect(res.status).toBe(404);
  });

  it('UPSERT обновляет dynamic_state для существующего пользователя (200)', async () => {
    dbMock.__state.users[7] = { id: 7, role: 'employee', active_context: 'Business' };
    const res = await request(app).post('/api/pulse/7').send({ energy_level: 3 });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.data.energy_level).toBe(3);
    expect(dbMock.__state.dynamic[7]).toBe(3);
  });
});

// ==================== CONSENTS (Этика) ====================
describe('calculate_compatibility — проверка согласий', () => {
  it('блокирует доступ к профилям без согласия (CONSENT_REQUIRED)', async () => {
    dbMock.__state.users[1] = { id: 1, role: 'owner', active_context: 'Business' };
    dbMock.__state.users[2] = { id: 2, role: 'employee', active_context: 'Business' };
    dbMock.__state.profiles[1] = 'ILE';
    dbMock.__state.profiles[2] = 'SEI';

    let err;
    try {
      await calculate_compatibility(1, 2, { complexity_level: 2 });
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    expect(err.code).toBe('CONSENT_REQUIRED');
    expect(err.userIds.slice().sort()).toEqual([1, 2]);
  });

  it('эндпоинт assign возвращает 403 при отсутствии согласия', async () => {
    dbMock.__state.tasks[1] = { id: 1, title: 'T', complexity_level: 2 };
    dbMock.__state.users[1] = { id: 1, role: 'owner', active_context: 'Business' };
    dbMock.__state.users[2] = { id: 2, role: 'employee', active_context: 'Business' };

    const res = await request(app)
      .post('/api/tasks/assign')
      .send({ task_id: 1, user_id: 2, assigner_id: 1 });
    expect(res.status).toBe(403);
    expect(res.body.status).toBe('consent_required');
  });
});

// ==================== Формула CI ====================
describe('calculate_compatibility — формула CI', () => {
  beforeEach(() => {
    dbMock.__state.users[1] = { id: 1, role: 'owner', active_context: 'Business' };
    dbMock.__state.users[2] = { id: 2, role: 'employee', active_context: 'Business' };
    dbMock.__state.profiles[1] = 'ILE';
    dbMock.__state.profiles[2] = 'SEI';
    dbMock.__state.consents[1] = true;
    dbMock.__state.consents[2] = true;
    dbMock.__state.relations.push({ type_a: 'ILE', type_b: 'SEI', base_score: 100 });
  });

  it('CI = Base*ContextMod - (StressA+StressB)*10 (оба энергичны, Business)', async () => {
    dbMock.__state.dynamic[1] = 3;
    dbMock.__state.dynamic[2] = 3;
    const result = await calculate_compatibility(1, 2, { complexity_level: 2 });
    // 100*1.1 - (1+1)*10 = 110 - 20 = 90
    expect(result.ci).toBe(90);
    expect(result.flag).toBe('Optimal');
    expect(result.allowed).toBe(true);
  });

  it('штраф за рассинхронизацию контекстов (Context_Mod = 0.85)', async () => {
    dbMock.__state.users[2].active_context = 'Family';
    dbMock.__state.dynamic[1] = 2;
    dbMock.__state.dynamic[2] = 2;
    const result = await calculate_compatibility(1, 2, { complexity_level: 2 });
    // 100*0.85 - (2+2)*10 = 85 - 40 = 45
    expect(result.contextMod).toBe(0.85);
    expect(result.ci).toBe(45);
  });

  it('нейтральный Base_Score=50 при отсутствии отношения в справочнике', async () => {
    dbMock.__state.profiles[2] = 'ESF'; // отношения нет в моке
    dbMock.__state.dynamic[1] = 2;
    dbMock.__state.dynamic[2] = 2;
    const result = await calculate_compatibility(1, 2, { complexity_level: 2 });
    // 50*1.1 - 40 = 15
    expect(result.baseScore).toBe(50);
    expect(result.ci).toBe(15);
  });
});

// ==================== Low_Energy_Protection ====================
describe('Low_Energy_Protection', () => {
  beforeEach(() => {
    dbMock.__state.users[1] = { id: 1, role: 'owner', active_context: 'Business' };
    dbMock.__state.users[2] = { id: 2, role: 'employee', active_context: 'Business' };
    dbMock.__state.profiles[1] = 'ILE';
    dbMock.__state.profiles[2] = 'SEI';
    dbMock.__state.consents[1] = true;
    dbMock.__state.consents[2] = true;
    dbMock.__state.relations.push({ type_a: 'ILE', type_b: 'SEI', base_score: 100 });
    dbMock.__state.dynamic[2] = 1; // исполнитель истощен
    dbMock.__state.dynamic[1] = 2;
  });

  it('блокирует сложную задачу (complexity_level=3) для истощенного сотрудника', async () => {
    const result = await calculate_compatibility(1, 2, { complexity_level: 3 });
    expect(result.flag).toBe('Low_Energy_Protection');
    expect(result.allowed).toBe(false);
    expect(result.ci).toBeNull();
    expect(result.suggested_complexity_level).toBe(1);
  });

  it('эндпоинт возвращает blocked_by_energy и НЕ сохраняет назначение', async () => {
    dbMock.__state.tasks[10] = { id: 10, title: 'Hard task', complexity_level: 3 };
    const res = await request(app)
      .post('/api/tasks/assign')
      .send({ task_id: 10, user_id: 2, assigner_id: 1 });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('blocked_by_energy');
    expect(res.body.suggested_complexity_level).toBe(1);
    expect(dbMock.__state.assignUpdates.length).toBe(0);
  });

  it('назначает рутинную задачу с warning-флагом для истощенного', async () => {
    dbMock.__state.tasks[11] = { id: 11, title: 'Routine', complexity_level: 1 };
    const res = await request(app)
      .post('/api/tasks/assign')
      .send({ task_id: 11, user_id: 2, assigner_id: 1 });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('warning');
    expect(res.body.flag).toBe('Low_Energy_Protection');
    // CI = 100*1.1 - (2+3)*10 = 110 - 50 = 60
    expect(res.body.ci).toBe(60);
    expect(dbMock.__state.assignUpdates.length).toBe(1);
  });
});

// ==================== Assign: успех и ошибки ====================
describe('POST /api/tasks/assign — базовые сценарии', () => {
  it('400 без task_id/user_id', async () => {
    const res = await request(app).post('/api/tasks/assign').send({});
    expect(res.status).toBe(400);
    expect(res.body.status).toBe('warning');
  });

  it('404 если задача не найдена', async () => {
    const res = await request(app)
      .post('/api/tasks/assign')
      .send({ task_id: 999, user_id: 2 });
    expect(res.status).toBe(404);
  });

  it('success для дуалей с высокой энергией (без assigner_id — берется owner)', async () => {
    dbMock.__state.users[1] = { id: 1, role: 'owner', active_context: 'Business' };
    dbMock.__state.users[2] = { id: 2, role: 'employee', active_context: 'Business' };
    dbMock.__state.profiles[1] = 'ILE';
    dbMock.__state.profiles[2] = 'SEI';
    dbMock.__state.consents[1] = true;
    dbMock.__state.consents[2] = true;
    dbMock.__state.relations.push({ type_a: 'ILE', type_b: 'SEI', base_score: 100 });
    dbMock.__state.dynamic[1] = 3;
    dbMock.__state.dynamic[2] = 3;
    dbMock.__state.tasks[5] = { id: 5, title: 'Plan', complexity_level: 2 };

    const res = await request(app)
      .post('/api/tasks/assign')
      .send({ task_id: 5, user_id: 2 });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.ci).toBe(90);
    expect(dbMock.__state.assignUpdates[0]).toEqual([2, 5]);
  });

  it('422 PROFILE_NOT_FOUND, если профиль отсутствует', async () => {
    dbMock.__state.users[1] = { id: 1, role: 'owner', active_context: 'Business' };
    dbMock.__state.users[2] = { id: 2, role: 'employee', active_context: 'Business' };
    dbMock.__state.consents[1] = true;
    dbMock.__state.consents[2] = true;
    // profiles не заданы
    dbMock.__state.tasks[6] = { id: 6, title: 'X', complexity_level: 2 };

    const res = await request(app)
      .post('/api/tasks/assign')
      .send({ task_id: 6, user_id: 2, assigner_id: 1 });
    expect(res.status).toBe(422);
    expect(res.body.status).toBe('profile_not_found');
  });
});
