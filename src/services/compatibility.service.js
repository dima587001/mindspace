// src/services/compatibility.service.js
const db = require('../config/db');

/**
 * Расчет когнитивной совместимости двух пользователей в контексте задачи.
 *
 * @param {number} userAId - ID первого пользователя (постановщика/тимлида)
 * @param {number} userBId - ID второго пользователя (исполнителя)
 * @param {object} task - Объект задачи { id, title, complexity_level, required_functions }
 */
async function calculate_compatibility(userAId, userBId, task) {
  // 1. БЕЗОПАСНОСТЬ И ЭТИКА: Проверка согласия ДО обращения к таблице cognitive_profiles
  const consentCheckQuery = `
    SELECT user_id 
    FROM consents 
    WHERE user_id IN ($1, $2) 
      AND consent_type = 'cognitive_profile_processing' 
      AND is_granted = TRUE;
  `;
  const consentResult = await db.query(consentCheckQuery, [userAId, userBId]);
  const consentedUsers = new Set(consentResult.rows.map((row) => row.user_id));

  const missingConsents = [];
  if (!consentedUsers.has(userAId)) missingConsents.push(userAId);
  if (!consentedUsers.has(userBId)) missingConsents.push(userBId);

  if (missingConsents.length > 0) {
    const error = new Error(
      `Доступ к соционическому типу запрещен: отсутствует согласие (consents) у пользователей с ID: ${missingConsents.join(', ')}`
    );
    error.code = 'CONSENT_REQUIRED';
    error.userIds = missingConsents;
    throw error;
  }

  // 2. Запрос психопрофилей и динамического состояния (только после подтверждения согласия)
  const userProfileQuery = `
    SELECT 
      u.id, 
      u.active_context,
      cp.socionics_type,
      COALESCE(ds.energy_level, 2) AS energy_level
    FROM users u
    JOIN cognitive_profiles cp ON cp.user_id = u.id
    LEFT JOIN dynamic_state ds ON ds.user_id = u.id
    WHERE u.id IN ($1, $2);
  `;
  const profilesResult = await db.query(userProfileQuery, [userAId, userBId]);

  const profileA = profilesResult.rows.find((r) => r.id === userAId);
  const profileB = profilesResult.rows.find((r) => r.id === userBId);

  if (!profileA || !profileB) {
    const error = new Error('Когнитивный профиль одного или обоих пользователей не найден');
    error.code = 'PROFILE_NOT_FOUND';
    throw error;
  }

  // 3. Механизм защиты от выгорания (Low_Energy_Protection)
  if (profileB.energy_level === 1) {
    if (task.complexity_level === 3) {
      return {
        flag: 'Low_Energy_Protection',
        allowed: false,
        ci: null,
        suggested_complexity_level: 1,
        message:
          'Сработала защита Low_Energy_Protection: сотрудник истощен (energy_level = 1). Назначение сложных задач (complexity_level 3) заблокировано. Предложите рутинную задачу (complexity_level 1).',
      };
    }
  }

  // 4. Определение Base_Score из справочника интертипных отношений
  const relationQuery = `
    SELECT base_score 
    FROM intertype_relations 
    WHERE (type_a = $1 AND type_b = $2) OR (type_a = $2 AND type_b = $1)
    LIMIT 1;
  `;
  const relationResult = await db.query(relationQuery, [
    profileA.socionics_type,
    profileB.socionics_type,
  ]);

  // Если отношение не задано явно в таблице, используем нейтральный базовый балл 50
  const baseScore = relationResult.rows.length > 0 ? relationResult.rows[0].base_score : 50;

  // 5. Модификатор контекста (Context_Mod)
  let contextMod = 1.0;
  if (profileA.active_context === profileB.active_context) {
    contextMod = profileA.active_context === 'Business' ? 1.1 : 1.05;
  } else {
    contextMod = 0.85; // Штраф за рассинхронизацию контекстов ('Business' vs 'Family')
  }

  // 6. Расчет стресса каждого участника: Stress = 4 - energy_level
  const stressA = 4 - profileA.energy_level;
  const stressB = 4 - profileB.energy_level;

  // 7. Расчет итогового индекса совместимости: CI = (Base_Score * Context_Mod) - (Stress_A + Stress_B) * 10
  const ci = Math.round((baseScore * contextMod) - (stressA + stressB) * 10);

  return {
    flag: profileB.energy_level === 1 ? 'Low_Energy_Protection' : 'Optimal',
    allowed: true,
    ci,
    baseScore,
    contextMod,
    stressA,
    stressB,
    suggested_complexity_level: profileB.energy_level === 1 ? 1 : task.complexity_level,
  };
}

module.exports = { calculate_compatibility };
