const db=require('../db/db');let ready;
async function setup(){
  await db.query(`CREATE TABLE IF NOT EXISTS study_checklist_entries(id BIGSERIAL PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,study_date DATE NOT NULL,discipline TEXT NOT NULL,topic TEXT NOT NULL,microtopic TEXT NOT NULL,task_type TEXT NOT NULL,planned_minutes INTEGER NOT NULL DEFAULT 10,completed BOOLEAN NOT NULL DEFAULT FALSE,completed_at TIMESTAMPTZ,resource_title TEXT,resource_url TEXT,notes TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(user_id,study_date,discipline,topic,microtopic,task_type))`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_study_checklist_user_date ON study_checklist_entries(user_id,study_date)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_study_checklist_topic ON study_checklist_entries(user_id,discipline,topic)`);
  await db.query(`CREATE TABLE IF NOT EXISTS study_week_plans(id BIGSERIAL PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,week_start DATE NOT NULL,week_end DATE NOT NULL,status TEXT NOT NULL DEFAULT 'active',schedule_json JSONB NOT NULL,config_json JSONB NOT NULL DEFAULT '{}'::jsonb,metrics_json JSONB NOT NULL DEFAULT '{}'::jsonb,generated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,completed_at TIMESTAMPTZ,UNIQUE(user_id,week_start))`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_study_week_plans_user_week ON study_week_plans(user_id,week_start DESC)`);
}
function ensureChecklistReady(){if(!ready)ready=setup().catch(e=>{ready=null;throw e});return ready}
module.exports={ensureChecklistReady};