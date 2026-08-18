const fs = require('fs');
const path = require('path');
const db = require('./db');

const refPath = path.join(__dirname, '..', '..', 'data', 'reference_exams.json');
const ref = JSON.parse(fs.readFileSync(refPath, 'utf-8'));

const insertExam = db.prepare(`
  INSERT INTO exams (banca, orgao, cargo, ano, data_aplicacao, num_questoes, fonte, status)
  VALUES ('VUNESP', 'ESFCEx', 'Informática', @ano, @data_aplicacao, @num_questoes, 'seed inicial (dados públicos agregados)', @status)
`);

const insertDiscipline = db.prepare(`
  INSERT OR REPLACE INTO discipline_stats (exam_id, discipline, num_questions, topics)
  VALUES (@exam_id, @discipline, @num_questions, @topics)
`);

const existingCount = db.prepare('SELECT COUNT(*) as c FROM exams').get().c;

if (existingCount === 0) {
  const tx = db.transaction(() => {
    for (const exam of ref.exams) {
      const info = insertExam.run(exam);
      const examId = info.lastInsertRowid;
      for (const d of exam.disciplines) {
        insertDiscipline.run({
          exam_id: examId,
          discipline: d.discipline,
          num_questions: d.num_questions,
          topics: JSON.stringify(d.topics || [])
        });
      }
    }
  });
  tx();
  console.log(`Seed concluído: ${ref.exams.length} provas de referência inseridas.`);
} else {
  console.log('Banco já possui dados, seed ignorado. Apague data/esfcex.db para re-semear.');
}
