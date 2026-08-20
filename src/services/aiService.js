const { GoogleGenerativeAI } = require('@google/generative-ai');

const DEFAULT_MODEL = 'gemini-3.6-flash';
const DEPRECATED_MODELS = new Set(['gemini-2.5-flash', 'models/gemini-2.5-flash']);
const configuredModel = process.env.GEMINI_MODEL || DEFAULT_MODEL;
const MODEL = DEPRECATED_MODELS.has(configuredModel) ? DEFAULT_MODEL : configuredModel;
const FALLBACK_MODELS = (process.env.GEMINI_FALLBACK_MODELS || 'gemini-3.5-flash,gemini-3.5-flash-lite').split(',').map(x => x.trim()).filter(Boolean);
const PDF_CHUNK_SIZE = Number(process.env.PDF_AI_CHUNK_SIZE) || 18000;
const PDF_CHUNK_OVERLAP = Number(process.env.PDF_AI_CHUNK_OVERLAP) || 1800;
const PDF_CHUNK_CONCURRENCY = Number(process.env.PDF_AI_CHUNK_CONCURRENCY) || 3;
const RETRYABLE = /429|500|502|503|504|Service Unavailable|high demand|temporar/i;

function getClient() {
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY não configurada.');
  return new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function askGemini({ system, prompt, maxTokens = 4000, json = false }) {
  const client = getClient();
  let lastError;
  for (const modelName of [MODEL, ...FALLBACK_MODELS.filter(x => x !== MODEL)]) {
    const model = client.getGenerativeModel({
      model: modelName,
      systemInstruction: system,
      generationConfig: { maxOutputTokens: maxTokens, ...(json ? { responseMimeType: 'application/json' } : {}) }
    });
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return (await model.generateContent(prompt)).response.text();
      } catch (error) {
        lastError = error;
        if (!RETRYABLE.test(String(error?.message || error))) throw error;
        if (attempt < 2) await sleep(Math.min(1000 * (2 ** attempt), 5000));
      }
    }
  }
  throw lastError || new Error('IA indisponível.');
}

function extractJson(text) {
  if (!text || !String(text).trim()) throw new Error('A IA retornou uma resposta vazia.');
  const cleaned = String(text).replace(/```json/gi, '').replace(/```/g, '').trim();
  const starts = [cleaned.indexOf('['), cleaned.indexOf('{')].filter(x => x >= 0);
  if (!starts.length) throw new Error('A IA não retornou JSON válido.');
  const start = Math.min(...starts);
  const end = Math.max(cleaned.lastIndexOf(']'), cleaned.lastIndexOf('}'));
  if (end < start) throw new Error('A IA retornou JSON incompleto.');
  return JSON.parse(cleaned.slice(start, end + 1));
}

async function repairJsonResponse(text, expectObject = false) {
  const shape = expectObject ? 'um objeto JSON válido' : 'um array JSON válido';
  const repaired = await askGemini({
    system: `Você corrige JSON. Devolva APENAS ${shape}. Não invente conteúdo ausente; descarte itens irrecuperáveis.`,
    prompt: String(text || ''),
    maxTokens: 30000,
    json: true
  });
  return extractJson(repaired);
}

async function parseJsonResponse({ system, prompt, maxTokens = 8000, expectObject = false }) {
  const text = await askGemini({ system, prompt, maxTokens, json: true });
  try { return extractJson(text); } catch { return repairJsonResponse(text, expectObject); }
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

function questionKey(q) {
  const number = Number(q?.number);
  if (Number.isInteger(number) && number > 0) return `number:${number}`;
  const statement = String(q?.statement || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 180);
  return statement ? `statement:${statement}` : null;
}

function mergeQuestionBatches(batches) {
  const byKey = new Map();
  let anonymous = 0;
  for (const question of batches.flat()) {
    if (!question || typeof question !== 'object') continue;
    const key = questionKey(question) || `anonymous:${anonymous++}`;
    const current = byKey.get(key);
    if (!current || JSON.stringify(question).length > JSON.stringify(current).length) byKey.set(key, question);
  }
  return [...byKey.values()].sort((a, b) => (Number(a.number) || 999) - (Number(b.number) || 999));
}

function normalizeExpectedQuestions(questions, expectedQuestions) {
  const expected = Number(expectedQuestions);
  const merged = mergeQuestionBatches([questions]);
  if (!Number.isInteger(expected) || expected < 1) return merged;
  return merged.map(q => ({ ...q, number: Number(q.number) })).filter(q => Number.isInteger(q.number) && q.number >= 1 && q.number <= expected);
}

function getMissingQuestionNumbers(questions, expectedQuestions) {
  const found = new Set(questions.map(q => Number(q.number)));
  return Array.from({ length: expectedQuestions }, (_, i) => i + 1).filter(n => !found.has(n));
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(Number(concurrency) || 1, items.length)) }, worker));
  return results;
}

async function parsePdfToQuestions(rawText, meta = {}) {
  const expectedQuestions = Number(meta.expectedQuestions || 60);
  const system = `Você é um extrator especializado em provas brasileiras. Preserve literalmente enunciado e alternativas. Responda APENAS array JSON com: number, discipline, topic, statement, alt_a, alt_b, alt_c, alt_d, alt_e, correct_letter, style_notes. Não invente conteúdo; use null quando incerto.`;
  const chunks = splitPdfText(rawText);
  if (!chunks.length) throw new Error('O PDF não contém texto extraível.');

  const batches = await mapWithConcurrency(chunks, PDF_CHUNK_CONCURRENCY, async (chunk, index) => {
    const questions = await parseJsonResponse({
      system,
      prompt: `Metadados: banca ${meta.banca || 'VUNESP'}, órgão ${meta.orgao || 'ESFCEx'}, cargo ${meta.cargo || 'Informática'}, ano ${meta.ano || ''}. Este é o trecho ${index + 1}/${chunks.length}. Extraia TODAS as questões completas visíveis. Há sobreposição entre trechos, então não invente partes ausentes.\n\n${chunk}`,
      maxTokens: 16000
    });
    if (!Array.isArray(questions)) throw new Error('A IA não retornou uma lista de questões.');
    return questions;
  });

  let questions = normalizeExpectedQuestions(mergeQuestionBatches(batches), expectedQuestions);
  if (Number.isInteger(expectedQuestions) && expectedQuestions > 0) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const missing = getMissingQuestionNumbers(questions, expectedQuestions);
      if (!missing.length) break;
      const recovered = await parseJsonResponse({
        system,
        prompt: `A prova deve conter exatamente ${expectedQuestions} questões numeradas de 1 a ${expectedQuestions}. Extraia SOMENTE estas ausentes: ${missing.join(', ')}. Não renumere e não inclua instruções ou exemplos. Texto integral:\n${String(rawText || '').slice(0, 140000)}`,
        maxTokens: Math.min(16000, Math.max(4000, missing.length * 1800))
      });
      if (Array.isArray(recovered)) questions = normalizeExpectedQuestions([...questions, ...recovered], expectedQuestions);
    }
    const missing = getMissingQuestionNumbers(questions, expectedQuestions);
    if (missing.length || questions.length !== expectedQuestions) {
      throw new Error(`Importação incompleta: foram identificadas ${questions.length} de ${expectedQuestions} questões. Números ausentes: ${missing.join(', ') || 'nenhum'}. Nenhum dado deve ser gravado.`);
    }
  }
  return questions;
}

async function parseEdital(rawText, meta = {}) {
  const system = `Você é um auditor de edital de concurso. Extraia SOMENTE conteúdos programáticos explicitamente presentes. Responda apenas JSON no formato {summary,topics:[{discipline,topic,subtopic,reference_text,weight}]}. weight: 1 item comum, 1.5 item enfatizado/repetido, 2 item explicitamente central. Não invente conteúdo.`;
  const result = await parseJsonResponse({
    system,
    prompt: `Edital ESFCEx ${meta.ano || ''}; cargo ${meta.cargo || 'Informática'}; banca ${meta.banca || 'VUNESP'}. Extraia a matriz objetiva de estudo:\n${String(rawText || '').slice(0, 150000)}`,
    maxTokens: 12000,
    expectObject: true
  });
  if (!result || typeof result !== 'object' || !Array.isArray(result.topics)) throw new Error('Não foi possível extrair a matriz do edital.');
  return result;
}

async function generatePatternReport(statsSummary) {
  const system = `Analise provas VUNESP/ESFCEx por evidência histórica. Produza relatório Markdown e, ao final, bloco JSON predicted_weights_2027. Diferencie dado histórico, tendência e hipótese; nunca prometa questões literais.`;
  const text = await askGemini({ system, prompt: JSON.stringify(statsSummary, null, 2), maxTokens: 5000 });
  let weights = [];
  try {
    const match = text.match(/```json([\s\S]*?)```/);
    if (match) {
      const parsed = JSON.parse(match[1].trim());
      weights = parsed.predicted_weights_2027 || parsed;
    }
  } catch {}
  return { content_md: text, weights };
}

async function generateStudyPlan({ weights, performance, report = null }) {
  const system = `Você é um orientador ESFCEx. Responda APENAS array JSON com discipline, topic, priority_score, rationale e study_notes. Use somente os assuntos fornecidos. Priorize incidência, recência, erros e baixo domínio.`;
  const result = await parseJsonResponse({ system, prompt: JSON.stringify({ weights, performance, report }), maxTokens: 8000 });
  if (!Array.isArray(result)) throw new Error('Plano de estudos inválido.');
  return result;
}

async function generatePracticeQuestions({ discipline, topic, count = 5, examples = [] }) {
  const system = `Você atua como elaborador de questões INÉDITAS de treino no estilo VUNESP/ESFCEx. Calibre profundidade, comando, distratores e pegadinhas pelos exemplos históricos, mas nunca copie frases, valores, alternativas ou enunciados. Responda apenas array JSON com discipline,topic,statement,alt_a,alt_b,alt_c,alt_d,alt_e,correct_letter,explanation.`;
  const result = await parseJsonResponse({
    system,
    prompt: `Disciplina: ${discipline}; assunto: ${topic}; quantidade: ${count}. Exemplos históricos para calibrar estilo:\n${JSON.stringify(examples.slice(0, 8), null, 2)}`,
    maxTokens: 10000
  });
  if (!Array.isArray(result)) throw new Error('Treino gerado em formato inválido.');
  return result;
}

async function explainQuestion(question, chosenLetter = null) {
  const chosen = chosenLetter ? String(chosenLetter).toUpperCase() : null;
  const correct = String(question.correct_letter || '').toUpperCase();
  if (!correct) throw new Error('Questão sem gabarito cadastrado.');

  return askGemini({
    system: `Você é um professor de preparação para ESFCEx/VUNESP. Explique usando EXCLUSIVAMENTE o enunciado, alternativas e gabarito fornecidos. Não altere o gabarito, não crie fatos externos desnecessários e não invente referência normativa. Responda em português, de forma didática e objetiva, em texto simples. Estruture exatamente com: "Por que a correta está certa:", "Por que sua resposta está certa/errada:" (quando houver resposta do aluno), "Conceito para fixar:" e "Pegadinha da banca:". Se não houver base suficiente para afirmar algo sobre uma alternativa, diga isso explicitamente.`,
    prompt: `Disciplina: ${question.discipline || ''}\nAssunto: ${question.topic || ''}\nEnunciado: ${question.statement}\nA) ${question.alt_a || ''}\nB) ${question.alt_b || ''}\nC) ${question.alt_c || ''}\nD) ${question.alt_d || ''}\n${question.alt_e ? `E) ${question.alt_e}` : ''}\nGabarito oficial/cadastrado: ${correct}${chosen ? `\nResposta marcada pelo aluno: ${chosen}` : ''}`,
    maxTokens: 1800
  });
}

module.exports = {
  parsePdfToQuestions,
  splitPdfText,
  mergeQuestionBatches,
  normalizeExpectedQuestions,
  getMissingQuestionNumbers,
  parseEdital,
  generatePatternReport,
  generateStudyPlan,
  generatePracticeQuestions,
  explainQuestion
};