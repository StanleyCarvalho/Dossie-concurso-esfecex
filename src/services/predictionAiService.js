const { GoogleGenerativeAI } = require('@google/generative-ai');

const MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';

function client() {
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY não configurada.');
  return new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
}

async function askJson(system, prompt, maxOutputTokens = 12000) {
  const model = client().getGenerativeModel({
    model: MODEL,
    systemInstruction: system,
    generationConfig: { responseMimeType: 'application/json', maxOutputTokens }
  });
  const text = (await model.generateContent(prompt)).response.text();
  return JSON.parse(text);
}

async function analyzeDifficultyBatch(questions) {
  const system = `Você é um classificador técnico de questões VUNESP/ESFCEx. Analise SOMENTE o que está no enunciado e alternativas. Não invente pré-requisitos nem contexto ausente. Para cada questão retorne exatamente: question_id, estimated_minutes, difficulty, cognitive_level, style_signature, reasoning, confidence. difficulty deve ser fácil, médio, difícil ou impossível. Regra obrigatória: se estimated_minutes > 20, difficulty = impossível. Considere leitura, cálculos, código, múltiplas etapas, ambiguidade e profundidade. confidence 0-100.`;
  const result = await askJson(system, JSON.stringify(questions), 16000);
  if (!Array.isArray(result)) throw new Error('Classificação de dificuldade inválida.');
  return result;
}

async function generateEvidenceBoundPredictions({ targetYear, topics, samples }) {
  const allowed = topics.map(t => `${t.discipline}||${t.topic}`);
  const system = `Você analisa padrões históricos da VUNESP/ESFCEx para produzir HIPÓTESES de cobrança, nunca certezas. É proibido inventar disciplina/assunto fora da lista permitida. Cada previsão deve ser sustentada por evidence_years e evidence_question_ids fornecidos. Não cite legislação, tecnologia, versão, número ou detalhe que não exista nos dados. Retorne array JSON com rank, discipline, topic, difficulty, estimated_minutes, confidence, likely_charge, likely_format, likely_trap, possible_question, answer_focus, evidence_years, evidence_question_ids. A possible_question deve ser uma formulação INÉDITA plausível no estilo observado, sem copiar enunciados. confidence 0-100.`;
  const prompt = JSON.stringify({ targetYear, allowed_topics: allowed, topic_evidence: topics, historical_samples: samples });
  const result = await askJson(system, prompt, 18000);
  if (!Array.isArray(result)) throw new Error('Previsão da prova em formato inválido.');
  return result;
}

module.exports = { analyzeDifficultyBatch, generateEvidenceBoundPredictions };
