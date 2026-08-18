const db = require('../db/db');
const { generatePracticeQuestions } = require('./aiService');

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Calcula a distribuição média de questões por disciplina com base
 * no histórico salvo (discipline_stats), normalizada para `totalQuestions`.
 */
async function getBlueprint(totalQuestions = 50) {
  const rows = await db.query(`
    SELECT discipline, SUM(num_questions)::int as total, COUNT(DISTINCT exam_id)::int as exams
    FROM discipline_stats
    GROUP BY discipline
  `);

  const grandTotal = rows.reduce((s, r) => s + r.total, 0);
  if (grandTotal === 0) return [];

  return rows
    .map(r => ({
      discipline: r.discipline,
      proportion: r.total / grandTotal,
      target: Math.max(1, Math.round((r.total / grandTotal) * totalQuestions))
    }))
    .sort((a, b) => b.target - a.target);
}

/**
 * Monta um simulado: tenta usar questões reais importadas do banco;
 * se não houver o suficiente para uma disciplina, completa com questões
 * de treino inéditas geradas por IA (claramente marcadas como tal).
 */
async function buildSimulado({ totalQuestions = 50, durationMinutes = 240, useAiFill = true, userId = null }) {
  const blueprint = await getBlueprint(totalQuestions);
  if (blueprint.length === 0) {
    throw new Error('Sem dados históricos suficientes para montar o blueprint. Rode o seed ou importe provas primeiro.');
  }

  // ajusta soma para bater exatamente com totalQuestions
  let diff = totalQuestions - blueprint.reduce((s, b) => s + b.target, 0);
  let i = 0;
  while (diff !== 0 && blueprint.length > 0) {
    blueprint[i % blueprint.length].target += diff > 0 ? 1 : -1;
    diff += diff > 0 ? -1 : 1;
    i++;
  }

  const selected = [];
  for (const b of blueprint) {
    const real = await db.query(
      'SELECT * FROM questions WHERE discipline = $1 ORDER BY RANDOM() LIMIT $2',
      [b.discipline, b.target]
    );
    selected.push(...real);
    const missing = b.target - real.length;
    if (missing > 0 && useAiFill) {
      try {
        const generated = await generatePracticeQuestions({
          discipline: b.discipline,
          topic: b.discipline,
          count: missing
        });
        for (const g of generated) {
          selected.push({ ...g, id: null, ai_generated: true });
        }
      } catch (e) {
        // se a IA falhar (ex: sem API key), apenas segue com menos questões dessa disciplina
      }
    }
  }

  const finalQuestions = shuffle(selected).slice(0, totalQuestions);

  const simulado = await db.one(`
    INSERT INTO simulados (title, blueprint_json, total_questions, duration_minutes, user_id)
    VALUES ($1, $2::jsonb, $3, $4, $5)
    RETURNING id
  `, [
    `Simulado ESFCEx Informática - ${new Date().toLocaleDateString('pt-BR')}`,
    JSON.stringify(blueprint),
    finalQuestions.length,
    durationMinutes,
    userId
  ]);
  const simuladoId = simulado.id;

  await db.transaction(async client => {
    for (const [idx, q] of finalQuestions.entries()) {
      let questionId = q.id;
      if (!questionId) {
        const result = await client.query(`
          INSERT INTO questions (exam_id, number, discipline, topic, statement, alt_a, alt_b, alt_c, alt_d, alt_e, correct_letter, explanation, source)
          VALUES (NULL, NULL, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'ai_practice')
          RETURNING id
        `, [q.discipline, q.topic || q.discipline, q.statement, q.alt_a, q.alt_b, q.alt_c,
          q.alt_d, q.alt_e || null, q.correct_letter, q.explanation || null]);
        questionId = result.rows[0].id;
      }
      await client.query(
        'INSERT INTO simulado_questions (simulado_id, question_id, order_index) VALUES ($1, $2, $3)',
        [simuladoId, questionId, idx + 1]
      );
    }
  });

  return simuladoId;
}

module.exports = { getBlueprint, buildSimulado };
