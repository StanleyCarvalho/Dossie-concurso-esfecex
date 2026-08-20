const db=require('../db/db');

async function ensureTables(){
  await db.query(`CREATE TABLE IF NOT EXISTS weekly_plan_snapshots(
    id BIGSERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    week_start DATE NOT NULL,
    week_end DATE NOT NULL,
    schedule_json JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    generated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMPTZ,
    UNIQUE(user_id,week_start)
  )`);
  await db.query(`CREATE TABLE IF NOT EXISTS study_day_completions(
    id BIGSERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    study_date DATE NOT NULL,
    completed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    checklist_total INTEGER NOT NULL DEFAULT 0,
    checklist_done INTEGER NOT NULL DEFAULT 0,
    accuracy_snapshot NUMERIC(6,2),
    UNIQUE(user_id,study_date)
  )`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_weekly_plan_user_week ON weekly_plan_snapshots(user_id,week_start)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_study_day_completion_user_date ON study_day_completions(user_id,study_date)`);
}

async function getSnapshot(userId,weekStart){
  await ensureTables();
  const row=await db.one('SELECT * FROM weekly_plan_snapshots WHERE user_id=$1 AND week_start=$2::date',[userId,weekStart]);
  if(!row)return null;
  return {...row,schedule:typeof row.schedule_json==='string'?JSON.parse(row.schedule_json):row.schedule_json};
}

async function saveSnapshot(userId,weekStart,weekEnd,schedule,{replace=false,status='active'}={}){
  await ensureTables();
  if(replace){
    return db.one(`INSERT INTO weekly_plan_snapshots(user_id,week_start,week_end,schedule_json,status,generated_at)
      VALUES($1,$2::date,$3::date,$4::jsonb,$5,CURRENT_TIMESTAMP)
      ON CONFLICT(user_id,week_start) DO UPDATE SET week_end=EXCLUDED.week_end,schedule_json=EXCLUDED.schedule_json,status=EXCLUDED.status,generated_at=CURRENT_TIMESTAMP,completed_at=NULL
      RETURNING *`,[userId,weekStart,weekEnd,JSON.stringify(schedule),status]);
  }
  await db.query(`INSERT INTO weekly_plan_snapshots(user_id,week_start,week_end,schedule_json,status)
    VALUES($1,$2::date,$3::date,$4::jsonb,$5) ON CONFLICT(user_id,week_start) DO NOTHING`,[userId,weekStart,weekEnd,JSON.stringify(schedule),status]);
  return getSnapshot(userId,weekStart);
}

async function markWeekCompleted(userId,weekStart){
  await ensureTables();
  return db.one(`UPDATE weekly_plan_snapshots SET status='completed',completed_at=CURRENT_TIMESTAMP WHERE user_id=$1 AND week_start=$2::date RETURNING *`,[userId,weekStart]);
}

async function getDayCompletion(userId,studyDate){
  await ensureTables();
  return db.one('SELECT * FROM study_day_completions WHERE user_id=$1 AND study_date=$2::date',[userId,studyDate]);
}

async function completeStudyDay(userId,studyDate){
  await ensureTables();
  const stats=await db.one(`SELECT COUNT(*)::int total,COUNT(*) FILTER(WHERE completed)::int done FROM study_checklist_entries WHERE user_id=$1 AND study_date=$2::date`,[userId,studyDate])||{total:0,done:0};
  await db.query(`UPDATE study_checklist_entries SET completed=TRUE,completed_at=COALESCE(completed_at,CURRENT_TIMESTAMP) WHERE user_id=$1 AND study_date=$2::date`,[userId,studyDate]);
  const attempts=await db.one(`SELECT COUNT(*)::numeric total,COUNT(*) FILTER(WHERE qa.correct)::numeric correct FROM question_attempts qa WHERE qa.user_id=$1 AND qa.answered_at::date=$2::date`,[userId,studyDate])||{total:0,correct:0};
  const accuracy=Number(attempts.total)>0?Math.round((Number(attempts.correct)/Number(attempts.total))*10000)/100:null;
  return db.one(`INSERT INTO study_day_completions(user_id,study_date,checklist_total,checklist_done,accuracy_snapshot)
    VALUES($1,$2::date,$3,$3,$4)
    ON CONFLICT(user_id,study_date) DO UPDATE SET completed_at=CURRENT_TIMESTAMP,checklist_total=EXCLUDED.checklist_total,checklist_done=EXCLUDED.checklist_done,accuracy_snapshot=EXCLUDED.accuracy_snapshot
    RETURNING *`,[userId,studyDate,stats.total,accuracy]);
}

module.exports={ensureTables,getSnapshot,saveSnapshot,markWeekCompleted,getDayCompletion,completeStudyDay};
