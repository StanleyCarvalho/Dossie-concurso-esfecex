const express = require('express');
const router = express.Router();
const db = require('../db/db');
const { generatePatternReport, generateStudyPlan } = require('../services/aiService');
const { getBlueprint } = require('../services/simuladoEngine');
const { getStudyTargets, getProjectedExam, attachProgress } = require('../services/analysisEngine');
const { buildWeeklySchedule, DAY_LABELS } = require('../services/scheduleEngine');

router.get('/', async (req, res, next) => {
  try {
  const totalExams = (await db.one('SELECT COUNT(*)::int c FROM exams WHERE user_id IS NULL OR user_id = $1', [req.session.userId])).c;
  const totalQuestions = (await db.one("SELECT COUNT(*)::int c FROM questions WHERE source != 'ai_practice'")).c;
  const totalSimulados = (await db.one('SELECT COUNT(*)::int c FROM simulados WHERE user_id IS NULL OR user_id = $1', [req.session.userId])).c;
  const lastReport = await db.one('SELECT * FROM pattern_reports ORDER BY generated_at DESC LIMIT 1');
  const blueprint = await getBlueprint(50);

  const perfRows = await db.query(`
    SELECT q.discipline,
           COUNT(*)::int as total,
           COALESCE(SUM(sq.correct), 0)::int as acertos
    FROM simulado_questions sq
    JOIN simulados s ON s.id = sq.simulado_id
    JOIN questions q ON q.id = sq.question_id
    WHERE sq.answered_at IS NOT NULL
      AND (s.user_id IS NULL OR s.user_id = $1)
    GROUP BY q.discipline
  `, [req.session.userId]);

  res.render('dashboard', {
    totalExams, totalQuestions, totalSimulados, lastReport, blueprint, perfRows
  });
  } catch (error) {
    next(error);
  }
});

router.get('/questoes', async (req, res, next) => {
  try {
  const { discipline } = req.query;
  let rows;
  if (discipline) {
    rows = await db.query(`
      SELECT q.* FROM questions q
      LEFT JOIN exams e ON e.id = q.exam_id
      WHERE q.discipline = $1 AND q.source != 'ai_practice' AND (e.user_id IS NULL OR e.user_id = $2)
      ORDER BY q.id DESC LIMIT 200
    `, [discipline, req.session.userId]);
  } else {
    rows = await db.query(`
      SELECT q.* FROM questions q
      LEFT JOIN exams e ON e.id = q.exam_id
      WHERE q.source != 'ai_practice' AND (e.user_id IS NULL OR e.user_id = $1)
      ORDER BY q.id DESC LIMIT 200
    `, [req.session.userId]);
  }
  const disciplines = (await db.query(`
    SELECT DISTINCT q.discipline FROM questions q
    LEFT JOIN exams e ON e.id = q.exam_id
    WHERE e.user_id IS NULL OR e.user_id = $1
    ORDER BY q.discipline
  `, [req.session.userId])).map(r => r.discipline);
  res.render('questions', { questions: rows, disciplines, selected: discipline || '' });
  } catch (error) {
    next(error);
  }
});

router.get('/analise', async (req, res) => {
  const lastReport = await db.one('SELECT * FROM pattern_reports ORDER BY generated_at DESC LIMIT 1');
  const studyTargets = await attachProgress(await getStudyTargets(30), req.session.userId);
  const projectedExam = await getProjectedExam(60);
  res.render('analysis', {
    report: lastReport,
    studyTargets,
    projectedExam
  });
});

router.get('/proxima-prova', async (req, res) => {
  const projectedExam = await getProjectedExam(60);
  projectedExam.slots = await attachProgress(projectedExam.slots, req.session.userId);
  res.render('next_exam', { projectedExam });
});

router.post('/analise/gerar', async (req, res) => {
  try {
    const exams = await db.query('SELECT * FROM exams ORDER BY ano');
    const stats = [];
    for (const e of exams) {
      const disciplines = (await db.query('SELECT discipline, num_questions, topics FROM discipline_stats WHERE exam_id = $1', [e.id]))
        .map(d => ({ ...d, topics: Array.isArray(d.topics) ? d.topics : JSON.parse(d.topics || '[]') }));
      stats.push({ ano: e.ano, num_questoes: e.num_questoes, status: e.status, disciplines });
    }

    const { content_md, weights } = await generatePatternReport(stats);

    await db.query('INSERT INTO pattern_reports (content_md, weights_json) VALUES ($1, $2::jsonb)', [content_md, JSON.stringify(weights)]);

    res.redirect('/analise');
  } catch (e) {
    res.status(500).render('error', { message: e.message });
  }
});

router.get('/plano-estudos', async (req, res) => {
  const items = await db.query('SELECT * FROM study_plan ORDER BY priority_score DESC');
  const selectedDays = Array.isArray(req.query.days)
    ? req.query.days
    : (req.query.days ? [req.query.days] : ['mon', 'wed', 'fri']);
  const hoursPerDay = Number(req.query.hoursPerDay) || 2;
  const studyTargets = await attachProgress(await getStudyTargets(30), req.session.userId);
  const weeklySchedule = buildWeeklySchedule({ targets: studyTargets, days: selectedDays, hoursPerDay });

  res.render('study_plan', {
    items,
    studyTargets,
    weeklySchedule,
    dayLabels: DAY_LABELS,
    selectedDays,
    hoursPerDay
  });
});

router.post('/progresso', async (req, res) => {
  const discipline = String(req.body.discipline || '').trim();
  const topic = String(req.body.topic || '').trim();
  const progress = Math.max(0, Math.min(100, Number(req.body.progress) || 0));
  const notes = String(req.body.notes || '').trim() || null;

  if (!discipline || !topic) return res.status(400).render('error', { message: 'Disciplina e assunto sao obrigatorios.' });

  await db.query(`
    INSERT INTO study_progress (user_id, discipline, topic, progress, notes, updated_at)
    VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id, discipline, topic)
    DO UPDATE SET progress = excluded.progress, notes = excluded.notes, updated_at = CURRENT_TIMESTAMP
  `, [req.session.userId, discipline, topic, progress, notes]);

  res.redirect(req.get('referer') || '/plano-estudos');
});

router.post('/plano-estudos/gerar', async (req, res) => {
  try {
    const weights = await getStudyTargets(30);

    const perfRows = await db.query(`
      SELECT q.discipline,
             COUNT(*)::int as total,
             COALESCE(SUM(sq.correct), 0)::int as acertos
      FROM simulado_questions sq
      JOIN questions q ON q.id = sq.question_id
      WHERE sq.answered_at IS NOT NULL
      GROUP BY q.discipline
    `);

    const plan = await generateStudyPlan({ weights, performance: perfRows });

    await db.transaction(async client => {
      await client.query('DELETE FROM study_plan');
      for (const item of plan) {
        await client.query(`
          INSERT INTO study_plan (discipline, topic, priority_score, rationale, study_notes)
          VALUES ($1, $2, $3, $4, $5)
        `, [item.discipline, item.topic, item.priority_score, item.rationale, item.study_notes]);
      }
    });

    res.redirect('/plano-estudos');
  } catch (e) {
    res.status(500).render('error', { message: e.message });
  }
});

module.exports = router;
