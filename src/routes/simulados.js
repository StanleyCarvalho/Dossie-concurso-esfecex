const express = require('express');
const router = express.Router();
const db = require('../db/db');
const { buildSimulado } = require('../services/simuladoEngine');
const { explainQuestion } = require('../services/aiService');
const { recordAttempt } = require('../services/intelligenceEngine');

router.get('/', async (req, res) => {
  const simulados = await db.query('SELECT * FROM simulados WHERE user_id IS NULL OR user_id = $1 ORDER BY started_at DESC', [req.session.userId]);
  res.render('simulados_list', { simulados });
});

router.post('/novo', async (req, res) => {
  try {
    const total = Number(req.body.total) || 60;
    const duration = Number(req.body.duration) || 240;
    const simuladoId = await buildSimulado({ totalQuestions: total, durationMinutes: duration, userId: req.session.userId });
    res.redirect(`/simulados/${simuladoId}`);
  } catch (e) {
    res.status(500).render('error', { message: e.message });
  }
});

router.get('/:id', async (req, res) => {
  const simulado = await db.one('SELECT * FROM simulados WHERE id = $1 AND (user_id IS NULL OR user_id = $2)', [req.params.id, req.session.userId]);
  if (!simulado) return res.status(404).render('error', { message: 'Simulado não encontrado' });
  const questions = await db.query(`SELECT sq.id as sq_id, sq.order_index, sq.chosen_letter, sq.correct, q.* FROM simulado_questions sq JOIN questions q ON q.id = sq.question_id WHERE sq.simulado_id = $1 ORDER BY sq.order_index`, [req.params.id]);
  res.render('simulado_run', { simulado, questions, finished: !!simulado.finished_at });
});

router.post('/:id/responder', async (req, res) => {
  const { sqId, letter } = req.body;
  const sq = await db.one(`SELECT sq.*, q.correct_letter, q.id question_id FROM simulado_questions sq JOIN simulados s ON s.id=sq.simulado_id JOIN questions q ON q.id=sq.question_id WHERE sq.id=$1 AND sq.simulado_id=$2 AND (s.user_id IS NULL OR s.user_id=$3)`, [sqId, req.params.id, req.session.userId]);
  if (!sq) return res.status(404).json({ error: 'not found' });
  const correct = sq.correct_letter ? (String(letter).toUpperCase() === String(sq.correct_letter).toUpperCase() ? 1 : 0) : null;
  await db.query('UPDATE simulado_questions SET chosen_letter=$1, correct=$2, answered_at=CURRENT_TIMESTAMP WHERE id=$3', [letter, correct, sqId]);
  await recordAttempt({ userId: req.session.userId, questionId: sq.question_id, letter, source: 'simulado' });
  res.json({ ok: true, correct });
});

router.post('/:id/finalizar', async (req, res) => {
  const simulado = await db.one('SELECT id FROM simulados WHERE id=$1 AND (user_id IS NULL OR user_id=$2)', [req.params.id, req.session.userId]);
  if (!simulado) return res.status(404).render('error', { message: 'Simulado não encontrado' });
  const total = (await db.one('SELECT COUNT(*)::int c FROM simulado_questions WHERE simulado_id=$1', [req.params.id])).c;
  const acertos = (await db.one('SELECT COALESCE(SUM(correct),0)::int c FROM simulado_questions WHERE simulado_id=$1', [req.params.id])).c;
  const score = total > 0 ? (acertos / total) * 100 : 0;
  await db.query('UPDATE simulados SET finished_at=CURRENT_TIMESTAMP, score=$1 WHERE id=$2', [score, req.params.id]);
  res.redirect(`/simulados/${req.params.id}`);
});

router.post('/questao/:id/explicar', async (req, res) => {
  try {
    const question = await db.one('SELECT * FROM questions WHERE id=$1', [req.params.id]);
    if (!question) return res.status(404).json({ error: 'not found' });
    if (!question.explanation) {
      question.explanation = await explainQuestion(question);
      await db.query('UPDATE questions SET explanation=$1 WHERE id=$2', [question.explanation, question.id]);
    }
    res.json({ explanation: question.explanation });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
