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
function getBlueprint(totalQuestions = 50) {
  const rows = db.prepare(`
    SELECT discipline, SUM(num_questions) as total, COUNT(DISTINCT exam_id) as exams
    FROM discipline_stats
    GROUP BY discipline
  `).all();

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
  const blueprint = getBlueprint(totalQuestions);
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
  const getRealQuestions = db.prepare(`SELECT * FROM questions WHERE discipline = ? ORDER BY RANDOM() LIMIT ?`);

  for (const b of blueprint) {
    const real = getRealQuestions.all(b.discipline, b.target);
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

  const insertSimulado = db.prepare(`
    INSERT INTO simulados (title, blueprint_json, total_questions, duration_minutes, user_id)
    VALUES (?, ?, ?, ?, ?)
  `);
  const info = insertSimulado.run(
    `Simulado ESFCEx Informática - ${new Date().toLocaleDateString('pt-BR')}`,
    JSON.stringify(blueprint),
    finalQuestions.length,
    durationMinutes,
    userId
  );
  const simuladoId = info.lastInsertRowid;

  const insertSQ = db.prepare(`
    INSERT INTO simulado_questions (simulado_id, question_id, order_index)
    VALUES (?, ?, ?)
  `);

  // Para questões geradas por IA (sem id no banco principal), persistimos como questão avulsa
  const insertAdhocQuestion = db.prepare(`
    INSERT INTO questions (exam_id, number, discipline, topic, statement, alt_a, alt_b, alt_c, alt_d, alt_e, correct_letter, explanation, source)
    VALUES (NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ai_practice')
  `);

  finalQuestions.forEach((q, idx) => {
    let questionId = q.id;
    if (!questionId) {
      const r = insertAdhocQuestion.run(
        q.discipline, q.topic || q.discipline, q.statement,
        q.alt_a, q.alt_b, q.alt_c, q.alt_d, q.alt_e || null,
        q.correct_letter, q.explanation || null
      );
      questionId = r.lastInsertRowid;
    }
    insertSQ.run(simuladoId, questionId, idx + 1);
  });

  return simuladoId;
}

module.exports = { getBlueprint, buildSimulado };
