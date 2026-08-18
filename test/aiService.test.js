const test = require('node:test');
const assert = require('node:assert/strict');
const { splitPdfText, mergeQuestionBatches } = require('../src/services/aiService');

test('splitPdfText preserves the whole PDF using overlapping chunks', () => {
  const text = Array.from({ length: 60 }, (_, index) =>
    `QUESTÃO ${index + 1}\nEnunciado ${'x'.repeat(120)}\nA) alternativa\nB) alternativa`
  ).join('\n');
  const chunks = splitPdfText(text, 1000, 120);

  assert.ok(chunks.length > 1);
  assert.match(chunks[0], /QUESTÃO 1/);
  assert.match(chunks.at(-1), /QUESTÃO 60/);
  assert.ok(chunks.every(chunk => chunk.length <= 1000));
});

test('mergeQuestionBatches removes overlap duplicates and orders question numbers', () => {
  const result = mergeQuestionBatches([
    [{ number: 2, statement: 'curta' }, { number: 1, statement: 'primeira' }],
    [{ number: 2, statement: 'enunciado mais completo', alt_a: 'A' }, { number: 3, statement: 'terceira' }]
  ]);

  assert.deepEqual(result.map(question => question.number), [1, 2, 3]);
  assert.equal(result[1].statement, 'enunciado mais completo');
});
