# Synapse Net Backend

Когнитивная система распределения задач: соционические профили, pulse-опросы энергии, согласия на обработку психопрофиля и расчет индекса совместимости (CI).

## Структура проекта

```
migrations/
  migration_001_initial_schema.sql   # ENUM'ы, таблицы (users, consents, cognitive_profiles,
                                     # dynamic_state, tasks, intertype_relations), индексы, сид отношений
src/
  app.js                             # Express-приложение (запуск только при NODE_ENV != 'test')
  config/db.js                       # Пул соединений pg (DATABASE_URL)
  controllers/
    pulse.controller.js              # POST /api/pulse/:id — UPSERT dynamic_state
    task.controller.js               # POST /api/tasks/assign — проверка совместимости + назначение
  services/
    compatibility.service.js         # calculate_compatibility(): consents → Low_Energy_Protection → CI
tests/
  api.test.js                        # Jest + supertest (БД мок-ается через jest.mock)
```

## Формула совместимости

```
CI = round(Base_Score * Context_Mod - (Stress_A + Stress_B) * 10)
Stress = 4 - energy_level
Context_Mod: одинаковый Business = 1.1, одинаковый Family = 1.05, рассинхрон = 0.85, иначе 1.0
Base_Score берется из intertype_relations (в обе стороны), нейтральное значение по умолчанию = 50
```

Порядок проверок в `calculate_compatibility`:
1. **Этика**: оба пользователя должны иметь активное согласие `cognitive_profile_processing` в таблице `consents`. Иначе — ошибка `CONSENT_REQUIRED` (HTTP 403), доступ к `cognitive_profiles` не выполняется.
2. **Защита от выгорания**: при `energy_level === 1` у исполнителя задача `complexity_level === 3` блокируется (`blocked_by_energy`, рекомендуется рутина уровня 1).
3. Расчет CI; предупреждение (`warning`) при CI < 30 либо с флагом `Low_Energy_Protection` на задаче уровня 1–2.

## Запуск

```bash
npm install

# 1. Создать БД и применить миграцию (нужен PostgreSQL):
createdb synapse_net
psql postgresql://postgres:postgres@localhost:5432/synapse_net \
  -f migrations/migration_001_initial_schema.sql
# или: DATABASE_URL=... npm run migrate

# 2. Запустить сервер:
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/synapse_net npm start
```

## API

### POST /api/pulse/:id
Тело: `{ "energy_level": 1 | 2 | 3 }`
Ответы: `200 success`, `400` (некорректный id), `422` (некорректный energy_level), `404` (пользователь не найден).

### POST /api/tasks/assign
Тело: `{ "task_id": 5, "user_id": 2, "assigner_id"?: 1 }` (без `assigner_id` берется первый `owner`).
Ответы:
- `200 { status: "success" | "warning" | "blocked_by_energy", flag, ci?, suggested_complexity_level?, message }`
- `400/404` — некорректные входные данные / задача не найдена
- `403 { status: "consent_required", flag: "ConsentRequired", userIds, message }` — отсутствует согласие (конфиденциальность соционических данных)
- `422 { status: "profile_not_found", message }` — когнитивный профиль не найден

## Тесты

```bash
npm test
```

16 тестов покрывают: валидацию pulse, UPSERT dynamic_state, блокировку без согласий (403), формулу CI (дуальность 100×1.1 − стресс), штраф за рассинхрон контекстов, нейтральный Base_Score=50, Low_Energy_Protection (блокировка complexity 3, warning для рутины) и успешное назначение.
