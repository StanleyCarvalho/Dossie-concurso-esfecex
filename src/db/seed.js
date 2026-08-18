const fs = require('fs');
const path = require('path');
const db = require('./db');

const refPath = path.join(__dirname, '..', '..', 'data', 'reference_exams.json');
const ref = JSON.parse(fs.readFileSync(refPath, 'utf-8'));

async function seed() {
  const count = await db.one('SELECT COUNT(*)::int AS c FROM exams');
  if (count.c > 0) {
    console.log('Banco já possui dados; seed ignorado.');
    return;
  }

  await db.transaction(async client => {
    for (const exam of ref.exams) {
      const result = await client.query(`
        INSERT INTO exams (banca, orgao, cargo, ano, data_aplicacao, num_questoes, fonte, status)
        VALUES ('VUNESP', 'ESFCEx', 'Informática', $1, $2, $3, 'seed inicial (dados públicos agregados)', $4)
        RETURNING id
      `, [exam.ano, exam.data_aplicacao, exam.num_questoes, exam.status]);
      const examId = result.rows[0].id;

      for (const discipline of exam.disciplines) {
        await client.query(`
          INSERT INTO discipline_stats (exam_id, discipline, num_questions, topics)
          VALUES ($1, $2, $3, $4::jsonb)
          ON CONFLICT (exam_id, discipline)
          DO UPDATE SET num_questions = EXCLUDED.num_questions, topics = EXCLUDED.topics
        `, [examId, discipline.discipline, discipline.num_questions, JSON.stringify(discipline.topics || [])]);
      }
    }
  });

  console.log(`Seed concluído: ${ref.exams.length} provas de referência inseridas.`);
}

seed()
  .then(() => db.pool.end())
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
