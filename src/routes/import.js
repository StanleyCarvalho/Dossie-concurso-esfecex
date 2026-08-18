const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const db = require('../db/db');
const { extractTextFromPdf } = require('../services/pdfService');
const { parsePdfToQuestions } = require('../services/aiService');

const uploadDir = process.env.VERCEL
  ? path.join('/tmp', 'uploads')
  : path.join(__dirname, '..', '..', 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({ dest: uploadDir, limits: { fileSize: 25 * 1024 * 1024 } });

router.get('/', async (req, res, next) => {
  try {
  const exams = await db.query('SELECT * FROM exams WHERE user_id IS NULL OR user_id = $1 ORDER BY ano DESC', [req.session.userId]);
  res.render('import', { exams, result: null });
  } catch (error) {
    next(error);
  }
});

router.post('/', upload.single('provaPdf'), async (req, res) => {
  const { ano, cargo, banca } = req.body;
  try {
    const rawText = await extractTextFromPdf(req.file.path);
    const questions = await parsePdfToQuestions(rawText, { ano, cargo, banca });

    const exam = await db.one(`
      INSERT INTO exams (banca, orgao, cargo, ano, num_questoes, fonte, status, user_id)
      VALUES ($1, 'ESFCEx', $2, $3, $4, 'upload PDF + extração IA', 'completa', $5)
      RETURNING id
    `, [banca || 'VUNESP', cargo || 'Informática', Number(ano), questions.length, req.session.userId]);
    const examId = exam.id;

    const disciplineCounts = {};
    const disciplineTopics = {};
    await db.transaction(async client => {
      for (const q of questions) {
        const discipline = q.discipline || 'Não classificado';
        await client.query(`
          INSERT INTO questions (exam_id, number, discipline, topic, statement, alt_a, alt_b, alt_c, alt_d, alt_e, correct_letter, style_notes, source)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'import')
        `, [examId, q.number || null, discipline, q.topic || null, q.statement || '', q.alt_a || null,
          q.alt_b || null, q.alt_c || null, q.alt_d || null, q.alt_e || null,
          q.correct_letter || null, q.style_notes || null]);
        disciplineCounts[discipline] = (disciplineCounts[discipline] || 0) + 1;
        if (q.topic) {
          disciplineTopics[discipline] = disciplineTopics[discipline] || {};
          disciplineTopics[discipline][q.topic] = (disciplineTopics[discipline][q.topic] || 0) + 1;
        }
      }
    });
    for (const [discipline, count] of Object.entries(disciplineCounts)) {
      const topics = Object.entries(disciplineTopics[discipline] || {})
        .sort((a, b) => b[1] - a[1])
        .map(([topic, topicCount]) => ({ topic, count: topicCount }));
      await db.query(`
        INSERT INTO discipline_stats (exam_id, discipline, num_questions, topics)
        VALUES ($1, $2, $3, $4::jsonb)
        ON CONFLICT (exam_id, discipline)
        DO UPDATE SET num_questions = EXCLUDED.num_questions, topics = EXCLUDED.topics
      `, [examId, discipline, count, JSON.stringify(topics)]);
    }

    fs.unlinkSync(req.file.path);

    const exams = await db.query('SELECT * FROM exams WHERE user_id IS NULL OR user_id = $1 ORDER BY ano DESC', [req.session.userId]);
    res.render('import', {
      exams,
      result: { success: true, count: questions.length, examId }
    });
  } catch (e) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    const exams = await db.query('SELECT * FROM exams WHERE user_id IS NULL OR user_id = $1 ORDER BY ano DESC', [req.session.userId]);
    res.render('import', { exams, result: { success: false, error: e.message } });
  }
});

module.exports = router;
