const express = require('express');
const router = express.Router();
const { calibrateDifficulty, getDifficultySummary, getRepeatedByTopic, generatePredictionRun, getLatestPrediction } = require('../services/predictionEngine');

router.get('/dificuldade', async (req,res) => {
  await calibrateDifficulty(req.session.userId, 40);
  res.render('difficulty', { summary: await getDifficultySummary(req.session.userId) });
});

router.post('/dificuldade/calibrar', async (req,res) => {
  const total = await calibrateDifficulty(req.session.userId, 80);
  res.redirect(`/dificuldade?analisadas=${total}`);
});

router.get('/questoes-repetidas', async (req,res) => {
  res.render('repeated_topics', { topics: await getRepeatedByTopic(req.session.userId) });
});

router.post('/previsao-ia/gerar', async (req,res) => {
  await calibrateDifficulty(req.session.userId, 80);
  await generatePredictionRun(req.session.userId, Number(req.body.targetYear)||2027);
  res.redirect('/previsao-ia');
});

router.get('/previsao-ia', async (req,res) => {
  const prediction = await getLatestPrediction(req.session.userId, Number(req.query.year)||2027);
  res.render('prediction_ai', { prediction, difficultySummary: await getDifficultySummary(req.session.userId) });
});

router.get('/api/previsao-ia', async (req,res) => {
  const prediction = await getLatestPrediction(req.session.userId, Number(req.query.year)||2027);
  res.json(prediction);
});

module.exports = router;
