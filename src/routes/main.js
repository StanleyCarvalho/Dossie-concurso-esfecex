const express = require('express');
const router = express.Router();
const db = require('../db/db');
const { generatePatternReport, generateStudyPlan } = require('../services/aiService');
const { getBlueprint } = require('../services/simuladoEngine');
const { getStudyTargets, getProjectedExam, attachProgress } = require('../services/analysisEngine');
const { buildWeeklySchedule, DAY_LABELS } = require('../services/scheduleEngine');

router.get('/', (req, res) => {
  const totalExams = db.prepare('SELECT COUNT(*) c FROM exams WHERE user_id IS NULL OR user_id = ?').get(req.session.userId).c;
  const totalQuestions = db.prepare("SELECT COUNT(*) c FROM questions WHERE source != 'ai_practice'").get().c;
  const totalSimulados = db.prepare('SELECT COUNT(*) c FROM simulados WHERE user_id IS NULL OR user_id = ?').get(req.session.userId).c;
  const lastReport = db.prepare('SELECT * FROM pattern_reports ORDER BY generated_at DESC LIMIT 1').get();
  const blueprint = getBlueprint(50);

  const perfRows = db.prepare(`
    SELECT q.discipline,
           COUNT(*) as total,
           SUM(sq.correct) as acertos
    FROM simulado_questions sq
    JOIN simulados s ON s.id = sq.simulado_id
    JOIN questions q ON q.id = sq.question_id
    WHERE sq.answered_at IS NOT NULL
      AND (s.user_id IS NULL OR s.user_id = ?)
    GROUP BY q.discipline
  `).all(req.session.userId);

  res.render('dashboard', {
    totalExams, totalQuestions, totalSimulados, lastReport, blueprint, perfRows
  });
});

router.get('/questoes', (req, res) => {
  const { discipline } = req.query;
  let rows;
  if (discipline) {
    rows = db.prepare(`
      SELECT q.* FROM questions q
      LEFT JOIN exams e ON e.id = q.exam_id
      WHERE q.discipline = ? AND q.source != 'ai_practice' AND (e.user_id IS NULL OR e.user_id = ?)
      ORDER BY q.id DESC LIMIT 200
    `).all(discipline, req.session.userId);
  } else {
    rows = db.prepare(`
      SELECT q.* FROM questions q
      LEFT JOIN exams e ON e.id = q.exam_id
      WHERE q.source != 'ai_practice' AND (e.user_id IS NULL OR e.user_id = ?)
      ORDER BY q.id DESC LIMIT 200
    `).all(req.session.userId);
  }
  const disciplines = db.prepare(`
    SELECT DISTINCT q.discipline FROM questions q
    LEFT JOIN exams e ON e.id = q.exam_id
    WHERE e.user_id IS NULL OR e.user_id = ?
    ORDER BY q.discipline
  `).all(req.session.userId).map(r => r.discipline);
  res.render('questions', { questions: rows, disciplines, selected: discipline || '' });
});

router.get('/analise', async (req, res) => {
  const lastReport = db.prepare('SELECT * FROM pattern_reports ORDER BY generated_at DESC LIMIT 1').get();
  res.render('analysis', {
    report: lastReport,
    studyTargets: attachProgress(getStudyTargets(30), req.session.userId),
    projectedExam: getProjectedExam(60)
  });
});

router.get('/proxima-prova', (req, res) => {
  const projectedExam = getProjectedExam(60);
  projectedExam.slots = attachProgress(projectedExam.slots, req.session.userId);
  res.render('next_exam', { projectedExam });
});

router.post('/analise/gerar', async (req, res) => {
  try {
    const exams = db.prepare('SELECT * FROM exams ORDER BY ano').all();
    const stats = exams.map(e => {
      const disciplines = db.prepare('SELECT discipline, num_questions, topics FROM discipline_stats WHERE exam_id = ?').all(e.id)
        .map(d => ({ ...d, topics: JSON.parse(d.topics || '[]') }));
      return { ano: e.ano, num_questoes: e.num_questoes, status: e.status, disciplines };
    });

    const { content_md, weights } = await generatePatternReport(stats);

    db.prepare('INSERT INTO pattern_reports (content_md, weights_json) VALUES (?, ?)')
      .run(content_md, JSON.stringify(weights));

    res.redirect('/analise');
  } catch (e) {
    res.status(500).render('error', { message: e.message });
  }
});

router.get('/plano-estudos', (req, res) => {
  const items = db.prepare('SELECT * FROM study_plan ORDER BY priority_score DESC').all();
  const selectedDays = Array.isArray(req.query.days)
    ? req.query.days
    : (req.query.days ? [req.query.days] : ['mon', 'wed', 'fri']);
  const hoursPerDay = Number(req.query.hoursPerDay) || 2;
  const studyTargets = attachProgress(getStudyTargets(30), req.session.userId);
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

router.post('/progresso', (req, res) => {
  const discipline = String(req.body.discipline || '').trim();
  const topic = String(req.body.topic || '').trim();
  const progress = Math.max(0, Math.min(100, Number(req.body.progress) || 0));
  const notes = String(req.body.notes || '').trim() || null;

  if (!discipline || !topic) return res.status(400).render('error', { message: 'Disciplina e assunto sao obrigatorios.' });

  db.prepare(`
    INSERT INTO study_progress (user_id, discipline, topic, progress, notes, updated_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id, discipline, topic)
    DO UPDATE SET progress = excluded.progress, notes = excluded.notes, updated_at = CURRENT_TIMESTAMP
  `).run(req.session.userId, discipline, topic, progress, notes);

  res.redirect(req.get('referer') || '/plano-estudos');
});

router.post('/plano-estudos/gerar', async (req, res) => {
  try {
    const weights = getStudyTargets(30);

    const perfRows = db.prepare(`
      SELECT q.discipline,
             COUNT(*) as total,
             SUM(sq.correct) as acertos
      FROM simulado_questions sq
      JOIN questions q ON q.id = sq.question_id
      WHERE sq.answered_at IS NOT NULL
      GROUP BY q.discipline
    `).all();

    const plan = await generateStudyPlan({ weights, performance: perfRows });

    db.prepare('DELETE FROM study_plan').run();
    const insert = db.prepare(`
      INSERT INTO study_plan (discipline, topic, priority_score, rationale, study_notes)
      VALUES (@discipline, @topic, @priority_score, @rationale, @study_notes)
    `);
    const tx = db.transaction(items => { for (const it of items) insert.run(it); });
    tx(plan);

    res.redirect('/plano-estudos');
  } catch (e) {
    res.status(500).render('error', { message: e.message });
  }
});

module.exports = router;
