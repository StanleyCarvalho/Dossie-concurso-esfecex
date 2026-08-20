const db = require('../db/db');

function normalize(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function canonicalDiscipline(value) {
  const n = normalize(value);
  if (/portugues|lingua portuguesa/.test(n)) return 'Língua Portuguesa';
  if (/programacao/.test(n)) return 'Programação';
  if (/banco de dados/.test(n)) return 'Banco de Dados';
  if (/sistemas? operacionais?/.test(n)) return 'Sistemas Operacionais';
  if (/arquitetura/.test(n)) return 'Arquitetura de Computadores';
  if (/engenharia de software/.test(n)) return 'Engenharia de Software';
  if (/seguranca/.test(n)) return 'Segurança da Informação';
  if (/governanca/.test(n)) return 'Governança de TI';
  if (/gerencia|gerenciamento de projetos/.test(n)) return 'Gerência de Projetos';
  if (/rede/.test(n)) return 'Redes de Computadores';
  if (/algoritmo|estrutura de dados/.test(n)) return 'Algoritmos e Estrutura de Dados';
  if (/telecom/.test(n)) return 'Telecomunicações';
  if (/historia/.test(n)) return 'História';
  if (/geografia/.test(n)) return 'Geografia';
  return String(value || 'Não classificado').trim();
}

const TOPIC_ALIASES = [
  [/interpretacao|compreensao.*texto|inferencia/, 'Interpretação e compreensão textual'],
  [/coesao|conectiv/, 'Coesão e conectivos'],
  [/concordancia/, 'Concordância verbal e nominal'],
  [/colocacao pronominal/, 'Colocação pronominal'],
  [/\bsql\b|structured query|join|subquer|group by/, 'SQL'],
  [/cobit/, 'COBIT'], [/pmbok/, 'PMBOK'], [/uml/, 'UML'],
  [/sistema.*numer|conversao.*base/, 'Sistemas de Numeração'],
  [/hierarquia.*memoria|memoria|cache/, 'Memórias e hierarquia de memória'],
  [/modo.*enderec/, 'Modos de Endereçamento'],
  [/java/, 'Java'], [/python/, 'Python'], [/php/, 'PHP'], [/c\+\+/, 'C++'],
  [/linux/, 'Linux'], [/shell/, 'Shell Script'],
  [/data warehouse|olap/, 'Data Warehouse'],
  [/entidade.*relacion|\bder\b/, 'Modelo Entidade-Relacionamento'],
  [/algebra booleana/, 'Álgebra Booleana'],
  [/agropecuaria/, 'Agropecuária Brasileira'],
  [/dominio.*morfoclim/, 'Domínios Morfoclimáticos'],
  [/brasil colonial|colonia/, 'História do Brasil Colonial'],
  [/brasil imperio|imperio/, 'História do Brasil Império']
];

function canonicalTopic(topic) {
  const n = normalize(topic);
  const hit = TOPIC_ALIASES.find(([re]) => re.test(n));
  return hit ? hit[1] : String(topic || 'Não classificado').trim();
}

function keyOf(discipline, topic) {
  return `${normalize(canonicalDiscipline(discipline))}||${normalize(canonicalTopic(topic))}`;
}

function tokenSet(text) {
  return new Set(normalize(text).split(' ').filter(t => t.length > 3));
}

function jaccard(a, b) {
  const A = tokenSet(a), B = tokenSet(b);
  if (!A.size || !B.size) return 0;
  let intersection = 0;
  for (const token of A) if (B.has(token)) intersection++;
  return intersection / (A.size + B.size - intersection);
}

async function getHistoricalQuestions(userId) {
  return db.query(`SELECT q.id,q.discipline,q.topic,q.statement,q.number,e.ano FROM questions q JOIN exams e ON e.id=q.exam_id WHERE q.source!='ai_practice' AND (e.user_id IS NULL OR e.user_id=$1) ORDER BY e.ano,q.number`, [userId]);
}

function aggregateHistory(questions) {
  const map = new Map();
  for (const q of questions) {
    const discipline = canonicalDiscipline(q.discipline);
    const topic = canonicalTopic(q.topic);
    const key = keyOf(discipline, topic);
    const item = map.get(key) || { discipline, topic, occurrences: 0, years: new Set(), last_year: 0, questionIds: [] };
    item.occurrences++;
    if (q.ano) item.years.add(Number(q.ano));
    item.last_year = Math.max(item.last_year, Number(q.ano) || 0);
    item.questionIds.push(q.id);
    map.set(key, item);
  }
  return [...map.values()].map(item => ({ ...item, years: [...item.years].sort(), years_count: item.years.size }));
}

async function rebuildSimilarity(userId) {
  const questions = await getHistoricalQuestions(userId);
  const pairs = [];
  for (let i = 0; i < questions.length; i++) {
    for (let j = i + 1; j < questions.length; j++) {
      const a = questions[i], b = questions[j];
      if (!a.ano || !b.ano || a.ano === b.ano) continue;
      if (canonicalDiscipline(a.discipline) !== canonicalDiscipline(b.discipline)) continue;
      const sameTopic = canonicalTopic(a.topic) === canonicalTopic(b.topic);
      const lexical = jaccard(a.statement, b.statement);
      const similarity = Math.min(1, lexical + (sameTopic ? 0.32 : 0));
      if ((!sameTopic && similarity < 0.58) || (sameTopic && similarity < 0.48)) continue;
      pairs.push({ a: a.id, b: b.id, similarity, type: similarity >= 0.82 ? 'reformulada' : sameTopic ? 'conceitual' : 'estrutural' });
    }
  }
  await db.transaction(async client => {
    await client.query('DELETE FROM question_similarity');
    for (const p of pairs) {
      await client.query(`INSERT INTO question_similarity(question_a_id,question_b_id,similarity,relation_type) VALUES($1,$2,$3,$4) ON CONFLICT(question_a_id,question_b_id) DO UPDATE SET similarity=EXCLUDED.similarity,relation_type=EXCLUDED.relation_type,calculated_at=CURRENT_TIMESTAMP`, [p.a, p.b, p.similarity, p.type]);
    }
  });
  return pairs.length;
}

async function getRecurrences(userId, limit = 50) {
  const aggregated = aggregateHistory(await getHistoricalQuestions(userId));
  return aggregated.filter(x => x.years_count >= 2).sort((a, b) => b.years_count - a.years_count || b.occurrences - a.occurrences).slice(0, limit);
}

async function getRepeatedQuestions(userId, limit = 60) {
  return db.query(`SELECT qs.similarity,qs.relation_type,qa.id a_id,qa.statement a_statement,qa.discipline,qa.topic,ea.ano a_year,qb.id b_id,qb.statement b_statement,eb.ano b_year FROM question_similarity qs JOIN questions qa ON qa.id=qs.question_a_id JOIN questions qb ON qb.id=qs.question_b_id LEFT JOIN exams ea ON ea.id=qa.exam_id LEFT JOIN exams eb ON eb.id=qb.exam_id WHERE (ea.user_id IS NULL OR ea.user_id=$1) AND (eb.user_id IS NULL OR eb.user_id=$1) ORDER BY qs.similarity DESC LIMIT $2`, [userId, limit]);
}

async function getPriorityMatrix(userId, limit = 40) {
  const history = aggregateHistory(await getHistoricalQuestions(userId));
  const editalRows = await db.query(`SELECT et.discipline,et.topic,MAX(et.weight)::numeric weight FROM edital_topics et JOIN editais e ON e.id=et.edital_id WHERE e.user_id=$1 AND e.id=(SELECT id FROM editais WHERE user_id=$1 ORDER BY ano DESC,created_at DESC LIMIT 1) GROUP BY et.discipline,et.topic`, [userId]);
  const masteryRows = await db.query('SELECT discipline,topic,mastery_score,attempts FROM topic_mastery WHERE user_id=$1', [userId]);
  const editalMap = new Map(editalRows.map(x => [keyOf(x.discipline, x.topic), Number(x.weight) || 1]));
  const masteryMap = new Map(masteryRows.map(x => [keyOf(x.discipline, x.topic), { score: Number(x.mastery_score) || 0, attempts: Number(x.attempts) || 0 }]));
  const maxYear = Math.max(...history.map(x => x.last_year), 0);
  const maxOccurrences = Math.max(...history.map(x => x.occurrences), 1);
  return history.map(item => {
    const key = keyOf(item.discipline, item.topic);
    const editalWeight = editalMap.get(key) || 0;
    const mastery = masteryMap.get(key) || { score: 0, attempts: 0 };
    const coverageScore = Math.min(35, item.years_count * 7);
    const frequencyScore = Math.min(15, (item.occurrences / maxOccurrences) * 15);
    const recencyGap = Math.max(0, maxYear - item.last_year);
    const recencyScore = Math.max(0, 15 - recencyGap * 4);
    const editalScore = editalWeight ? Math.min(20, editalWeight * 10) : 0;
    const weaknessScore = mastery.attempts ? ((100 - mastery.score) / 100) * 15 : 9;
    const priority_score = Math.round(Math.min(100, coverageScore + frequencyScore + recencyScore + editalScore + weaknessScore));
    return { ...item, edital_weight: editalWeight, mastery_score: mastery.score, attempts: mastery.attempts, priority_score, evidence: `${item.years_count} ano(s), ${item.occurrences} questão(ões), última cobrança ${item.last_year}${editalWeight ? ', presente no último edital importado' : ''}.` };
  }).sort((a, b) => b.priority_score - a.priority_score || b.years_count - a.years_count).slice(0, limit);
}

async function recordAttempt({ userId, questionId, letter, source = 'treino' }) {
  const q = await db.one('SELECT id,discipline,topic,correct_letter FROM questions WHERE id=$1', [questionId]);
  if (!q) throw new Error('Questão não encontrada.');
  const correct = q.correct_letter ? String(letter).toUpperCase() === String(q.correct_letter).toUpperCase() : null;
  const discipline = canonicalDiscipline(q.discipline);
  const topic = canonicalTopic(q.topic || q.discipline);
  await db.transaction(async client => {
    await client.query('INSERT INTO question_attempts(user_id,question_id,chosen_letter,correct,source) VALUES($1,$2,$3,$4,$5)', [userId, q.id, letter, correct, source]);
    await client.query(`INSERT INTO topic_mastery(user_id,discipline,topic,attempts,correct_answers,mastery_score,last_attempt_at) VALUES($1,$2,$3,1,$4,$5,CURRENT_TIMESTAMP) ON CONFLICT(user_id,discipline,topic) DO UPDATE SET attempts=topic_mastery.attempts+1,correct_answers=topic_mastery.correct_answers+$4,mastery_score=ROUND(((topic_mastery.correct_answers+$4)::numeric/(topic_mastery.attempts+1))*100,2),last_attempt_at=CURRENT_TIMESTAMP`, [userId, discipline, topic, correct ? 1 : 0, correct ? 100 : 0]);
  });
  return { correct, correctLetter: q.correct_letter };
}

module.exports = { canonicalDiscipline, canonicalTopic, rebuildSimilarity, getRecurrences, getRepeatedQuestions, getPriorityMatrix, recordAttempt };
