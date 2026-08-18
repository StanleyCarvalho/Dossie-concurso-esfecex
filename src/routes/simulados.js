const express = require('express');
const router = express.Router();
const db = require('../db/db');
const { buildSimulado } = require('../services/simuladoEngine');
const { explainQuestion } = require('../services/aiService');

router.get('/', (req, res) => {
  const simulados = db.prepare('SELECT * FROM simulados WHERE user_id IS NULL OR user_id = ? ORDER BY started_at DESC').all(req.session.userId);
  res.render('simulados_list', { simulados });
});

router.post('/novo', async (req, res) => {
  try {
    const total = Number(req.body.total) || 50;
    const duration = Number(req.body.duration) || 240;
    const simuladoId = await buildSimulado({ totalQuestions: total, durationMinutes: duration, userId: req.session.userId });
    res.redirect(`/simulados/${simuladoId}`);
  } catch (e) {
    res.status(500).render('error', { message: e.message });
  }
});

router.get('/:id', (req, res) => {
  const simulado = db.prepare('SELECT * FROM simulados WHERE id = ? AND (user_id IS NULL OR user_id = ?)').get(req.params.id, req.session.userId);
  if (!simulado) return res.status(404).render('error', { message: 'Simulado não encontrado' });

  const questions = db.prepare(`
    SELECT sq.id as sq_id, sq.order_index, sq.chosen_letter, sq.correct, q.*
    FROM simulado_questions sq
    JOIN questions q ON q.id = sq.question_id
    WHERE sq.simulado_id = ?
    ORDER BY sq.order_index
  `).all(req.params.id);

  res.render('simulado_run', { simulado, questions, finished: !!simulado.finished_at });
});

router.post('/:id/responder', (req, res) => {
  const { sqId, letter } = req.body;
  const sq = db.prepare('SELECT sq.*, q.correct_letter FROM simulado_questions sq JOIN questions q ON q.id = sq.question_id WHERE sq.id = ?').get(sqId);
  if (!sq) return res.status(404).json({ error: 'not found' });

  const correct = sq.correct_letter ? (letter === sq.correct_letter ? 1 : 0) : null;
  db.prepare('UPDATE simulado_questions SET chosen_letter = ?, correct = ?, answered_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(letter, correct, sqId);

  res.json({ ok: true, correct });
});

router.post('/:id/finalizar', (req, res) => {
  const total = db.prepare('SELECT COUNT(*) c FROM simulado_questions WHERE simulado_id = ?').get(req.params.id).c;
  const acertos = db.prepare('SELECT SUM(correct) c FROM simulado_questions WHERE simulado_id = ?').get(req.params.id).c || 0;
  const score = total > 0 ? (acertos / total) * 100 : 0;

  db.prepare('UPDATE simulados SET finished_at = CURRENT_TIMESTAMP, score = ? WHERE id = ?').run(score, req.params.id);
  res.redirect(`/simulados/${req.params.id}`);
});

router.post('/questao/:id/explicar', async (req, res) => {
  try {
    const question = db.prepare('SELECT * FROM questions WHERE id = ?').get(req.params.id);
    if (!question) return res.status(404).json({ error: 'not found' });

    if (!question.explanation) {
      const explanation = await explainQuestion(question);
      db.prepare('UPDATE questions SET explanation = ? WHERE id = ?').run(explanation, question.id);
      question.explanation = explanation;
    }
    res.json({ explanation: question.explanation });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
