-- ESFCEx Informática Prep - Schema

CREATE TABLE IF NOT EXISTS exams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  banca TEXT NOT NULL DEFAULT 'VUNESP',
  orgao TEXT NOT NULL DEFAULT 'ESFCEx',
  cargo TEXT NOT NULL DEFAULT 'Informática',
  ano INTEGER NOT NULL,
  data_aplicacao TEXT,
  num_questoes INTEGER,
  fonte TEXT,                 -- de onde veio (import manual, upload, etc.)
  status TEXT DEFAULT 'seed', -- seed (só estatística) | completa (questões importadas)
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS discipline_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  discipline TEXT NOT NULL,
  num_questions INTEGER NOT NULL,
  topics TEXT, -- JSON array de assuntos cobrados dentro da disciplina naquele ano
  UNIQUE(exam_id, discipline)
);

CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exam_id INTEGER REFERENCES exams(id) ON DELETE CASCADE,
  number INTEGER,
  discipline TEXT NOT NULL,
  topic TEXT,
  statement TEXT NOT NULL,
  alt_a TEXT, alt_b TEXT, alt_c TEXT, alt_d TEXT, alt_e TEXT,
  correct_letter TEXT,
  explanation TEXT,           -- gerada por IA sob demanda
  style_notes TEXT,           -- observações de estilo da banca para essa questão (para o motor de padrões)
  source TEXT DEFAULT 'import',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS simulados (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT,
  blueprint_json TEXT,        -- distribuição de disciplinas usada para montar o simulado
  total_questions INTEGER,
  duration_minutes INTEGER,
  score REAL,
  started_at TEXT DEFAULT CURRENT_TIMESTAMP,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS simulado_questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  simulado_id INTEGER NOT NULL REFERENCES simulados(id) ON DELETE CASCADE,
  question_id INTEGER REFERENCES questions(id) ON DELETE SET NULL,
  order_index INTEGER,
  chosen_letter TEXT,
  correct INTEGER,            -- 0/1
  answered_at TEXT
);

CREATE TABLE IF NOT EXISTS study_plan (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  discipline TEXT NOT NULL,
  topic TEXT NOT NULL,
  priority_score REAL,        -- 0-100, calculado a partir de peso histórico + desempenho do usuário
  rationale TEXT,              -- por que esse tópico tem essa prioridade
  status TEXT DEFAULT 'pendente', -- pendente | estudando | dominado
  study_notes TEXT,            -- resumo gerado por IA
  generated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pattern_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content_md TEXT NOT NULL,
  weights_json TEXT,           -- pesos previstos por disciplina/assunto pro próximo edital
  generated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS study_progress (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  discipline TEXT NOT NULL,
  topic TEXT NOT NULL,
  progress INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, discipline, topic)
);

CREATE INDEX IF NOT EXISTS idx_questions_discipline ON questions(discipline);
CREATE INDEX IF NOT EXISTS idx_questions_exam ON questions(exam_id);
CREATE INDEX IF NOT EXISTS idx_discipline_stats_exam ON discipline_stats(exam_id);
