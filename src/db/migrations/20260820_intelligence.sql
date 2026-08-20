CREATE TABLE IF NOT EXISTS editais (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  ano INTEGER NOT NULL,
  banca TEXT NOT NULL DEFAULT 'VUNESP',
  cargo TEXT NOT NULL DEFAULT 'Informática',
  filename TEXT,
  raw_text TEXT,
  status TEXT NOT NULL DEFAULT 'processado',
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS edital_topics (
  id BIGSERIAL PRIMARY KEY,
  edital_id BIGINT NOT NULL REFERENCES editais(id) ON DELETE CASCADE,
  discipline TEXT NOT NULL,
  topic TEXT NOT NULL,
  subtopic TEXT,
  reference_text TEXT,
  weight NUMERIC(6,2) DEFAULT 1,
  UNIQUE(edital_id, discipline, topic, subtopic)
);

CREATE TABLE IF NOT EXISTS question_similarity (
  id BIGSERIAL PRIMARY KEY,
  question_a_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  question_b_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  similarity NUMERIC(6,4) NOT NULL,
  relation_type TEXT NOT NULL,
  calculated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(question_a_id, question_b_id)
);

CREATE TABLE IF NOT EXISTS question_attempts (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  chosen_letter TEXT,
  correct BOOLEAN,
  source TEXT NOT NULL DEFAULT 'treino',
  answered_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS topic_mastery (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  discipline TEXT NOT NULL,
  topic TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  correct_answers INTEGER NOT NULL DEFAULT 0,
  mastery_score NUMERIC(6,2) NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  UNIQUE(user_id, discipline, topic)
);

CREATE INDEX IF NOT EXISTS idx_edital_topics_lookup ON edital_topics(discipline, topic);
CREATE INDEX IF NOT EXISTS idx_question_similarity_score ON question_similarity(similarity DESC);
CREATE INDEX IF NOT EXISTS idx_question_attempts_user ON question_attempts(user_id, answered_at DESC);
CREATE INDEX IF NOT EXISTS idx_topic_mastery_user ON topic_mastery(user_id, mastery_score);
