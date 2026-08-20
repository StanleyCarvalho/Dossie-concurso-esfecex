const crypto = require('crypto');
const db = require('../db/db');
const { canonicalDiscipline, canonicalTopic, getPriorityMatrix } = require('./intelligenceEngine');
const { analyzeDifficultyBatch, generateEvidenceBoundPredictions } = require('./predictionAiService');

function keyOf(d,t){return `${String(canonicalDiscipline(d)).toLowerCase()}||${String(canonicalTopic(t)).toLowerCase()}`}

function normalizePossibleQuestion(value) {
  let q = value;
  if (typeof q === 'string') {
    try { q = JSON.parse(q); } catch { return null; }
  }
  if (!q || typeof q !== 'object') return null;
  const statement = String(q.statement || '').trim();
  const alternatives = q.alternatives && typeof q.alternatives === 'object' ? q.alternatives : {};
  const normalizedAlternatives = {};
  for (const letter of ['A','B','C','D','E']) {
    const text = String(alternatives[letter] || alternatives[letter.toLowerCase()] || '').trim();
    if (!text) return null;
    normalizedAlternatives[letter] = text;
  }
  const correctLetter = String(q.correct_letter || '').toUpperCase();
  if (!statement || !['A','B','C','D','E'].includes(correctLetter)) return null;
  return {
    statement,
    alternatives: normalizedAlternatives,
    correct_letter: correctLetter,
    explanation: String(q.explanation || '').trim()
  };
}

async function calibrateDifficulty(userId, limit = 60) {
  const rows = await db.query(`SELECT q.id,q.discipline,q.topic,q.statement,q.alt_a,q.alt_b,q.alt_c,q.alt_d,q.alt_e,e.ano FROM questions q JOIN exams e ON e.id=q.exam_id LEFT JOIN question_ai_analysis a ON a.question_id=q.id WHERE q.source!='ai_practice' AND (e.user_id IS NULL OR e.user_id=$1) AND a.question_id IS NULL ORDER BY e.ano DESC,q.number LIMIT $2`,[userId,limit]);
  if(!rows.length) return 0;
  const batch = await analyzeDifficultyBatch(rows);
  const validIds = new Set(rows.map(r=>Number(r.id)));
  let saved=0;
  for(const item of batch){
    const id=Number(item.question_id); if(!validIds.has(id)) continue;
    const minutes=Math.max(.5,Math.min(60,Number(item.estimated_minutes)||3));
    let difficulty=String(item.difficulty||'médio').toLowerCase();
    if(minutes>20) difficulty='impossível';
    if(!['fácil','facil','médio','medio','difícil','dificil','impossível','impossivel'].includes(difficulty)) difficulty='médio';
    difficulty=difficulty.normalize('NFD').replace(/[\u0300-\u036f]/g,'')==='facil'?'fácil':difficulty.normalize('NFD').replace(/[\u0300-\u036f]/g,'')==='medio'?'médio':difficulty.normalize('NFD').replace(/[\u0300-\u036f]/g,'')==='dificil'?'difícil':difficulty.startsWith('imposs')?'impossível':difficulty;
    await db.query(`INSERT INTO question_ai_analysis(question_id,difficulty,estimated_minutes,cognitive_level,style_signature,reasoning,confidence,analyzed_at) VALUES($1,$2,$3,$4,$5,$6,$7,CURRENT_TIMESTAMP) ON CONFLICT(question_id) DO UPDATE SET difficulty=EXCLUDED.difficulty,estimated_minutes=EXCLUDED.estimated_minutes,cognitive_level=EXCLUDED.cognitive_level,style_signature=EXCLUDED.style_signature,reasoning=EXCLUDED.reasoning,confidence=EXCLUDED.confidence,analyzed_at=CURRENT_TIMESTAMP`,[id,difficulty,minutes,item.cognitive_level||null,item.style_signature||null,item.reasoning||null,Math.max(0,Math.min(100,Number(item.confidence)||70))]);
    saved++;
  }
  return saved;
}

async function getDifficultySummary(userId){
  return db.query(`SELECT a.difficulty,COUNT(*)::int total,ROUND(AVG(a.estimated_minutes),1) avg_minutes FROM question_ai_analysis a JOIN questions q ON q.id=a.question_id JOIN exams e ON e.id=q.exam_id WHERE e.user_id IS NULL OR e.user_id=$1 GROUP BY a.difficulty ORDER BY CASE a.difficulty WHEN 'fácil' THEN 1 WHEN 'médio' THEN 2 WHEN 'difícil' THEN 3 ELSE 4 END`,[userId]);
}

async function getRepeatedByTopic(userId){
  return db.query(`SELECT q.discipline,q.topic,COUNT(*)::int occurrences,COUNT(DISTINCT e.ano)::int years_count,array_agg(DISTINCT e.ano ORDER BY e.ano) years,array_agg(q.id ORDER BY e.ano DESC) question_ids FROM questions q JOIN exams e ON e.id=q.exam_id WHERE q.source!='ai_practice' AND (e.user_id IS NULL OR e.user_id=$1) GROUP BY q.discipline,q.topic HAVING COUNT(DISTINCT e.ano)>=2 ORDER BY years_count DESC,occurrences DESC,q.discipline,q.topic`,[userId]);
}

async function generatePredictionRun(userId,targetYear=2027){
  const priorities=await getPriorityMatrix(userId,30);
  const allowed=new Map(priorities.map(p=>[keyOf(p.discipline,p.topic),p]));
  const samples=await db.query(`SELECT q.id,q.discipline,q.topic,q.statement,q.alt_a,q.alt_b,q.alt_c,q.alt_d,q.alt_e,q.correct_letter,q.style_notes,e.ano,a.difficulty,a.estimated_minutes FROM questions q JOIN exams e ON e.id=q.exam_id LEFT JOIN question_ai_analysis a ON a.question_id=q.id WHERE q.source!='ai_practice' AND (e.user_id IS NULL OR e.user_id=$1) ORDER BY e.ano DESC,q.number LIMIT 180`,[userId]);
  const topicEvidence=priorities.map(p=>({discipline:p.discipline,topic:p.topic,priority_score:p.priority_score,years:p.years,years_count:p.years_count,occurrences:p.occurrences,last_year:p.last_year,edital_weight:p.edital_weight,evidence:p.evidence}));
  const raw=await generateEvidenceBoundPredictions({targetYear,topics:topicEvidence,samples});
  const validated=[];
  for(const item of raw){
    const p=allowed.get(keyOf(item.discipline,item.topic)); if(!p) continue;
    const possibleQuestion=normalizePossibleQuestion(item.possible_question); if(!possibleQuestion) continue;
    const validSamples=samples.filter(s=>keyOf(s.discipline,s.topic)===keyOf(p.discipline,p.topic));
    const allowedIds=new Set(validSamples.map(s=>Number(s.id)));
    const ids=(Array.isArray(item.evidence_question_ids)?item.evidence_question_ids:[]).map(Number).filter(id=>allowedIds.has(id));
    const years=[...new Set(validSamples.filter(s=>ids.includes(Number(s.id))).map(s=>Number(s.ano)).filter(Boolean))];
    if(!ids.length){ ids.push(...validSamples.slice(0,3).map(s=>Number(s.id))); years.push(...validSamples.slice(0,3).map(s=>Number(s.ano)).filter(Boolean)); }
    const evidenceCap=Math.min(92,45+(p.years_count*7)+(Math.min(p.occurrences,6)*3)+(p.edital_weight?8:0));
    const confidence=Math.min(evidenceCap,Math.max(20,Number(item.confidence)||50));
    const minutes=Math.max(.5,Math.min(60,Number(item.estimated_minutes)||4));
    const difficulty=minutes>20?'impossível':(['fácil','médio','difícil'].includes(String(item.difficulty).toLowerCase())?String(item.difficulty).toLowerCase():'médio');
    validated.push({...item,possible_question:possibleQuestion,rank:validated.length+1,discipline:p.discipline,topic:p.topic,confidence,estimated_minutes:minutes,difficulty,evidence_years:[...new Set(years)],evidence_question_ids:[...new Set(ids)]});
    if(validated.length>=30) break;
  }
  const hash=crypto.createHash('sha256').update(JSON.stringify({topicEvidence,samples:samples.map(s=>[s.id,s.ano,s.topic])})).digest('hex');
  const run=await db.one(`INSERT INTO prediction_runs(user_id,target_year,evidence_hash,model_name) VALUES($1,$2,$3,$4) RETURNING id,created_at`,[userId,targetYear,hash,process.env.GEMINI_MODEL||'gemini-3.6-flash']);
  for(const x of validated) await db.query(`INSERT INTO predicted_question_blueprints(run_id,rank,discipline,topic,difficulty,estimated_minutes,confidence,likely_charge,likely_format,likely_trap,possible_question,answer_focus,evidence_years,evidence_question_ids) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb)`,[run.id,x.rank,x.discipline,x.topic,x.difficulty,x.estimated_minutes,x.confidence,x.likely_charge||'',x.likely_format||'',x.likely_trap||null,JSON.stringify(x.possible_question),x.answer_focus||null,JSON.stringify(x.evidence_years),JSON.stringify(x.evidence_question_ids)]);
  return run.id;
}

async function getLatestPrediction(userId,targetYear=2027){
  const run=await db.one(`SELECT * FROM prediction_runs WHERE user_id=$1 AND target_year=$2 ORDER BY created_at DESC LIMIT 1`,[userId,targetYear]);
  if(!run) return {run:null,items:[]};
  const rows=await db.query(`SELECT * FROM predicted_question_blueprints WHERE run_id=$1 ORDER BY rank`,[run.id]);
  const items=rows.map(x=>({...x,possible_question_data:normalizePossibleQuestion(x.possible_question)}));
  return {run,items};
}

module.exports={calibrateDifficulty,getDifficultySummary,getRepeatedByTopic,generatePredictionRun,getLatestPrediction,normalizePossibleQuestion};
