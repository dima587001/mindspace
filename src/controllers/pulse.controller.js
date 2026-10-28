// src/controllers/pulse.controller.js
const db = require('../config/db');

/**
 * POST /api/pulse/:id
 * Принимает energy_level (1, 2 или 3) и обновляет dynamic_state пользователя.
 */
exports.updatePulse = async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    const { energy_level } = req.body;

    if (isNaN(userId)) {
      return res.status(400).json({ error: 'Некорректный ID пользователя' });
    }

    const parsedEnergy = parseInt(energy_level, 10);
    if (![1, 2, 3].includes(parsedEnergy)) {
      return res.status(422).json({
        error: 'Поле energy_level должно быть целым числом: 1 (истощен), 2 (в норме) или 3 (полон сил)',
      });
    }

    // Проверяем существование пользователя в БД
    const userCheck = await db.query('SELECT id FROM users WHERE id = $1', [userId]);
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    // Обновляем или создаем запись в dynamic_state
    const upsertQuery = `
      INSERT INTO dynamic_state (user_id, energy_level, last_pulse_check)
      VALUES ($1, $2, CURRENT_TIMESTAMP)
      ON CONFLICT (user_id) 
      DO UPDATE SET 
        energy_level = EXCLUDED.energy_level,
        last_pulse_check = CURRENT_TIMESTAMP
      RETURNING user_id, energy_level, last_pulse_check;
    `;

    const result = await db.query(upsertQuery, [userId, parsedEnergy]);

    return res.status(200).json({
      status: 'success',
      data: result.rows[0],
    });
  } catch (error) {
    console.error('Ошибка в updatePulse:', error);
    return res.status(500).json({ error: 'Внутренняя ошибка сервера при обновлении Pulse' });
  }
};
