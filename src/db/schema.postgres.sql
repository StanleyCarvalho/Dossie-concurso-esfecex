CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS exams (
  id BIGSERIAL PRIMARY KEY,
  banca TEXT NOT NULL DEFAULT 'VUNESP',
  orgao TEXT NOT NULL DEFAULT 'ESFCEx',
  cargo TEXT NOT NULL DEFAULT 'Informática',
  ano INTEGER NOT NULL,
  data_aplicacao TEXT,
  num_questoes INTEGER,
  fonte TEXT,
  status TEXT DEFAULT 'seed',
  user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS discipline_stats (
  id BIGSERIAL PRIMARY KEY,
  exam_id BIGINT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  discipline TEXT NOT NULL,
  num_questions INTEGER NOT NULL,
  topics JSONB NOT NULL DEFAULT '[]'::jsonb,
  UNIQUE(exam_id, discipline)
);

CREATE TABLE IF NOT EXISTS questions (
  id BIGSERIAL PRIMARY KEY,
  exam_id BIGINT REFERENCES exams(id) ON DELETE CASCADE,
  number INTEGER,
  discipline TEXT NOT NULL,
  topic TEXT,
  statement TEXT NOT NULL,
  alt_a TEXT, alt_b TEXT, alt_c TEXT, alt_d TEXT, alt_e TEXT,
  correct_letter TEXT,
  explanation TEXT,
  style_notes TEXT,
  source TEXT DEFAULT 'import',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS simulados (
  id BIGSERIAL PRIMARY KEY,
  title TEXT,
  blueprint_json JSONB,
  total_questions INTEGER,
  duration_minutes INTEGER,
  score DOUBLE PRECISION,
  user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS simulado_questions (
  id BIGSERIAL PRIMARY KEY,
  simulado_id BIGINT NOT NULL REFERENCES simulados(id) ON DELETE CASCADE,
  question_id BIGINT REFERENCES questions(id) ON DELETE SET NULL,
  order_index INTEGER,
  chosen_letter TEXT,
  correct INTEGER,
  answered_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS study_plan (
  id BIGSERIAL PRIMARY KEY,
  discipline TEXT NOT NULL,
  topic TEXT NOT NULL,
  priority_score DOUBLE PRECISION,
  rationale TEXT,
  status TEXT DEFAULT 'pendente',
  study_notes TEXT,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  user_id BIGINT REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS pattern_reports (
  id BIGSERIAL PRIMARY KEY,
  content_md TEXT NOT NULL,
  weights_json JSONB,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  user_id BIGINT REFERENCES users(id) ON DELETE CASCADE
);

ALTER TABLE study_plan ADD COLUMN IF NOT EXISTS user_id BIGINT REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE pattern_reports ADD COLUMN IF NOT EXISTS user_id BIGINT REFERENCES users(id) ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS study_plan_preferences (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  days JSONB NOT NULL DEFAULT '["mon", "wed", "fri"]'::jsonb,
  hours_per_day DOUBLE PRECISION NOT NULL DEFAULT 2,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS study_progress (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  discipline TEXT NOT NULL,
  topic TEXT NOT NULL,
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  notes TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, discipline, topic)
);

CREATE INDEX IF NOT EXISTS idx_questions_discipline ON questions(discipline);
CREATE INDEX IF NOT EXISTS idx_questions_exam ON questions(exam_id);
CREATE INDEX IF NOT EXISTS idx_discipline_stats_exam ON discipline_stats(exam_id);
CREATE INDEX IF NOT EXISTS idx_simulados_user_started ON simulados(user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_study_progress_user ON study_progress(user_id);
CREATE INDEX IF NOT EXISTS idx_study_plan_user_priority ON study_plan(user_id, priority_score DESC);
CREATE INDEX IF NOT EXISTS idx_pattern_reports_user_generated ON pattern_reports(user_id, generated_at DESC);
