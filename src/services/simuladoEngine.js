const db = require('../db/db');
const { generatePracticeQuestions } = require('./aiService');

function shuffle(arr) {
  const a=[...arr];
  for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}
  return a;
}

async function getBlueprint(totalQuestions=50,userId=null) {
  if(!userId) return [];
  const rows=await db.query(`SELECT ds.discipline,SUM(ds.num_questions)::int total,COUNT(DISTINCT ds.exam_id)::int exams FROM discipline_stats ds JOIN exams e ON e.id=ds.exam_id WHERE e.user_id=$1 GROUP BY ds.discipline`,[userId]);
  const grandTotal=rows.reduce((s,r)=>s+r.total,0);
  if(grandTotal===0)return[];
  return rows.map(r=>({discipline:r.discipline,proportion:r.total/grandTotal,target:Math.max(1,Math.round((r.total/grandTotal)*totalQuestions))})).sort((a,b)=>b.target-a.target);
}

async function buildSimulado({totalQuestions=50,durationMinutes=240,useAiFill=true,userId=null}) {
  if(!userId) throw new Error('Usuário não identificado.');
  const blueprint=await getBlueprint(totalQuestions,userId);
  if(blueprint.length===0)throw new Error('Seu acervo ainda não possui provas suficientes para montar o simulado. Importe suas provas primeiro.');
  let diff=totalQuestions-blueprint.reduce((s,b)=>s+b.target,0),i=0;
  while(diff!==0&&blueprint.length>0){blueprint[i%blueprint.length].target+=diff>0?1:-1;diff+=diff>0?-1:1;i++;}
  const selected=[];
  for(const b of blueprint){
    const real=await db.query(`SELECT q.* FROM questions q LEFT JOIN exams e ON e.id=q.exam_id WHERE q.discipline=$1 AND ((q.source='ai_practice' AND q.user_id=$3) OR (q.source<>'ai_practice' AND e.user_id=$3)) ORDER BY RANDOM() LIMIT $2`,[b.discipline,b.target,userId]);
    selected.push(...real);
    const missing=b.target-real.length;
    if(missing>0&&useAiFill){try{const generated=await generatePracticeQuestions({discipline:b.discipline,topic:b.discipline,count:missing});for(const g of generated)selected.push({...g,id:null,ai_generated:true});}catch(e){}}
  }
  const finalQuestions=shuffle(selected).slice(0,totalQuestions);
  const simulado=await db.one(`INSERT INTO simulados(title,blueprint_json,total_questions,duration_minutes,user_id) VALUES($1,$2::jsonb,$3,$4,$5) RETURNING id`,[`Simulado ESFCEx Informática - ${new Date().toLocaleDateString('pt-BR')}`,JSON.stringify(blueprint),finalQuestions.length,durationMinutes,userId]);
  await db.transaction(async client=>{
    for(const [idx,q] of finalQuestions.entries()){
      let questionId=q.id;
      if(!questionId){const result=await client.query(`INSERT INTO questions(exam_id,number,discipline,topic,statement,alt_a,alt_b,alt_c,alt_d,alt_e,correct_letter,explanation,source,user_id) VALUES(NULL,NULL,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'ai_practice',$11) RETURNING id`,[q.discipline,q.topic||q.discipline,q.statement,q.alt_a,q.alt_b,q.alt_c,q.alt_d,q.alt_e||null,q.correct_letter,q.explanation||null,userId]);questionId=result.rows[0].id;}
      await client.query('INSERT INTO simulado_questions(simulado_id,question_id,order_index) VALUES($1,$2,$3)',[simulado.id,questionId,idx+1]);
    }
  });
  return simulado.id;
}

module.exports={getBlueprint,buildSimulado};
