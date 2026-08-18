const { GoogleGenerativeAI } = require('@google/generative-ai');

const DEFAULT_MODEL = 'gemini-3.6-flash';
const DEPRECATED_MODELS = new Set(['gemini-2.5-flash', 'models/gemini-2.5-flash']);
const configuredModel = process.env.GEMINI_MODEL || DEFAULT_MODEL;
const MODEL = DEPRECATED_MODELS.has(configuredModel) ? DEFAULT_MODEL : configuredModel;
const FALLBACK_MODELS = (process.env.GEMINI_FALLBACK_MODELS || 'gemini-3.5-flash,gemini-3.5-flash-lite')
  .split(',')
  .map(model => model.trim())
  .filter(Boolean);
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const PDF_CHUNK_SIZE = Number(process.env.PDF_AI_CHUNK_SIZE) || 18000;
const PDF_CHUNK_OVERLAP = Number(process.env.PDF_AI_CHUNK_OVERLAP) || 1800;
const PDF_CHUNK_CONCURRENCY = Number(process.env.PDF_AI_CHUNK_CONCURRENCY) || 3;

function getClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY não configurada. Defina no arquivo .env (crie uma gratuitamente em aistudio.google.com/apikey)');
  }
  return new GoogleGenerativeAI(apiKey);
}

function getRetryDelayMs(attempt) {
  return Math.min(1000 * (2 ** attempt), 5000);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isRetryableGeminiError(error) {
  const message = String(error && error.message ? error.message : error);
  return RETRYABLE_STATUS_CODES.has(error?.status)
    || /\[(429|500|502|503|504)\b/.test(message)
    || /Service Unavailable|high demand|temporar/i.test(message);
}

function describeModelAttempts(errors) {
  return errors.map(item => `${item.model}: ${item.error.message}`).join(' | ');
}

async function askGemini({ system, prompt, maxTokens = 4000, json = false }) {
  const genAI = getClient();
  const models = [MODEL, ...FALLBACK_MODELS.filter(model => model !== MODEL)];
  const errors = [];

  for (const modelName of models) {
    const model = genAI.getGenerativeModel({
      model: modelName,
      systemInstruction: system,
      generationConfig: {
        maxOutputTokens: maxTokens,
        ...(json ? { responseMimeType: 'application/json' } : {})
      }
    });

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const result = await model.generateContent(prompt);
        return result.response.text();
      } catch (error) {
        errors.push({ model: modelName, error });
        if (!isRetryableGeminiError(error)) {
          throw error;
        }
        if (attempt < 2) {
          await sleep(getRetryDelayMs(attempt));
        }
      }
    }
  }

  throw new Error(`Gemini esta indisponivel ou com alta demanda no momento. Tentativas: ${describeModelAttempts(errors)}`);
}

function extractJson(text) {
  if (!text || !text.trim()) {
    throw new Error('O Gemini retornou uma resposta vazia. Tente importar novamente ou use um PDF com texto selecionavel.');
  }

  // Remove eventuais cercas de código ```json ... ```
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('[') === -1
    ? cleaned.indexOf('{')
    : (cleaned.indexOf('{') === -1 ? cleaned.indexOf('[') : Math.min(cleaned.indexOf('{'), cleaned.indexOf('[')));
  const lastCurly = cleaned.lastIndexOf('}');
  const lastSquare = cleaned.lastIndexOf(']');
  const end = Math.max(lastCurly, lastSquare);
  if (start === -1 || end === -1 || end < start) {
    const preview = cleaned.slice(0, 300);
    throw new Error(`O Gemini nao retornou JSON valido. Previa da resposta: ${preview || '(vazia)'}`);
  }

  const slice = cleaned.slice(start, end + 1);
  try {
    return JSON.parse(slice);
  } catch (e) {
    const looksIncomplete = !slice.endsWith(']') && !slice.endsWith('}');
    const reason = looksIncomplete ? 'parece incompleto' : 'nao pode ser interpretado';
    throw new Error(`O Gemini retornou um JSON que ${reason}. Tente novamente; se persistir, importe um PDF menor ou divida a prova em partes.`);
  }
}

async function repairJsonResponse(text) {
  const system = `Voce corrige respostas JSON.
Receba uma resposta possivelmente invalida ou incompleta e devolva APENAS um array JSON valido.
Nao adicione markdown, comentarios ou texto fora do JSON.
Se algum item estiver incompleto demais, descarte esse item em vez de inventar conteudo.`;

  const prompt = `Corrija esta resposta para um array JSON valido:
${text}`;

  const repaired = await askGemini({ system, prompt, maxTokens: 30000, json: true });
  return extractJson(repaired);
}

function splitPdfText(rawText, chunkSize = PDF_CHUNK_SIZE, overlap = PDF_CHUNK_OVERLAP) {
  const text = String(rawText || '').replace(/\r\n/g, '\n').trim();
  if (!text) return [];
  if (text.length <= chunkSize) return [text];

  const chunks = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + chunkSize, text.length);
    if (end < text.length) {
      const boundary = text.lastIndexOf('\n', end);
      if (boundary > start + Math.floor(chunkSize * 0.7)) end = boundary;
    }
    chunks.push(text.slice(start, end));
    if (end >= text.length) break;
    start = Math.max(start + 1, end - overlap);
  }
  return chunks;
}

function questionKey(question) {
  const number = Number(question?.number);
  if (Number.isFinite(number) && number > 0) return `number:${number}`;
  const statement = String(question?.statement || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
  return statement ? `statement:${statement}` : null;
}

function mergeQuestionBatches(batches) {
  const byKey = new Map();
  let anonymousIndex = 0;
  for (const question of batches.flat()) {
    if (!question || typeof question !== 'object') continue;
    const key = questionKey(question) || `anonymous:${anonymousIndex++}`;
    const current = byKey.get(key);
    if (!current || JSON.stringify(question).length > JSON.stringify(current).length) {
      byKey.set(key, question);
    }
  }
  return [...byKey.values()].sort((a, b) => {
    const aNumber = Number(a.number);
    const bNumber = Number(b.number);
    if (!Number.isFinite(aNumber)) return 1;
    if (!Number.isFinite(bNumber)) return -1;
    return aNumber - bNumber;
  });
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(Number(concurrency) || 1, items.length));
  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}

/**
 * Recebe o texto bruto extraído de um PDF de prova (+ gabarito, se disponível)
 * e devolve um array estruturado de questões.
 */
async function parsePdfToQuestions(rawText, meta = {}) {
  const system = `Você é um extrator de dados especializado em provas de concurso público brasileiro.
Sua única tarefa é converter o texto bruto de uma prova (extraído de PDF, pode ter quebras de linha/OCR imperfeitas) em uma lista estruturada de questões em JSON.
Responda APENAS com um array JSON válido, sem nenhum texto antes ou depois, sem markdown.
Cada item deve ter exatamente estes campos:
{
  "number": <número da questão>,
  "discipline": "<disciplina, ex: Português, Programação, Redes de Computadores, Banco de Dados, Segurança da Informação, Sistemas Operacionais, Arquitetura de Computadores, Engenharia de Software, Governança de TI, Gerência de Projetos, Algoritmos e Estrutura de Dados, Telecomunicações, História, Geografia>",
  "topic": "<assunto específico dentro da disciplina>",
  "statement": "<enunciado completo da questão>",
  "alt_a": "<texto da alternativa A>",
  "alt_b": "...",
  "alt_c": "...",
  "alt_d": "...",
  "alt_e": "... (ou null se a prova só tiver A-D)",
  "correct_letter": "<A-E, ou null se o gabarito não estiver no texto>",
  "style_notes": "<observação curta sobre o estilo/pegadinha da questão, útil para detectar padrões da banca>"
}
Se não conseguir identificar algum campo com segurança, use null. Não invente conteúdo que não está no texto.`;

  const chunks = splitPdfText(rawText);
  if (!chunks.length) {
    throw new Error('O PDF não contém texto extraível. Use um PDF com texto selecionável ou aplique OCR antes de importar.');
  }

  console.log(JSON.stringify({
    level: 'info',
    message: 'pdf_ai_extraction_started',
    textLength: String(rawText || '').length,
    chunks: chunks.length
  }));

  const batches = await mapWithConcurrency(chunks, PDF_CHUNK_CONCURRENCY, async (chunk, index) => {
    const prompt = `Metadados da prova: banca ${meta.banca || 'VUNESP'}, órgão ${meta.orgao || 'ESFCEx'}, cargo ${meta.cargo || 'Informática'}, ano ${meta.ano || ''}.

Este é o trecho ${index + 1} de ${chunks.length} do PDF. Extraia TODAS as questões completas visíveis neste trecho.
O texto possui sobreposição com os trechos vizinhos; não invente partes ausentes. Questões repetidas serão eliminadas depois.

Texto extraído do PDF:
"""
${chunk}
"""

Devolva todas as questões completas identificadas no formato JSON especificado.`;

    const text = await askGemini({ system, prompt, maxTokens: 16000, json: true });
    let questions;
    try {
      questions = extractJson(text);
    } catch (error) {
      questions = await repairJsonResponse(text);
    }
    if (!Array.isArray(questions)) {
      throw new Error(`O Gemini não retornou uma lista de questões no trecho ${index + 1}.`);
    }
    console.log(JSON.stringify({
      level: 'info',
      message: 'pdf_ai_chunk_completed',
      chunk: index + 1,
      totalChunks: chunks.length,
      questions: questions.length
    }));
    return questions;
  });

  const questions = mergeQuestionBatches(batches);
  console.log(JSON.stringify({
    level: 'info',
    message: 'pdf_ai_extraction_completed',
    chunks: chunks.length,
    questions: questions.length
  }));
  return questions;
}

/**
 * Gera um relatório de padrões da banca com base nas estatísticas agregadas
 * (disciplinas, pesos, assuntos por ano) já salvas no banco.
 */
async function generatePatternReport(statsSummary) {
  const system = `Você é um analista especializado em estatística de bancas de concurso público no Brasil (padrão de incidência de temas, estilo de redação de questões, tendências históricas).
Seu trabalho é analisar dados históricos de uma banca (VUNESP) para um cargo específico (Informática, ESFCEx) e produzir:
1. Um relatório em Markdown, direto e objetivo, sobre os padrões identificados (disciplinas mais cobradas, tendência de crescimento/queda por área, estilo típico de questão da banca, disciplinas "decorativas" vs "decisivas").
2. Ao final, um bloco JSON (dentro de \`\`\`json) com a chave "predicted_weights_2027": um array de objetos {discipline, estimated_questions, confidence} representando uma ESTIMATIVA PROBABILÍSTICA de peso por disciplina para a próxima prova — deixe claro no relatório que isso é uma projeção estatística baseada em tendência histórica, e não uma previsão de questões literais. Nunca afirme que questões exatas vão se repetir.
Seja honesto sobre limitações quando os dados históricos forem parciais.`;

  const prompt = `Dados históricos agregados (JSON):
${JSON.stringify(statsSummary, null, 2)}

Gere o relatório de padrões conforme instruído.`;

  const text = await askGemini({ system, prompt, maxTokens: 4000 });

  let weights = [];
  try {
    const match = text.match(/```json([\s\S]*?)```/);
    if (match) {
      const parsed = JSON.parse(match[1].trim());
      weights = parsed.predicted_weights_2027 || parsed;
    }
  } catch (e) {
    weights = [];
  }

  return { content_md: text, weights };
}

/**
 * Gera um plano de estudos priorizado a partir dos pesos históricos
 * e do desempenho do usuário em simulados.
 */
async function generateStudyPlan({ weights, performance }) {
  const system = `Você é um orientador de estudos para concursos militares (ESFCEx, cargo Informática).
Com base no peso histórico de cada disciplina/assunto na banca VUNESP e no desempenho do candidato em simulados, gere um plano de estudos priorizado.
Responda APENAS com um array JSON, sem texto fora do JSON, no formato:
[
  {
    "discipline": "...",
    "topic": "...",
    "priority_score": <0-100>,
    "rationale": "<por que essa prioridade, cite peso histórico e/ou desempenho fraco>",
    "study_notes": "<resumo de estudo objetivo, 3-6 frases, direto ao ponto, focado no que a banca cobra>"
  }
]
Ordene do maior para o menor priority_score. Gere entre 10 e 20 itens cobrindo as principais disciplinas técnicas de Informática do edital.`;

  const prompt = `Pesos históricos/estimados por disciplina:
${JSON.stringify(weights, null, 2)}

Desempenho do candidato em simulados (pode estar vazio se ainda não fez nenhum):
${JSON.stringify(performance, null, 2)}

Gere o plano de estudos.`;

  const text = await askGemini({ system, prompt, maxTokens: 8000, json: true });
  try {
    return extractJson(text);
  } catch (e) {
    return repairJsonResponse(text);
  }
}

/**
 * Gera questões inéditas de treino no estilo da banca para uma disciplina/assunto.
 * Deixado claro para o usuário que são questões DE TREINO geradas por IA,
 * não questões reais nem previsões literais da prova.
 */
async function generatePracticeQuestions({ discipline, topic, count = 5 }) {
  const system = `Você cria questões de múltipla escolha de treino, no estilo de prova da banca VUNESP para concursos militares (ESFCEx, cargo Informática).
As questões devem ser INÉDITAS (não copiar questões reais), mas reproduzir o nível de dificuldade, formato e "pegadinhas" típicas dessa banca.
Responda APENAS com um array JSON no formato:
[
  {
    "discipline": "...",
    "topic": "...",
    "statement": "...",
    "alt_a": "...", "alt_b": "...", "alt_c": "...", "alt_d": "...", "alt_e": "...",
    "correct_letter": "A-E",
    "explanation": "<explicação objetiva da resposta correta e por que as outras estão erradas>"
  }
]`;
  const prompt = `Gere ${count} questões inéditas de treino sobre "${topic}" (disciplina: ${discipline}), nível concurso público superior, estilo VUNESP.`;
  const text = await askGemini({ system, prompt, maxTokens: 8000, json: true });
  try {
    return extractJson(text);
  } catch (e) {
    return repairJsonResponse(text);
  }
}

async function explainQuestion(question) {
  const system = `Você explica questões de concurso de forma clara e objetiva, no nível de um professor de cursinho preparatório.`;
  const prompt = `Questão (disciplina: ${question.discipline}, assunto: ${question.topic}):
${question.statement}
A) ${question.alt_a}
B) ${question.alt_b}
C) ${question.alt_c}
D) ${question.alt_d}
${question.alt_e ? 'E) ' + question.alt_e : ''}
Gabarito: ${question.correct_letter}

Explique por que a alternativa correta está certa e, brevemente, por que as principais alternativas erradas não servem.`;
  return askGemini({ system, prompt, maxTokens: 1200 });
}

module.exports = {
  parsePdfToQuestions,
  splitPdfText,
  mergeQuestionBatches,
  generatePatternReport,
  generateStudyPlan,
  generatePracticeQuestions,
  explainQuestion
};
