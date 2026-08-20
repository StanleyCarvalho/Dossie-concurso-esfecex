const express = require('express');
const router = express.Router();
const db = require('../db/db');
const { generatePatternReport, generateStudyPlan } = require('../services/aiService');
const { getBlueprint } = require('../services/simuladoEngine');
const { getStudyTargets, getProjectedExam, attachProgress } = require('../services/analysisEngine');
const { buildWeeklySchedule, DAY_LABELS } = require('../services/scheduleEngine');

function planKey(discipline, topic) {
  return `${String(discipline || '').trim().toLowerCase()}||${String(topic || '').trim().toLowerCase()}`;
}

async function getLatestEditalTopics(userId) {
  const edital = await db.one('SELECT id,ano,banca,cargo FROM editais WHERE user_id=$1 ORDER BY ano DESC,created_at DESC LIMIT 1', [userId]);
  if (!edital) return { edital: null, topics: [] };
  const topics = await db.query(`
    SELECT et.*,
      COALESCE(sp.progress,0)::int progress,
      sp.notes progress_notes
    FROM edital_topics et
    LEFT JOIN study_progress sp
      ON sp.user_id=$2
      AND lower(sp.discipline)=lower(et.discipline)
      AND lower(sp.topic)=lower(et.topic)
    WHERE et.edital_id=$1
    ORDER BY et.discipline, et.topic, et.subtopic
  `, [edital.id, userId]);
  return { edital, topics };
}

router.get('/', async (req, res, next) => {
  try {
    const totalExams = (await db.one('SELECT COUNT(*)::int c FROM exams WHERE user_id IS NULL OR user_id = $1', [req.session.userId])).c;
    const totalQuestions = (await db.one(`SELECT COUNT(*)::int c FROM questions q JOIN exams e ON e.id=q.exam_id WHERE q.source!='ai_practice' AND (e.user_id IS NULL OR e.user_id=$1)`, [req.session.userId])).c;
    const totalSimulados = (await db.one('SELECT COUNT(*)::int c FROM simulados WHERE user_id IS NULL OR user_id = $1', [req.session.userId])).c;
    const lastReport = await db.one('SELECT * FROM pattern_reports WHERE user_id=$1 ORDER BY generated_at DESC LIMIT 1', [req.session.userId]);
    const blueprint = await getBlueprint(60);
    const perfRows = await db.query(`SELECT q.discipline,COUNT(*)::int total,COALESCE(SUM(sq.correct),0)::int acertos FROM simulado_questions sq JOIN simulados s ON s.id=sq.simulado_id JOIN questions q ON q.id=sq.question_id WHERE sq.answered_at IS NOT NULL AND (s.user_id IS NULL OR s.user_id=$1) GROUP BY q.discipline`, [req.session.userId]);
    res.render('dashboard', { totalExams, totalQuestions, totalSimulados, lastReport, blueprint, perfRows });
  } catch (error) { next(error); }
});

router.get('/questoes', async (req, res, next) => {
  try {
    const { discipline, question } = req.query;
    let rows;
    if (question && /^\d+$/.test(String(question))) {
      rows = await db.query(`SELECT q.*,e.ano FROM questions q JOIN exams e ON e.id=q.exam_id WHERE q.id=$1 AND q.source!='ai_practice' AND (e.user_id IS NULL OR e.user_id=$2) LIMIT 1`, [question, req.session.userId]);
    } else if (discipline) {
      rows = await db.query(`SELECT q.*,e.ano FROM questions q LEFT JOIN exams e ON e.id=q.exam_id WHERE q.discipline=$1 AND q.source!='ai_practice' AND (e.user_id IS NULL OR e.user_id=$2) ORDER BY q.id DESC LIMIT 200`, [discipline, req.session.userId]);
    } else {
      rows = await db.query(`SELECT q.*,e.ano FROM questions q LEFT JOIN exams e ON e.id=q.exam_id WHERE q.source!='ai_practice' AND (e.user_id IS NULL OR e.user_id=$1) ORDER BY q.id DESC LIMIT 200`, [req.session.userId]);
    }
    const disciplines = (await db.query(`SELECT DISTINCT q.discipline FROM questions q LEFT JOIN exams e ON e.id=q.exam_id WHERE e.user_id IS NULL OR e.user_id=$1 ORDER BY q.discipline`, [req.session.userId])).map(r => r.discipline);
    res.render('questions', { questions: rows, disciplines, selected: discipline || '' });
  } catch (error) { next(error); }
});

router.get('/analise', async (req, res) => {
  const lastReport = await db.one('SELECT * FROM pattern_reports WHERE user_id=$1 ORDER BY generated_at DESC LIMIT 1', [req.session.userId]);
  const studyTargets = await attachProgress(await getStudyTargets(30, req.session.userId), req.session.userId);
  const projectedExam = await getProjectedExam(60, req.session.userId);
  res.render('analysis', { report: lastReport, studyTargets, projectedExam });
});

router.get('/proxima-prova', async (req, res) => {
  const projectedExam = await getProjectedExam(60, req.session.userId);
  projectedExam.slots = await attachProgress(projectedExam.slots, req.session.userId);
  res.render('next_exam', { projectedExam });
});

router.post('/analise/gerar', async (req, res) => {
  try {
    const exams = await db.query('SELECT * FROM exams WHERE user_id IS NULL OR user_id=$1 ORDER BY ano', [req.session.userId]);
    const stats = [];
    for (const e of exams) {
      const disciplines = (await db.query('SELECT discipline,num_questions,topics FROM discipline_stats WHERE exam_id=$1', [e.id])).map(d => ({ ...d, topics: Array.isArray(d.topics) ? d.topics : JSON.parse(d.topics || '[]') }));
      stats.push({ ano: e.ano, num_questoes: e.num_questoes, status: e.status, disciplines });
    }
    const { content_md, weights } = await generatePatternReport(stats);
    await db.query('INSERT INTO pattern_reports(content_md,weights_json,user_id) VALUES($1,$2::jsonb,$3)', [content_md, JSON.stringify(weights), req.session.userId]);
    res.redirect('/analise');
  } catch (e) { res.status(500).render('error', { message: e.message }); }
});

router.get('/plano-estudos', async (req, res) => {
  const items = await db.query('SELECT * FROM study_plan WHERE user_id=$1 ORDER BY priority_score DESC', [req.session.userId]);
  const preferences = await db.one('SELECT days,hours_per_day FROM study_plan_preferences WHERE user_id=$1', [req.session.userId]);
  const selectedDays = preferences && Array.isArray(preferences.days) ? preferences.days : ['mon','tue','wed','thu','fri','sat'];
  const hoursPerDay = preferences ? Number(preferences.hours_per_day) : 2;
  const studyTargets = await attachProgress(await getStudyTargets(60, req.session.userId), req.session.userId);
  const { edital, topics: editalTopics } = await getLatestEditalTopics(req.session.userId);
  const weeklySchedule = buildWeeklySchedule({ targets: studyTargets, editalTopics, days: selectedDays, hoursPerDay });
  const todayIndex = (new Date().getDay() + 6) % 7;
  const dayKeys = Object.keys(DAY_LABELS);
  const todayKey = dayKeys[todayIndex];
  const todayBlocks = weeklySchedule.blocks.filter(block => block.day === todayKey);
  res.render('study_plan', {
    items, studyTargets, weeklySchedule, todayBlocks, edital, editalTopics,
    dayLabels: DAY_LABELS, selectedDays, hoursPerDay, querySaved: req.query.saved || ''
  });
});

router.post('/plano-estudos/agenda/salvar', async (req, res) => {
  const requestedDays = Array.isArray(req.body.days) ? req.body.days : (req.body.days ? [req.body.days] : []);
  const selectedDays = requestedDays.filter(day => DAY_LABELS[day]);
  const hoursPerDay = Math.max(0.5, Math.min(12, Number(req.body.hoursPerDay) || 2));
  await db.query(`INSERT INTO study_plan_preferences(user_id,days,hours_per_day,updated_at) VALUES($1,$2::jsonb,$3,CURRENT_TIMESTAMP) ON CONFLICT(user_id) DO UPDATE SET days=excluded.days,hours_per_day=excluded.hours_per_day,updated_at=CURRENT_TIMESTAMP`, [req.session.userId, JSON.stringify(selectedDays), hoursPerDay]);
  res.redirect('/plano-estudos?saved=agenda');
});

router.post('/progresso', async (req, res) => {
  const discipline = String(req.body.discipline || '').trim();
  const topic = String(req.body.topic || '').trim();
  const progress = Math.max(0, Math.min(100, Number(req.body.progress) || 0));
  const notes = String(req.body.notes || '').trim() || null;
  if (!discipline || !topic) return res.status(400).render('error', { message: 'Disciplina e assunto são obrigatórios.' });
  await db.query(`INSERT INTO study_progress(user_id,discipline,topic,progress,notes,updated_at) VALUES($1,$2,$3,$4,$5,CURRENT_TIMESTAMP) ON CONFLICT(user_id,discipline,topic) DO UPDATE SET progress=excluded.progress,notes=excluded.notes,updated_at=CURRENT_TIMESTAMP`, [req.session.userId, discipline, topic, progress, notes]);
  res.redirect(req.get('referer') || '/plano-estudos');
});

router.post('/plano-estudos/gerar', async (req, res) => {
  try {
    const historical = await attachProgress(await getStudyTargets(60, req.session.userId), req.session.userId);
    const { topics: editalTopics } = await getLatestEditalTopics(req.session.userId);
    const schedule = buildWeeklySchedule({ targets: historical, editalTopics, days: ['mon','tue','wed','thu','fri','sat'], hoursPerDay: 2 });
    const weights = schedule.queue.slice(0, 60);
    const report = await db.one('SELECT content_md,weights_json,generated_at FROM pattern_reports WHERE user_id=$1 ORDER BY generated_at DESC LIMIT 1', [req.session.userId]);
    const perfRows = await db.query(`SELECT q.discipline,COUNT(*)::int total,COALESCE(SUM(sq.correct),0)::int acertos FROM simulado_questions sq JOIN simulados s ON s.id=sq.simulado_id JOIN questions q ON q.id=sq.question_id WHERE sq.answered_at IS NOT NULL AND (s.user_id IS NULL OR s.user_id=$1) GROUP BY q.discipline`, [req.session.userId]);
    const aiPlan = await generateStudyPlan({ weights, performance: perfRows, report });
    const aiByTarget = new Map(aiPlan.map(item => [planKey(item.discipline, item.topic), item]));
    const plan = weights.map(target => {
      const aiItem = aiByTarget.get(planKey(target.discipline, target.topic));
      const base = Number(target.priority || target.score || 50);
      const adjustedPriority = Math.max(1, Math.round(base * (1 - ((target.progress || 0) / 200))));
      return {
        discipline: target.discipline,
        topic: target.topic,
        priority_score: adjustedPriority,
        rationale: aiItem?.rationale || `${target.editalRequired ? 'Conteúdo obrigatório do edital. ' : ''}Prioridade baseada em recorrência histórica, incidência recente e progresso atual de ${target.progress || 0}%.`,
        study_notes: aiItem?.study_notes || `Estudar teoria de ${target.topic}, resolver questões reais, corrigir erros e revisar em 24h/7 dias.`
      };
    }).sort((a,b) => b.priority_score-a.priority_score);
    await db.transaction(async client => {
      await client.query('DELETE FROM study_plan WHERE user_id=$1', [req.session.userId]);
      for (const item of plan) await client.query('INSERT INTO study_plan(discipline,topic,priority_score,rationale,study_notes,user_id) VALUES($1,$2,$3,$4,$5,$6)', [item.discipline,item.topic,item.priority_score,item.rationale,item.study_notes,req.session.userId]);
    });
    res.redirect('/plano-estudos?saved=plan');
  } catch (e) { res.status(500).render('error', { message: e.message }); }
});

module.exports = router;
