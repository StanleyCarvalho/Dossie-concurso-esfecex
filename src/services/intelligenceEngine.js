const db = require('../db/db');

function normalize(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

const TOPIC_ALIASES = [
  [/interpretacao|compreensao.*texto|inferencia/, 'Interpretação e compreensão textual'],
  [/sql|structured query/, 'SQL'],
  [/cobit/, 'COBIT'],
  [/pmbok/, 'PMBOK'],
  [/uml/, 'UML'],
  [/sistema.*numer|conversao.*base/, 'Sistemas de Numeração'],
  [/memoria|cache/, 'Memórias e hierarquia de memória'],
  [/java/, 'Java'], [/python/, 'Python'], [/php/, 'PHP'],
  [/linux/, 'Linux'], [/shell/, 'Shell Script'],
  [/data warehouse|olap/, 'Data Warehouse'],
  [/entidade.*relacion|\bder\b/, 'Modelo Entidade-Relacionamento']
];

function canonicalTopic(topic) {
  const n = normalize(topic);
  const hit = TOPIC_ALIASES.find(([re]) => re.test(n));
  return hit ? hit[1] : String(topic || 'Não classificado').trim();
}

function tokenSet(text) {
  return new Set(normalize(text).split(' ').filter(t => t.length > 3));
}

function jaccard(a, b) {
  const A = tokenSet(a); const B = tokenSet(b);
  if (!A.size || !B.size) return 0;
  let intersection = 0;
  for (const t of A) if (B.has(t)) intersection++;
  return intersection / (A.size + B.size - intersection);
}

async function rebuildSimilarity(userId) {
  const questions = await db.query(`SELECT q.id,q.discipline,q.topic,q.statement,e.ano FROM questions q LEFT JOIN exams e ON e.id=q.exam_id WHERE q.source!='ai_practice' AND (e.user_id IS NULL OR e.user_id=$1) ORDER BY e.ano,q.number`, [userId]);
  const pairs = [];
  for (let i=0;i<questions.length;i++) for (let j=i+1;j<questions.length;j++) {
    const a=questions[i], b=questions[j];
    if (!a.ano || !b.ano || a.ano===b.ano || a.discipline!==b.discipline) continue;
    const sameTopic = canonicalTopic(a.topic) === canonicalTopic(b.topic);
    const lexical = jaccard(a.statement,b.statement);
    const similarity = Math.min(1, lexical + (sameTopic ? 0.35 : 0));
    if (similarity < 0.48) continue;
    pairs.push({a:a.id,b:b.id,similarity,type: similarity>=0.82?'reformulada':sameTopic?'conceitual':'estrutural'});
  }
  await db.transaction(async client => {
    await client.query(`DELETE FROM question_similarity qs USING questions qa, questions qb, exams ea, exams eb WHERE qs.question_a_id=qa.id AND qs.question_b_id=qb.id AND qa.exam_id=ea.id AND qb.exam_id=eb.id AND (ea.user_id=$1 OR eb.user_id=$1 OR (ea.user_id IS NULL AND eb.user_id IS NULL))`, [userId]);
    for (const p of pairs) await client.query(`INSERT INTO question_similarity(question_a_id,question_b_id,similarity,relation_type) VALUES($1,$2,$3,$4) ON CONFLICT(question_a_id,question_b_id) DO UPDATE SET similarity=EXCLUDED.similarity,relation_type=EXCLUDED.relation_type,calculated_at=CURRENT_TIMESTAMP`,[p.a,p.b,p.similarity,p.type]);
  });
  return pairs.length;
}

async function getRecurrences(userId, limit=50) {
  return db.query(`SELECT q.discipline,q.topic,COUNT(*)::int occurrences,COUNT(DISTINCT e.ano)::int years_count,array_agg(DISTINCT e.ano ORDER BY e.ano) years FROM questions q JOIN exams e ON e.id=q.exam_id WHERE q.source!='ai_practice' AND (e.user_id IS NULL OR e.user_id=$1) GROUP BY q.discipline,q.topic HAVING COUNT(DISTINCT e.ano)>=2 ORDER BY years_count DESC,occurrences DESC LIMIT $2`,[userId,limit]);
}

async function getRepeatedQuestions(userId, limit=60) {
  return db.query(`SELECT qs.similarity,qs.relation_type,qa.id a_id,qa.statement a_statement,qa.discipline,qa.topic,ea.ano a_year,qb.id b_id,qb.statement b_statement,eb.ano b_year FROM question_similarity qs JOIN questions qa ON qa.id=qs.question_a_id JOIN questions qb ON qb.id=qs.question_b_id LEFT JOIN exams ea ON ea.id=qa.exam_id LEFT JOIN exams eb ON eb.id=qb.exam_id WHERE (ea.user_id IS NULL OR ea.user_id=$1) AND (eb.user_id IS NULL OR eb.user_id=$1) ORDER BY qs.similarity DESC LIMIT $2`,[userId,limit]);
}

async function getPriorityMatrix(userId, limit=40) {
  return db.query(`WITH hist AS (SELECT q.discipline,q.topic,COUNT(*)::numeric occurrences,COUNT(DISTINCT e.ano)::numeric years_count,MAX(e.ano)::numeric last_year FROM questions q JOIN exams e ON e.id=q.exam_id WHERE q.source!='ai_practice' AND (e.user_id IS NULL OR e.user_id=$1) GROUP BY q.discipline,q.topic), ed AS (SELECT et.discipline,et.topic,MAX(et.weight)::numeric edital_weight FROM edital_topics et JOIN editais e ON e.id=et.edital_id WHERE e.user_id=$1 GROUP BY et.discipline,et.topic), mastery AS (SELECT discipline,topic,mastery_score FROM topic_mastery WHERE user_id=$1) SELECT h.discipline,h.topic,h.occurrences::int,h.years_count::int,h.last_year::int,COALESCE(ed.edital_weight,0) edital_weight,COALESCE(m.mastery_score,0) mastery_score,LEAST(100,ROUND((h.years_count*12)+(h.occurrences*3)+(CASE WHEN h.last_year>=2025 THEN 12 ELSE 0 END)+(COALESCE(ed.edital_weight,0)*18)+(100-COALESCE(m.mastery_score,0))*0.18))::int priority_score FROM hist h LEFT JOIN ed ON lower(ed.discipline)=lower(h.discipline) AND lower(ed.topic)=lower(h.topic) LEFT JOIN mastery m ON lower(m.discipline)=lower(h.discipline) AND lower(m.topic)=lower(h.topic) ORDER BY priority_score DESC LIMIT $2`,[userId,limit]);
}

async function recordAttempt({userId,questionId,letter,source='treino'}) {
  const q=await db.one('SELECT id,discipline,topic,correct_letter FROM questions WHERE id=$1',[questionId]);
  if(!q) throw new Error('Questão não encontrada.');
  const correct=q.correct_letter ? String(letter).toUpperCase()===String(q.correct_letter).toUpperCase() : null;
  await db.transaction(async client=>{
    await client.query('INSERT INTO question_attempts(user_id,question_id,chosen_letter,correct,source) VALUES($1,$2,$3,$4,$5)',[userId,q.id,letter,correct,source]);
    await client.query(`INSERT INTO topic_mastery(user_id,discipline,topic,attempts,correct_answers,mastery_score,last_attempt_at) VALUES($1,$2,$3,1,$4,$5,CURRENT_TIMESTAMP) ON CONFLICT(user_id,discipline,topic) DO UPDATE SET attempts=topic_mastery.attempts+1,correct_answers=topic_mastery.correct_answers+$4,mastery_score=ROUND(((topic_mastery.correct_answers+$4)::numeric/(topic_mastery.attempts+1))*100,2),last_attempt_at=CURRENT_TIMESTAMP`,[userId,q.discipline,q.topic||q.discipline,correct?1:0,correct?100:0]);
  });
  return {correct,correctLetter:q.correct_letter};
}

module.exports={canonicalTopic,rebuildSimilarity,getRecurrences,getRepeatedQuestions,getPriorityMatrix,recordAttempt};
