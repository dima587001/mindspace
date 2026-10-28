-- migration_001_initial_schema.sql

-- 1. Пользовательские типы и перечисления
CREATE TYPE user_role AS ENUM ('owner', 'employee');
CREATE TYPE user_context AS ENUM ('Business', 'Family');

-- 2. Таблица пользователей
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    role user_role NOT NULL DEFAULT 'employee',
    active_context user_context NOT NULL DEFAULT 'Business',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Согласия на обработку психопрофиля (Безопасность и Этика)
CREATE TABLE consents (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    consent_type VARCHAR(64) NOT NULL DEFAULT 'cognitive_profile_processing',
    is_granted BOOLEAN NOT NULL DEFAULT FALSE,
    granted_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_user_consent UNIQUE (user_id, consent_type)
);

-- 4. Когнитивные профили
CREATE TABLE cognitive_profiles (
    user_id INT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    socionics_type VARCHAR(32) NOT NULL,
    mbti_type VARCHAR(16),
    function_weights JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 5. Динамическое состояние (Pulse)
CREATE TABLE dynamic_state (
    user_id INT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    energy_level INT NOT NULL CHECK (energy_level BETWEEN 1 AND 3), -- 1: истощен, 2: норма, 3: полон сил
    last_pulse_check TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 6. Задачи
CREATE TABLE tasks (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    assigned_to INT REFERENCES users(id) ON DELETE SET NULL,
    required_functions JSONB NOT NULL DEFAULT '[]'::jsonb,
    complexity_level INT NOT NULL CHECK (complexity_level BETWEEN 1 AND 3), -- 1: рутина, 2: стандарт, 3: сложная
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 7. Справочник интертипных отношений (Base_Score)
CREATE TABLE intertype_relations (
    type_a VARCHAR(32) NOT NULL,
    type_b VARCHAR(32) NOT NULL,
    relation_name VARCHAR(64) NOT NULL,
    base_score INT NOT NULL,
    PRIMARY KEY (type_a, type_b)
);

-- Индексы для оптимизации выборок
CREATE INDEX idx_users_active_context ON users(active_context);
CREATE INDEX idx_tasks_assigned_to ON tasks(assigned_to);
CREATE INDEX idx_consents_user_lookup ON consents(user_id, is_granted);

-- Наполнение справочника интертипных отношений базовыми значениями
INSERT INTO intertype_relations (type_a, type_b, relation_name, base_score) VALUES
    ('ILE', 'SEI', 'Duality', 100),      -- Дуальность = 100
    ('SEI', 'ILE', 'Duality', 100),
    ('ILE', 'EII', 'Super-Ego', 40),
    ('EII', 'ILE', 'Super-Ego', 40),
    ('ILE', 'ESI', 'Conflict', 10),
    ('ESI', 'ILE', 'Conflict', 10),
    ('ILE', 'LSI', 'Supervision', 20),   -- Ревизия = 20
    ('LSI', 'ILE', 'Supervision', 20)
ON CONFLICT DO NOTHING;
