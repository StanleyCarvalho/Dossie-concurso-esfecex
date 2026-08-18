const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const db = require('../db/db');
const { extractTextFromPdf } = require('../services/pdfService');
const { parsePdfToQuestions } = require('../services/aiService');

const uploadDir = path.join(__dirname, '..', '..', 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({ dest: uploadDir, limits: { fileSize: 25 * 1024 * 1024 } });

router.get('/', (req, res) => {
  const exams = db.prepare('SELECT * FROM exams WHERE user_id IS NULL OR user_id = ? ORDER BY ano DESC').all(req.session.userId);
  res.render('import', { exams, result: null });
});

router.post('/', upload.single('provaPdf'), async (req, res) => {
  const { ano, cargo, banca } = req.body;
  try {
    const rawText = await extractTextFromPdf(req.file.path);
    const questions = await parsePdfToQuestions(rawText, { ano, cargo, banca });

    const insertExam = db.prepare(`
      INSERT INTO exams (banca, orgao, cargo, ano, num_questoes, fonte, status, user_id)
      VALUES (?, 'ESFCEx', ?, ?, ?, 'upload PDF + extração IA', 'completa', ?)
    `);
    const info = insertExam.run(banca || 'VUNESP', cargo || 'Informática', Number(ano), questions.length, req.session.userId);
    const examId = info.lastInsertRowid;

    const insertQuestion = db.prepare(`
      INSERT INTO questions (exam_id, number, discipline, topic, statement, alt_a, alt_b, alt_c, alt_d, alt_e, correct_letter, style_notes, source)
      VALUES (@exam_id, @number, @discipline, @topic, @statement, @alt_a, @alt_b, @alt_c, @alt_d, @alt_e, @correct_letter, @style_notes, 'import')
    `);

    const disciplineCounts = {};
    const disciplineTopics = {};
    const tx = db.transaction(items => {
      for (const q of items) {
        const discipline = q.discipline || 'Não classificado';
        insertQuestion.run({
          exam_id: examId,
          number: q.number || null,
          discipline,
          topic: q.topic || null,
          statement: q.statement || '',
          alt_a: q.alt_a || null,
          alt_b: q.alt_b || null,
          alt_c: q.alt_c || null,
          alt_d: q.alt_d || null,
          alt_e: q.alt_e || null,
          correct_letter: q.correct_letter || null,
          style_notes: q.style_notes || null
        });
        disciplineCounts[discipline] = (disciplineCounts[discipline] || 0) + 1;
        if (q.topic) {
          disciplineTopics[discipline] = disciplineTopics[discipline] || {};
          disciplineTopics[discipline][q.topic] = (disciplineTopics[discipline][q.topic] || 0) + 1;
        }
      }
    });
    tx(questions);

    const insertDisc = db.prepare(`
      INSERT OR REPLACE INTO discipline_stats (exam_id, discipline, num_questions, topics)
      VALUES (?, ?, ?, ?)
    `);
    for (const [discipline, count] of Object.entries(disciplineCounts)) {
      const topics = Object.entries(disciplineTopics[discipline] || {})
        .sort((a, b) => b[1] - a[1])
        .map(([topic, topicCount]) => ({ topic, count: topicCount }));
      insertDisc.run(examId, discipline, count, JSON.stringify(topics));
    }

    fs.unlinkSync(req.file.path);

    const exams = db.prepare('SELECT * FROM exams WHERE user_id IS NULL OR user_id = ? ORDER BY ano DESC').all(req.session.userId);
    res.render('import', {
      exams,
      result: { success: true, count: questions.length, examId }
    });
  } catch (e) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    const exams = db.prepare('SELECT * FROM exams WHERE user_id IS NULL OR user_id = ? ORDER BY ano DESC').all(req.session.userId);
    res.render('import', { exams, result: { success: false, error: e.message } });
  }
});

module.exports = router;
