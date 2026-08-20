CREATE TABLE IF NOT EXISTS question_ai_analysis (
  question_id INTEGER PRIMARY KEY REFERENCES questions(id) ON DELETE CASCADE,
  difficulty TEXT NOT NULL,
  estimated_minutes NUMERIC(6,2) NOT NULL,
  cognitive_level TEXT,
  style_signature TEXT,
  reasoning TEXT,
  confidence NUMERIC(6,2) NOT NULL DEFAULT 0,
  analyzed_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS prediction_runs (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  target_year INTEGER NOT NULL,
  evidence_hash TEXT NOT NULL,
  model_name TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS predicted_question_blueprints (
  id BIGSERIAL PRIMARY KEY,
  run_id BIGINT NOT NULL REFERENCES prediction_runs(id) ON DELETE CASCADE,
  rank INTEGER NOT NULL,
  discipline TEXT NOT NULL,
  topic TEXT NOT NULL,
  difficulty TEXT NOT NULL,
  estimated_minutes NUMERIC(6,2),
  confidence NUMERIC(6,2) NOT NULL,
  likely_charge TEXT NOT NULL,
  likely_format TEXT NOT NULL,
  likely_trap TEXT,
  possible_question TEXT,
  answer_focus TEXT,
  evidence_years JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence_question_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  UNIQUE(run_id, rank)
);
CREATE INDEX IF NOT EXISTS idx_question_ai_analysis_difficulty ON question_ai_analysis(difficulty);
CREATE INDEX IF NOT EXISTS idx_prediction_runs_user_year ON prediction_runs(user_id,target_year,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_predicted_blueprints_run_rank ON predicted_question_blueprints(run_id,rank);
