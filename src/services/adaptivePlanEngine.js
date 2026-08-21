const db = require('../db/db');
const { canonicalDiscipline, canonicalTopic } = require('./intelligenceEngine');

const FREE_RESOURCES = [
  { test:/sql|join|select|where|like|group by|subquer|transa|concorr/i, title:'PostgreSQL — Tutorial SQL oficial', url:'https://www.postgresql.org/docs/current/tutorial-sql.html', provider:'PostgreSQL', kind:'documentação + prática' },
  { test:/java|poo|classe|objeto|heran|polimorf|cole/i, title:'Dev.java — Learn Java', url:'https://dev.java/learn/', provider:'Oracle/OpenJDK', kind:'curso oficial gratuito' },
  { test:/python|lista|tupla|dicion|slicing/i, title:'Python — Tutorial oficial', url:'https://docs.python.org/3/tutorial/', provider:'Python Software Foundation', kind:'tutorial oficial gratuito' },
  { test:/php/i, title:'PHP — Manual oficial em português', url:'https://www.php.net/manual/pt_BR/', provider:'PHP', kind:'manual oficial gratuito' },
  { test:/linux|chmod|chown|permiss|shell|grep|arquivo/i, title:'GNU Coreutils — Manual oficial', url:'https://www.gnu.org/software/coreutils/manual/coreutils.html', provider:'GNU', kind:'manual oficial gratuito' },
  { test:/arquitetura|cpu|memoria|cache|barramento|raid|sistema.*numer/i, title:'UNIVESP — Arquitetura e Organização de Computadores', url:'https://www.youtube.com/watch?v=zStcn5aMLug', provider:'UNIVESP', kind:'videoaula universitária gratuita' },
  { test:/tipologia|interpret|compreens|coesao|coerencia|conectiv/i, title:'LAC Concursos — Tipologia e interpretação de textos', url:'https://www.youtube.com/watch?v=LbP2OfuObBM', provider:'LAC Concursos', kind:'videoaula gratuita' },
  { test:/uml|engenharia.*software|caso.*uso|diagrama/i, title:'UNIVESP — Engenharia de Software', url:'https://www.youtube.com/results?search_query=UNIVESP+Engenharia+de+Software+UML', provider:'UNIVESP', kind:'videoaulas gratuitas' },
  { test:/rede|tcp|ip|dns|http|osi|sub.?rede/i, title:'Bóson Treinamentos — Redes de Computadores', url:'https://www.youtube.com/results?search_query=B%C3%B3son+Treinamentos+redes+de+computadores+TCP%2FIP', provider:'Bóson Treinamentos', kind:'videoaulas gratuitas' },
  { test:/seguran|criptograf|hash|autentica|certific/i, title:'Bóson Treinamentos — Segurança da Informação', url:'https://www.youtube.com/results?search_query=B%C3%B3son+Treinamentos+seguran%C3%A7a+da+informa%C3%A7%C3%A3o+criptografia', provider:'Bóson Treinamentos', kind:'videoaulas gratuitas' },
  { test:/pmbok|projeto|escopo|risco|stakeholder/i, title:'YouTube — PMBOK para concursos', url:'https://www.youtube.com/results?search_query=PMBOK+concursos+videoaula', provider:'YouTube', kind:'videoaulas gratuitas' },
  { test:/cobit|itil|governan/i, title:'YouTube — COBIT/ITIL para concursos', url:'https://www.youtube.com/results?search_query=COBIT+ITIL+concursos+videoaula', provider:'YouTube', kind:'videoaulas gratuitas' },
  { test:/historia|colonial|imperio|republica|vargas/i, title:'YouTube — História do Brasil para concursos', url:'https://www.youtube.com/results?search_query=Hist%C3%B3ria+do+Brasil+concursos+videoaula', provider:'YouTube', kind:'videoaulas gratuitas' },
  { test:/geografia|morfoclim|popula|regionaliza|agropec/i, title:'YouTube — Geografia do Brasil para concursos', url:'https://www.youtube.com/results?search_query=Geografia+do+Brasil+concursos+videoaula', provider:'YouTube', kind:'videoaulas gratuitas' }
];

const MICROTOPICS = [
  { test:/raid/i, items:['RAID 0: striping e desempenho','RAID 1: espelhamento','RAID 4: paridade dedicada','RAID 5: paridade distribuída e capacidade útil','RAID 6: dupla paridade','RAID 10: espelhamento + striping','cálculo de capacidade e tolerância a falhas'] },
  { test:/sistemas? de numera/i, items:['conversão binário ↔ decimal','hexadecimal e octal','complemento de dois','representação de inteiros com sinal','aritmética binária e overflow'] },
  { test:/sql/i, items:['SELECT, WHERE e operadores','LIKE e padrões','INNER/LEFT/RIGHT/FULL JOIN','GROUP BY, HAVING e agregações','subconsultas','DDL x DML','chaves e integridade referencial','transações e isolamento'] },
  { test:/controle de concorr/i, items:['ACID e isolamento','anomalias: dirty/non-repeatable/phantom read','locks e bloqueios','serialização','deadlock','MVCC'] },
  { test:/linux/i, items:['permissões rwx e notação octal','chmod, chown e chgrp','processos: ps, top, kill','sistema de arquivos e links','pipes e redirecionamento','grep/find e filtros','usuários e grupos'] },
  { test:/shell/i, items:['variáveis e expansão','if/case','for/while','test e operadores','pipes/redirecionamentos','grep/sed/awk básicos'] },
  { test:/java/i, items:['modificadores de acesso','final/static/abstract','herança e polimorfismo','interfaces','String e imutabilidade','collections','exceções','sobrecarga x sobrescrita'] },
  { test:/php/i, items:['tipos e operadores','arrays associativos','strings','funções','POO','superglobais','sessões/cookies','acesso a banco/PDO'] },
  { test:/uml/i, items:['diagramas estruturais x comportamentais','diagrama de classes','visibilidade e multiplicidade','casos de uso','sequência','atividade','relacionamentos: associação/agregação/composição/generalização'] },
  { test:/pmbok/i, items:['princípios e domínios de desempenho','escopo','cronograma','custos','riscos','stakeholders','mudanças e integração','processos/artefatos cobrados no edital'] },
  { test:/cobit/i, items:['princípios do framework','objetivos de governança e gestão','EDM/APO/BAI/DSS/MEA','componentes do sistema de governança','metas em cascata','níveis/capacidade quando previstos no edital'] },
  { test:/tipologia textual/i, items:['narração','descrição','dissertação expositiva','dissertação argumentativa','injunção','finalidade e predominância textual'] },
  { test:/coes[aã]o|conectiv/i, items:['referenciação','substituição e elipse','conjunções e relações semânticas','coesão lexical','valor argumentativo dos conectivos'] },
  { test:/historia do brasil colonial/i, items:['administração colonial','economia açucareira','mineração','escravidão','expansão territorial','revoltas coloniais','crise do sistema colonial'] },
  { test:/historia do brasil imp/i, items:['Primeiro Reinado','Período Regencial','Segundo Reinado','café e escravidão','Guerra do Paraguai','abolição','crise da monarquia'] },
  { test:/historia do brasil rep/i, items:['República Velha','Era Vargas','República de 1946','regime militar','redemocratização','Constituição de 1988'] },
  { test:/dom[ií]nios morfoclim/i, items:['Amazônico','Cerrado','Caatinga','Mares de Morros','Araucárias','Pradarias','faixas de transição'] }
];

function normalize(v){return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();}
function getResource(discipline, topic, microtopic=''){
  const haystack=normalize(`${discipline} ${topic} ${microtopic}`);
  const hit=FREE_RESOURCES.find(r=>r.test.test(haystack));
  if(hit) return hit;
  return { title:`Pesquisa focada: ${microtopic||topic}`, url:`https://www.youtube.com/results?search_query=${encodeURIComponent(`${microtopic||topic} ${discipline} concurso VUNESP aula`)}`, provider:'YouTube', kind:'busca focada gratuita' };
}
function getMicrotopics(discipline, topic){
  const haystack=normalize(`${discipline} ${topic}`);
  const hit=MICROTOPICS.find(m=>m.test.test(haystack));
  return hit ? hit.items : [String(topic),`conceitos fundamentais de ${topic}`,`aplicações e pegadinhas de ${topic}`,`questões VUNESP sobre ${topic}`];
}

async function getChecklistState(userId, dates=[]){
  if(!dates.length) return [];
  return db.query(`SELECT * FROM study_checklist_entries WHERE user_id=$1 AND study_date = ANY($2::date[]) ORDER BY study_date, id`,[userId,dates]);
}

async function getAdaptiveSignals(userId){
  const rows=await db.query(`WITH checklist AS (
    SELECT discipline,topic,COUNT(*)::numeric planned,COUNT(*) FILTER(WHERE completed)::numeric done
    FROM study_checklist_entries WHERE user_id=$1 AND study_date>=CURRENT_DATE-28 GROUP BY discipline,topic
  ), attempts AS (
    SELECT q.discipline,q.topic,COUNT(*)::numeric attempts,COUNT(*) FILTER(WHERE qa.correct)::numeric correct
    FROM question_attempts qa JOIN questions q ON q.id=qa.question_id WHERE qa.user_id=$1 AND qa.answered_at>=CURRENT_DATE-28 GROUP BY q.discipline,q.topic
  ) SELECT COALESCE(c.discipline,a.discipline) discipline,COALESCE(c.topic,a.topic) topic,
    COALESCE(c.planned,0)::int planned,COALESCE(c.done,0)::int done,COALESCE(a.attempts,0)::int attempts,COALESCE(a.correct,0)::int correct
    FROM checklist c FULL JOIN attempts a ON lower(c.discipline)=lower(a.discipline) AND lower(c.topic)=lower(a.topic)`,[userId]);
  return rows.map(r=>({
    ...r,
    completionRate:r.planned?Math.round((r.done/r.planned)*100):0,
    accuracy:r.attempts?Math.round((r.correct/r.attempts)*100):0,
    weakness:Math.round(((100-(r.planned?Math.round((r.done/r.planned)*100):0))*0.45)+((100-(r.attempts?Math.round((r.correct/r.attempts)*100):0))*0.55))
  }));
}

async function getPerformanceByDiscipline(userId){
  const rows=await db.query(`WITH c AS (SELECT discipline,COUNT(*)::numeric planned,COUNT(*) FILTER(WHERE completed)::numeric done FROM study_checklist_entries WHERE user_id=$1 GROUP BY discipline), a AS (SELECT q.discipline,COUNT(*)::numeric attempts,COUNT(*) FILTER(WHERE qa.correct)::numeric correct FROM question_attempts qa JOIN questions q ON q.id=qa.question_id WHERE qa.user_id=$1 GROUP BY q.discipline) SELECT COALESCE(c.discipline,a.discipline) discipline,COALESCE(c.planned,0)::int planned,COALESCE(c.done,0)::int done,COALESCE(a.attempts,0)::int attempts,COALESCE(a.correct,0)::int correct FROM c FULL JOIN a ON lower(c.discipline)=lower(a.discipline) ORDER BY 1`,[userId]);
  return rows.map(r=>{const checklist=r.planned?Math.round(r.done/r.planned*100):0;const accuracy=r.attempts?Math.round(r.correct/r.attempts*100):0;const performance=Math.round(checklist*.4+accuracy*.6);return {...r,checklist,accuracy,performance,need:100-performance};}).sort((a,b)=>b.need-a.need);
}

async function getHistory(userId){
  return db.query(`SELECT study_date::text date,COUNT(*)::int planned,COUNT(*) FILTER(WHERE completed)::int done,ROUND((COUNT(*) FILTER(WHERE completed)::numeric/NULLIF(COUNT(*),0))*100)::int completion FROM study_checklist_entries WHERE user_id=$1 GROUP BY study_date ORDER BY study_date DESC LIMIT 28`,[userId]);
}

async function ensureChecklistForBlocks(userId, blocks, dateMap){
  for(const block of blocks){
    const studyDate=dateMap[block.day]; if(!studyDate) continue;
    const micros=getMicrotopics(block.discipline,block.topic).slice(0,4);
    const theoryMinutes=120;
    const questionMinutes=60;
    const perMicroTheory=Math.max(1,Math.floor(theoryMinutes/micros.length));
    const perMicroQuestions=Math.max(1,Math.floor(questionMinutes/micros.length));
    let theoryRemainder=theoryMinutes-(perMicroTheory*micros.length);
    let questionRemainder=questionMinutes-(perMicroQuestions*micros.length);
    for(const micro of micros){
      const resource=getResource(block.discipline,block.topic,micro);
      const theoryPlanned=perMicroTheory+(theoryRemainder-->0?1:0);
      const questionsPlanned=perMicroQuestions+(questionRemainder-->0?1:0);
      const tasks=[['teoria',theoryPlanned],['questoes',questionsPlanned]];
      for(const [taskType,plannedMinutes] of tasks){
        await db.query(`INSERT INTO study_checklist_entries(user_id,study_date,discipline,topic,microtopic,task_type,planned_minutes,resource_title,resource_url) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(user_id,study_date,discipline,topic,microtopic,task_type) DO UPDATE SET planned_minutes=EXCLUDED.planned_minutes,resource_title=EXCLUDED.resource_title,resource_url=EXCLUDED.resource_url`,[userId,studyDate,canonicalDiscipline(block.discipline),canonicalTopic(block.topic),micro,taskType,plannedMinutes,resource.title,resource.url]);
      }
    }
  }
}

module.exports={getResource,getMicrotopics,getChecklistState,getAdaptiveSignals,getPerformanceByDiscipline,getHistory,ensureChecklistForBlocks};
