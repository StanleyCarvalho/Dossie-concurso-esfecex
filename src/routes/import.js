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
  const result = req.query.deleted === '1'
    ? { success: true, message: 'Prova e questões vinculadas excluídas com sucesso.' }
    : (req.query.deleteError === '1'
      ? { success: false, error: 'Prova não encontrada ou você não tem permissão para excluí-la.' }
      : null);
  res.render('import', { exams, result });
  } catch (error) {
    next(error);
  }
});

router.post('/', upload.single('provaPdf'), async (req, res) => {
  const { ano, cargo, banca, numQuestoes } = req.body;
  const startedAt = Date.now();
  try {
    if (!req.file) throw new Error('Selecione um arquivo PDF para importar.');
    const expectedQuestions = Number(numQuestoes || 60);
    if (!Number.isInteger(expectedQuestions) || expectedQuestions < 1 || expectedQuestions > 200) {
      throw new Error('Informe uma quantidade de questões entre 1 e 200.');
    }
    console.log(JSON.stringify({
      level: 'info',
      message: 'pdf_import_started',
      fileSize: req.file.size,
      ano: Number(ano),
      userId: req.session.userId
    }));
    const rawText = await extractTextFromPdf(req.file.path);
    const questions = await parsePdfToQuestions(rawText, { ano, cargo, banca, expectedQuestions });

    if (!questions.length) {
      throw new Error('Nenhuma questão foi identificada no PDF.');
    }

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

    console.log(JSON.stringify({
      level: 'info',
      message: 'pdf_import_completed',
      examId,
      questions: questions.length,
      durationMs: Date.now() - startedAt
    }));

    const exams = await db.query('SELECT * FROM exams WHERE user_id IS NULL OR user_id = $1 ORDER BY ano DESC', [req.session.userId]);
    res.render('import', {
      exams,
      result: { success: true, count: questions.length, examId }
    });
  } catch (e) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    console.error(JSON.stringify({
      level: 'error',
      message: 'pdf_import_failed',
      error: e.message,
      durationMs: Date.now() - startedAt
    }));
    const exams = await db.query('SELECT * FROM exams WHERE user_id IS NULL OR user_id = $1 ORDER BY ano DESC', [req.session.userId]);
    res.render('import', { exams, result: { success: false, error: e.message } });
  }
});

router.post('/:id/delete', async (req, res, next) => {
  try {
    const deletedExam = await db.one(`
      DELETE FROM exams
      WHERE id = $1 AND (user_id = $2 OR user_id IS NULL)
      RETURNING id, ano, num_questoes
    `, [req.params.id, req.session.userId]);

    if (!deletedExam) return res.redirect('/import?deleteError=1');

    console.log(JSON.stringify({
      level: 'info',
      message: 'exam_deleted',
      examId: deletedExam.id,
      ano: deletedExam.ano,
      questions: deletedExam.num_questoes,
      userId: req.session.userId
    }));
    return res.redirect('/import?deleted=1');
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
