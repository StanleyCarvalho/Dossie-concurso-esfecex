const db=require('../db/db');

async function getStudyMomentum(userId){
  const row=await db.one(`WITH daily AS (
    SELECT study_date,COUNT(*)::int planned,COUNT(*) FILTER(WHERE completed)::int done
    FROM study_checklist_entries WHERE user_id=$1 GROUP BY study_date
  ), current_week AS (
    SELECT COALESCE(SUM(planned),0)::int planned,COALESCE(SUM(done),0)::int done FROM daily
    WHERE study_date>=date_trunc('week',CURRENT_DATE)::date AND study_date<date_trunc('week',CURRENT_DATE)::date+7
  ), previous_week AS (
    SELECT COALESCE(SUM(planned),0)::int planned,COALESCE(SUM(done),0)::int done FROM daily
    WHERE study_date>=date_trunc('week',CURRENT_DATE)::date-7 AND study_date<date_trunc('week',CURRENT_DATE)::date
  ), overdue AS (
    SELECT COUNT(*)::int count FROM study_checklist_entries WHERE user_id=$1 AND study_date<CURRENT_DATE AND completed=false
  ) SELECT cw.planned current_planned,cw.done current_done,pw.planned previous_planned,pw.done previous_done,o.count overdue FROM current_week cw,previous_week pw,overdue o`,[userId]);
  const currentRate=row.current_planned?Math.round(row.current_done/row.current_planned*100):0;
  const previousRate=row.previous_planned?Math.round(row.previous_done/row.previous_planned*100):0;
  const days=await db.query(`SELECT study_date::text date,COUNT(*) FILTER(WHERE completed)::int done FROM study_checklist_entries WHERE user_id=$1 GROUP BY study_date ORDER BY study_date DESC LIMIT 60`,[userId]);
  const completedDays=new Set(days.filter(d=>d.done>0).map(d=>d.date));
  let streak=0;const cursor=new Date(new Date().toLocaleString('en-US',{timeZone:'America/Sao_Paulo'}));cursor.setHours(12,0,0,0);
  for(let i=0;i<60;i++){const iso=cursor.toISOString().slice(0,10);if(completedDays.has(iso))streak++;else if(i===0){}else break;cursor.setDate(cursor.getDate()-1);}
  return {...row,currentRate,previousRate,delta:currentRate-previousRate,streak};
}

async function getOverdueTasks(userId,limit=12){
  return db.query(`SELECT id,study_date::text study_date,discipline,topic,microtopic,task_type,planned_minutes,resource_title,resource_url FROM study_checklist_entries WHERE user_id=$1 AND study_date<CURRENT_DATE AND completed=false ORDER BY study_date ASC,id ASC LIMIT $2`,[userId,limit]);
}

module.exports={getStudyMomentum,getOverdueTasks};
