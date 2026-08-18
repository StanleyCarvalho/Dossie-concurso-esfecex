const db = require('../db/db');
const { fixMojibake } = require('./textService');

function canonicalDiscipline(discipline) {
  const clean = fixMojibake(discipline);
  const normalized = clean
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  if (normalized.includes('portugues') || normalized.includes('lingua portuguesa')) return 'Língua Portuguesa';
  if (normalized.includes('programacao')) return 'Programação';
  if (normalized.includes('seguranca')) return 'Segurança da Informação';
  if (normalized.includes('governanca')) return 'Governança de TI';
  if (normalized.includes('gerencia')) return 'Gerência de Projetos';
  if (normalized.includes('telecom')) return 'Telecomunicações';
  if (normalized.includes('algoritmos')) return 'Algoritmos e Estrutura de Dados';
  return clean;
}

const STUDY_MAP = {
  'Português': {
    source: 'Português com Letícia - videoaulas de gramática e interpretação para concursos',
    sourceUrl: 'https://www.youtube.com/results?search_query=Portugu%C3%AAs+com+Let%C3%ADcia+interpreta%C3%A7%C3%A3o+de+texto+concursos',
    focus: ['interpretação e inferência textual', 'sintaxe do período', 'crase', 'pronomes', 'funções do se']
  },
  'Programação': {
    source: 'Curso em Vídeo - Java Básico e Java POO',
    sourceUrl: 'https://www.cursoemvideo.com/curso/java-basico/',
    focus: ['lógica e fluxo de controle', 'classes/objetos', 'herança e polimorfismo', 'coleções', 'JDBC']
  },
  'Redes de Computadores': {
    source: 'Bóson Treinamentos - redes, TCP/IP e protocolos',
    sourceUrl: 'https://www.youtube.com/results?search_query=B%C3%B3son+Treinamentos+redes+de+computadores+TCP%2FIP',
    focus: ['TCP/IP', 'endereçamento IP', 'sub-redes', 'protocolos de aplicação', 'segurança de redes', 'QoS']
  },
  'Banco de Dados': {
    source: 'Curso em Vídeo - Banco de Dados / MySQL',
    sourceUrl: 'https://www.cursoemvideo.com/curso/mysql/',
    focus: ['DER', 'normalização', 'SQL', 'joins', 'transações', 'data warehouse']
  },
  'Sistemas Operacionais': {
    source: 'Bóson Treinamentos - Linux e sistemas operacionais',
    sourceUrl: 'https://www.youtube.com/results?search_query=B%C3%B3son+Treinamentos+Linux+comandos+sistemas+operacionais',
    focus: ['comandos Linux', 'processos', 'sistemas de arquivos', 'memória', 'permissões']
  },
  'Arquitetura de Computadores': {
    source: 'UNIVESP - Organização e Arquitetura de Computadores',
    sourceUrl: 'https://www.youtube.com/results?search_query=UNIVESP+organiza%C3%A7%C3%A3o+e+arquitetura+de+computadores',
    focus: ['memória', 'CPU', 'barramentos', 'modos de endereçamento', 'periféricos']
  },
  'Engenharia de Software': {
    source: 'UNIVESP - Engenharia de Software',
    sourceUrl: 'https://www.youtube.com/results?search_query=UNIVESP+Engenharia+de+Software+UML+teste',
    focus: ['diagramas UML', 'casos de uso', 'teste de software', 'ciclo de vida', 'métodos ágeis']
  },
  'Segurança da Informação': {
    source: 'Bóson Treinamentos - segurança da informação e criptografia',
    sourceUrl: 'https://www.youtube.com/results?search_query=B%C3%B3son+Treinamentos+seguran%C3%A7a+da+informa%C3%A7%C3%A3o+criptografia',
    focus: ['criptografia', 'autenticação', 'confidencialidade', 'integridade', 'ameaças comuns']
  },
  'Governança de TI': {
    source: 'Canal TI Exames - governança de TI, COBIT, ITIL e normas',
    sourceUrl: 'https://www.youtube.com/results?search_query=governan%C3%A7a+de+TI+COBIT+ITIL+concursos',
    focus: ['COBIT/ITIL quando constarem no edital', 'IN 4', 'processos', 'controle e gestão']
  },
  'Gerência de Projetos': {
    source: 'Videoaulas PMBOK para concursos',
    sourceUrl: 'https://www.youtube.com/results?search_query=PMBOK+gerenciamento+de+projetos+concursos+videoaula',
    focus: ['escopo', 'tempo', 'custos', 'riscos', 'partes interessadas', 'processos PMBOK']
  },
  'História': {
    source: 'Se Liga Nessa História - História do Brasil para concursos',
    sourceUrl: 'https://www.youtube.com/results?search_query=Se+Liga+Nessa+Hist%C3%B3ria+Hist%C3%B3ria+do+Brasil+concursos',
    focus: ['Brasil Colônia', 'Império', 'República', 'Era Vargas', 'regime militar']
  },
  'Geografia': {
    source: 'Brasil Escola - videoaulas de Geografia do Brasil',
    sourceUrl: 'https://www.youtube.com/results?search_query=Brasil+Escola+Geografia+do+Brasil+videoaula',
    focus: ['geografia física', 'agropecuária', 'meio ambiente', 'população', 'regionalização']
  }
};

const NORMALIZED_STUDY_MAP = Object.fromEntries(
  Object.entries(STUDY_MAP).map(([discipline, data]) => [
    fixMojibake(discipline),
    {
      source: fixMojibake(data.source),
      sourceUrl: data.sourceUrl,
      focus: data.focus.map(fixMojibake)
    }
  ])
);

const DIRECT_LESSON_MAP = [
  {
    test: /java|jdbc|programa/i,
    title: 'Curso em Video - Java Basico',
    url: 'https://www.cursoemvideo.com/curso/java-basico/'
  },
  {
    test: /poo|orientad|classe|objeto|heran|polimorf/i,
    title: 'Curso em Video - Java POO',
    url: 'https://www.cursoemvideo.com/curso/java-poo/'
  },
  {
    test: /sql|banco de dados|modelagem|der|relacional|normaliza|transa/i,
    title: 'Curso em Video - MySQL / Banco de Dados',
    url: 'https://www.cursoemvideo.com/curso/mysql/'
  },
  {
    test: /rede|tcp|ip|protocolo|qos|endere|sub-rede|subrede|arp|icmp|dns/i,
    title: 'Boson Treinamentos - Redes de Computadores',
    url: 'https://www.portalgsti.com.br/cursos/curso-gratuito-redes-boson-treinamentos/'
  },
  {
    test: /sistema operacional|linux|processo|memoria|arquivo|permiss/i,
    title: 'UNIVESP - Sistemas Operacionais',
    url: 'https://www.youtube.com/playlist?list=PLxI8Can9yAHeK7GUEGxMsqoPRmJKwI9Jw'
  },
  {
    test: /arquitetura|organiza|hardware|memoria|cpu|barramento|endere/i,
    title: 'UNIVESP - Organizacao e Arquitetura de Computadores',
    url: 'https://www.youtube.com/results?search_query=UNIVESP+Organiza%C3%A7%C3%A3o+e+Arquitetura+de+Computadores'
  },
  {
    test: /estrutura de dados|fila|pilha|lista|arvore|algoritmo/i,
    title: 'UNIVESP - Estruturas de Dados',
    url: 'https://www.youtube.com/playlist?list=PLxI8Can9yAHex0IsMeE_tzBP0WMYASaQD'
  },
  {
    test: /uml|teste|requisito|engenharia de software|caso de uso/i,
    title: 'UNIVESP - Engenharia de Software',
    url: 'https://www.youtube.com/results?search_query=UNIVESP+Engenharia+de+Software+UML+Teste'
  },
  {
    test: /seguran|criptografia|autentica|confidencialidade|integridade/i,
    title: 'Boson Treinamentos - Seguranca da Informacao',
    url: 'https://www.youtube.com/results?search_query=B%C3%B3son+Treinamentos+seguran%C3%A7a+da+informa%C3%A7%C3%A3o+criptografia'
  },
  {
    test: /pmbok|projeto|escopo|custo|risco|stakeholder/i,
    title: 'Videoaulas PMBOK para concursos',
    url: 'https://www.youtube.com/results?search_query=PMBOK+gerenciamento+de+projetos+concursos+videoaula'
  },
  {
    test: /interpreta|sintaxe|crase|pronome|portugu/i,
    title: 'Portugues para concursos - assunto focado',
    url: 'https://www.youtube.com/results?search_query=interpreta%C3%A7%C3%A3o+de+texto+VUNESP+concursos+videoaula'
  },
  {
    test: /historia|brasil colonia|imperio|republica|vargas/i,
    title: 'Historia do Brasil para concursos',
    url: 'https://www.youtube.com/results?search_query=Hist%C3%B3ria+do+Brasil+concursos+videoaula'
  },
  {
    test: /geografia|popula|agropecu|meio ambiente|fisica/i,
    title: 'Geografia do Brasil para concursos',
    url: 'https://www.youtube.com/results?search_query=Geografia+do+Brasil+concursos+videoaula'
  }
];

function getDirectLesson(discipline, topic) {
  const haystack = `${fixMojibake(discipline)} ${fixMojibake(topic)}`;
  return DIRECT_LESSON_MAP.find(item => item.test.test(haystack)) || null;
}

function buildLikelyQuestion(discipline, topic, refs = []) {
  const cleanDiscipline = fixMojibake(discipline);
  const cleanTopic = fixMojibake(topic);
  const evidence = refs.length ? `Padrao observado em ${refs.join(', ')}.` : 'Padrao inferido pela recorrencia da disciplina e do assunto.';
  const templates = {
    'Programação': {
      charge: `Leitura de codigo ou conceito aplicado de ${cleanTopic}.`,
      stem: `A questao tende a apresentar um trecho de codigo Java ou uma afirmacao conceitual e perguntar a saida, o erro, ou a alternativa correta sobre ${cleanTopic}.`,
      trap: 'Pegadinha provavel: confundir sintaxe com semantica, ordem de execucao ou conceito de POO.'
    },
    'Banco de Dados': {
      charge: `Modelagem, SQL ou conceito relacional ligado a ${cleanTopic}.`,
      stem: `A questao tende a trazer uma tabela, DER ou comando SQL e cobrar a interpretacao correta de ${cleanTopic}.`,
      trap: 'Pegadinha provavel: cardinalidade, chave, JOIN, normalizacao ou efeito real do comando.'
    },
    'Redes de Computadores': {
      charge: `Aplicacao pratica de ${cleanTopic} em redes.`,
      stem: `A questao tende a cobrar protocolo, camada, enderecamento ou comportamento de rede relacionado a ${cleanTopic}.`,
      trap: 'Pegadinha provavel: trocar camada OSI/TCP-IP, confundir protocolo ou errar intervalo/endereco.'
    },
    'Português': {
      charge: `Interpretacao ou gramatica aplicada ao texto em ${cleanTopic}.`,
      stem: `A questao tende a trazer um texto curto e pedir inferencia, reescrita, funcao sintatica ou sentido contextual ligado a ${cleanTopic}.`,
      trap: 'Pegadinha provavel: alternativa parcialmente correta, extrapolacao textual ou regra gramatical aplicada fora do contexto.'
    },
    'Língua Portuguesa': {
      charge: `Interpretacao ou gramatica aplicada ao texto em ${cleanTopic}.`,
      stem: `A questao tende a trazer um texto curto e pedir inferencia, reescrita, funcao sintatica ou sentido contextual ligado a ${cleanTopic}.`,
      trap: 'Pegadinha provavel: alternativa parcialmente correta, extrapolacao textual ou regra gramatical aplicada fora do contexto.'
    }
  };
  const fallback = {
    charge: `Conceito central de ${cleanTopic}.`,
    stem: `A questao tende a cobrar definicao, aplicacao ou comparacao envolvendo ${cleanTopic} dentro de ${cleanDiscipline}.`,
    trap: 'Pegadinha provavel: alternativa com termo correto usado em contexto errado.'
  };
  return { ...(templates[cleanDiscipline] || fallback), evidence };
}

function getFocusedStudyResource(discipline, topic) {
  const cleanDiscipline = fixMojibake(discipline);
  const cleanTopic = fixMojibake(topic);
  const base = NORMALIZED_STUDY_MAP[cleanDiscipline];
  const directLesson = getDirectLesson(cleanDiscipline, cleanTopic);
  const provider = base ? base.source.split(' - ')[0] : '';
  const query = [
    cleanTopic,
    cleanDiscipline,
    'concurso',
    'VUNESP',
    'videoaula',
    '2026',
    provider
  ].filter(Boolean).join(' ');

  return {
    source: directLesson ? directLesson.title : (base ? base.source : `Videoaula atual focada em ${cleanTopic}`),
    sourceUrl: directLesson ? directLesson.url : `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`,
    direct: Boolean(directLesson && !directLesson.url.includes('youtube.com/results')),
    checklist: [
      `Estudar somente: ${cleanTopic}`,
      `Resolver questoes VUNESP/ESFCEx de ${cleanDiscipline}`,
      'Revisar erros e marcar progresso na plataforma'
    ]
  };
}

function parseTopics(value) {
  try {
    const parsed = Array.isArray(value) ? value : JSON.parse(value || '[]');
    return parsed.map(item => typeof item === 'string' ? item : item.topic).filter(Boolean);
  } catch (e) {
    return [];
  }
}

function normalizeTopic(topic, discipline) {
  const value = fixMojibake(String(topic || '').trim());
  return value || `Revisão geral de ${fixMojibake(discipline)}`;
}

async function getExamYears(userId = null) {
  const rows = await db.query(`
    SELECT DISTINCT e.ano
    FROM exams e
    JOIN discipline_stats ds ON ds.exam_id = e.id
    WHERE e.num_questoes > 0
      AND ($1::bigint IS NULL OR e.user_id IS NULL OR e.user_id = $1)
    ORDER BY e.ano
  `, [userId]);
  return rows.map(row => row.ano);
}

async function getDisciplineWeights(totalQuestions = 60, userId = null) {
  const rows = await db.query(`
    SELECT ds.discipline, e.ano, ds.num_questions
    FROM discipline_stats ds
    JOIN exams e ON e.id = ds.exam_id
    WHERE e.num_questoes > 0 AND ds.num_questions > 0
      AND ($1::bigint IS NULL OR e.user_id IS NULL OR e.user_id = $1)
    ORDER BY e.ano
  `, [userId]);

  const byDiscipline = new Map();
  const maxYear = rows.reduce((max, row) => Math.max(max, row.ano || 0), 0);

  for (const row of rows) {
    const discipline = canonicalDiscipline(row.discipline);
    const recency = row.ano === maxYear ? 6 : row.ano === maxYear - 1 ? 3 : 1;
    const current = byDiscipline.get(discipline) || { discipline, weighted: 0, weight: 0, years: [], latest: 0 };
    current.weighted += row.num_questions * recency;
    current.weight += recency;
    current.years.push(row.ano);
    if (row.ano === maxYear) current.latest += row.num_questions;
    byDiscipline.set(discipline, current);
  }

  const weights = [...byDiscipline.values()].map(item => ({
    discipline: item.discipline,
    avg: item.weight ? ((item.weighted / item.weight) * 0.35) + ((item.latest || item.weighted / item.weight) * 0.65) : 0,
    years: [...new Set(item.years)].sort()
  }));
  const totalAvg = weights.reduce((sum, item) => sum + item.avg, 0) || 1;

  return weights
    .map(item => ({
      ...item,
      proportion: item.avg / totalAvg,
      target: Math.max(1, Math.round((item.avg / totalAvg) * totalQuestions))
    }))
    .sort((a, b) => b.target - a.target);
}

async function getTopicEvidence(userId = null) {
  const evidence = new Map();

  const add = ({ discipline, topic, ano, questionNumber, questionId, weight = 1 }) => {
    const cleanDiscipline = canonicalDiscipline(discipline);
    const key = `${cleanDiscipline}||${normalizeTopic(topic, cleanDiscipline)}`;
    const current = evidence.get(key) || {
      discipline: cleanDiscipline,
      topic: normalizeTopic(topic, cleanDiscipline),
      years: new Set(),
      questionRefs: [],
      weight: 0
    };
    if (ano) current.years.add(ano);
    if (questionNumber) current.questionRefs.push({ id: questionId, ano, number: questionNumber });
    current.weight += weight;
    evidence.set(key, current);
  };

  const questionRows = await db.query(`
    SELECT q.id, q.discipline, q.topic, q.number, e.ano
    FROM questions q
    LEFT JOIN exams e ON e.id = q.exam_id
    WHERE q.source != 'ai_practice' AND e.num_questoes > 0
      AND ($1::bigint IS NULL OR e.user_id IS NULL OR e.user_id = $1)
  `, [userId]);
  questionRows.forEach(row => add({
    discipline: row.discipline,
    topic: row.topic,
    ano: row.ano,
    questionNumber: row.number,
    questionId: row.id,
    weight: 2
  }));

  const statisticRows = await db.query(`
    SELECT ds.discipline, ds.topics, e.ano
    FROM discipline_stats ds
    JOIN exams e ON e.id = ds.exam_id
    WHERE e.num_questoes > 0
      AND ($1::bigint IS NULL OR e.user_id IS NULL OR e.user_id = $1)
  `, [userId]);
  statisticRows.forEach(row => {
    for (const topic of parseTopics(row.topics)) {
      add({ discipline: row.discipline, topic, ano: row.ano, weight: 1 });
    }
  });

  return [...evidence.values()].map(item => ({
    ...item,
    years: [...item.years].sort(),
    questionRefs: item.questionRefs.sort((a, b) => (a.ano || 0) - (b.ano || 0) || (a.number || 0) - (b.number || 0))
  }));
}

async function getStudyTargets(limit = 40, userId = null) {
  const years = await getExamYears(userId);
  const latestYear = years[years.length - 1] || 0;
  const disciplineWeights = new Map((await getDisciplineWeights(60, userId)).map(item => [canonicalDiscipline(item.discipline), item]));

  return (await getTopicEvidence(userId))
    .map(item => {
      const cleanDiscipline = canonicalDiscipline(item.discipline);
      const discipline = disciplineWeights.get(cleanDiscipline);
      const cleanTopic = fixMojibake(item.topic);
      const map = NORMALIZED_STUDY_MAP[cleanDiscipline] || {
        source: `Videoaulas de ${cleanDiscipline} + questões VUNESP/ESFCEx importadas`,
        sourceUrl: `https://www.youtube.com/results?search_query=${encodeURIComponent(cleanDiscipline + ' ' + cleanTopic + ' concursos videoaula')}`,
        focus: [cleanTopic]
      };
      const focusedResource = getFocusedStudyResource(cleanDiscipline, cleanTopic);
      const recurrence = years.length ? item.years.length / years.length : 0;
      const recent = item.years.includes(latestYear) ? 1 : 0;
      const hasRealQuestions = item.questionRefs.length > 0 ? 1 : 0;
      const score = Math.min(100, Math.round(
        (recent * 40)
        + (recurrence * 25)
        + Math.min(item.weight * 5, 25)
        + ((discipline?.proportion || 0) * 10)
        + (hasRealQuestions * 10)
      ));
      const refs = item.questionRefs.slice(-5).map(ref => `Ano ${ref.ano || '?'} Q${ref.number || '?'}`);
      const questionLinks = item.questionRefs.slice(-5).map(ref => ({
        ...ref,
        label: `Ano ${ref.ano || '?'} Q${ref.number || '?'}`,
        url: ref.id ? `/questoes?question=${ref.id}#questao-${ref.id}` : null
      }));

      return {
        ...item,
        discipline: cleanDiscipline,
        topic: cleanTopic,
        score,
        confidence: score >= 70 ? 'alta' : score >= 45 ? 'media' : 'baixa',
        source: focusedResource.source,
        sourceUrl: focusedResource.sourceUrl,
        directLesson: focusedResource.direct,
        focus: [...new Set([cleanTopic, ...map.focus])].filter(Boolean).slice(0, 6),
        checklist: focusedResource.checklist,
        refs,
        questionLinks,
        progress: 0
      };
    })
    .sort((a, b) => b.score - a.score || a.discipline.localeCompare(b.discipline))
    .slice(0, limit);
}

async function attachProgress(targets, userId) {
  if (!userId) return targets;
  const progressRows = await db.query('SELECT discipline, topic, progress, notes FROM study_progress WHERE user_id = $1', [userId]);
  const progressMap = new Map(progressRows.map(row => [
    `${fixMojibake(row.discipline)}||${fixMojibake(row.topic)}`,
    row
  ]));

  return targets.map(target => {
    const progress = progressMap.get(`${target.discipline}||${target.topic}`);
    return {
      ...target,
      progress: progress ? progress.progress : 0,
      progressNotes: progress ? progress.notes : ''
    };
  });
}

function normalizeTargets(targets, totalQuestions) {
  let diff = totalQuestions - targets.reduce((sum, item) => sum + item.target, 0);
  let index = 0;
  while (diff !== 0 && targets.length > 0) {
    const item = targets[index % targets.length];
    if (diff > 0 || item.target > 1) {
      item.target += diff > 0 ? 1 : -1;
      diff += diff > 0 ? -1 : 1;
    }
    index++;
  }
  return targets;
}

async function getProjectedExamLegacy(totalQuestions = 60) {
  const targets = normalizeTargets(await getDisciplineWeights(totalQuestions), totalQuestions);
  const topicsByDiscipline = (await getStudyTargets(200)).reduce((acc, item) => {
    acc[item.discipline] = acc[item.discipline] || [];
    acc[item.discipline].push(item);
    return acc;
  }, {});

  const slots = [];
  for (const target of targets) {
    const topics = topicsByDiscipline[target.discipline] || [{ topic: `RevisÃ£o geral de ${target.discipline}`, confidence: 'baixa', score: 30 }];
    for (let i = 0; i < target.target; i++) {
      const topic = topics[i % topics.length];
      slots.push({
        number: slots.length + 1,
        discipline: target.discipline,
        topic: topic.topic,
        confidence: topic.confidence,
        reason: `peso histÃ³rico ${Math.round(target.proportion * 100)}%, alvo ${target.target} questÃµes`
      });
    }
  }

  return { totalQuestions, distribution: targets, slots };
}

async function getProjectedExam(totalQuestions = 60, userId = null) {
  const years = await getExamYears(userId);
  const baseYear = years[years.length - 1] || null;
  const targets = normalizeTargets(await getDisciplineWeights(totalQuestions, userId), totalQuestions);
  const topicsByDiscipline = (await getStudyTargets(200, userId)).reduce((acc, item) => {
    acc[item.discipline] = acc[item.discipline] || [];
    acc[item.discipline].push(item);
    return acc;
  }, {});

  const slots = [];
  for (const target of targets) {
    const cleanDiscipline = fixMojibake(target.discipline);
    const allTopics = topicsByDiscipline[cleanDiscipline] || [];
    const latestTopics = baseYear
      ? allTopics.filter(topic => topic.years && topic.years.includes(baseYear))
      : [];
    const topics = (latestTopics.length ? latestTopics : allTopics).filter(topic => topic.score >= 45);
    const fallbackTopics = topics.length ? topics : [{
      topic: `Revisao geral de ${cleanDiscipline}`,
      confidence: 'baixa',
      score: 30,
      refs: [],
      progress: 0
    }];

    for (let i = 0; i < target.target; i++) {
      const topic = fallbackTopics[i % fallbackTopics.length];
      const cleanTopic = fixMojibake(topic.topic);
      const focusedResource = getFocusedStudyResource(cleanDiscipline, cleanTopic);
      const likelyQuestion = buildLikelyQuestion(cleanDiscipline, cleanTopic, topic.refs || []);
      const fromBaseYear = Boolean(topic.years && topic.years.includes(baseYear));
      slots.push({
        number: slots.length + 1,
        discipline: cleanDiscipline,
        topic: cleanTopic,
        confidence: fromBaseYear ? 'alta' : topic.confidence,
        score: fromBaseYear ? Math.max(topic.score || 0, 82) : (topic.score || 30),
        refs: topic.refs || [],
        questionLinks: topic.questionLinks || [],
        source: focusedResource.source,
        sourceUrl: focusedResource.sourceUrl,
        directLesson: focusedResource.direct,
        checklist: focusedResource.checklist,
        likelyQuestion,
        progress: topic.progress || 0,
        reason: fromBaseYear
          ? `caiu no ano-base ${baseYear}; alvo da disciplina ${target.target} questoes; incidencia ${Math.round(target.proportion * 100)}%`
          : `padrao historico complementar; alvo ${target.target} questoes; incidencia ${Math.round(target.proportion * 100)}%`
      });
    }
  }

  return { totalQuestions, baseYear, distribution: targets, slots };
}

module.exports = {
  getStudyTargets,
  getProjectedExam,
  getDisciplineWeights,
  attachProgress
};
