// src/controllers/task.controller.js
const db = require('../config/db');
const { calculate_compatibility } = require('../services/compatibility.service');

/**
 * POST /api/tasks/assign
 * Принимает task_id и user_id (опционально assigner_id), проверяет совместимость и назначает задачу.
 */
exports.assignTask = async (req, res) => {
  try {
    const { task_id, user_id, assigner_id } = req.body;

    if (!task_id || !user_id) {
      return res.status(400).json({
        status: 'warning',
        message: 'Необходимо передать оба параметра: task_id и user_id',
      });
    }

    // 1. Получаем данные задачи
    const taskResult = await db.query('SELECT * FROM tasks WHERE id = $1', [task_id]);
    if (taskResult.rows.length === 0) {
      return res.status(404).json({
        status: 'warning',
        message: 'Задача не найдена',
      });
    }
    const task = taskResult.rows[0];

    // 2. Определяем ID постановщика задачи (если не указан — ищем пользователя с ролью owner)
    let effectiveAssignerId = assigner_id ? parseInt(assigner_id, 10) : null;
    if (!effectiveAssignerId) {
      const ownerResult = await db.query(
        "SELECT id FROM users WHERE role = 'owner' ORDER BY id ASC LIMIT 1"
      );
      effectiveAssignerId =
        ownerResult.rows.length > 0 ? ownerResult.rows[0].id : parseInt(user_id, 10);
    }

    // 3. Запускаем расчет когнитивной совместимости
    const compatibility = await calculate_compatibility(
      effectiveAssignerId,
      parseInt(user_id, 10),
      task
    );

    // 4. Если сработала блокировка по истощению на сложной задаче (complexity_level 3)
    if (!compatibility.allowed && compatibility.flag === 'Low_Energy_Protection') {
      return res.status(200).json({
        status: 'blocked_by_energy',
        flag: compatibility.flag,
        suggested_complexity_level: compatibility.suggested_complexity_level,
        message: compatibility.message,
      });
    }

    // 5. Сохраняем назначение задачи в БД
    await db.query('UPDATE tasks SET assigned_to = $1 WHERE id = $2', [user_id, task_id]);

    // 6. Предупреждение при низком CI (< 30) или при назначении задачи средней сложности истощенному сотруднику
    if (compatibility.flag === 'Low_Energy_Protection' || compatibility.ci < 30) {
      const warningMessage =
        compatibility.flag === 'Low_Energy_Protection'
          ? `Задача назначена с флагом Low_Energy_Protection (CI: ${compatibility.ci}). Сотрудник истощен — рекомендуется переключить его на рутинные задачи (complexity_level 1).`
          : `Задача назначена, но зафиксирован низкий индекс совместимости (CI: ${compatibility.ci}). Возможны трудности в коммуникации или повышенный стресс.`;

      return res.status(200).json({
        status: 'warning',
        flag: compatibility.flag,
        ci: compatibility.ci,
        message: warningMessage,
      });
    }

    // 7. Успешное назначение
    return res.status(200).json({
      status: 'success',
      flag: compatibility.flag,
      ci: compatibility.ci,
      message: `Задача успешно назначена. Индекс когнитивной совместимости CI: ${compatibility.ci}.`,
    });
  } catch (error) {
    if (error.code === 'CONSENT_REQUIRED') {
      return res.status(403).json({
        status: 'consent_required',
        flag: 'ConsentRequired',
        userIds: error.userIds || [],
        message: error.message,
      });
    }

    if (error.code === 'PROFILE_NOT_FOUND') {
      return res.status(422).json({
        status: 'profile_not_found',
        message: error.message,
      });
    }

    console.error('Ошибка в assignTask:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Внутренняя ошибка сервера при назначении задачи',
    });
  }
};
