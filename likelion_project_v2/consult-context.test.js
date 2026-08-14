import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildConsultInput,
  hasItemSymptomConflict,
  normalizeAuthenticityLikelihood
} from './consult-context.js';

test('consult input keeps the full dialogue before the slot snapshot', () => {
  const history = [
    { role: 'user', content: '시계를 수선하고 싶어요' },
    { role: 'assistant', content: '어떤 증상인가요?' },
    { role: 'user', content: '지퍼가 고장났어요' }
  ];

  assert.deepEqual(buildConsultInput(history, { item: '시계' }), [
    ...history,
    {
      role: 'developer',
      content: '[현재 누적 슬롯]\n{"item":"시계"}\n\n대화 전체와 이 슬롯을 함께 판단해 JSON으로 답하세요.'
    }
  ]);
});

test('watch and zipper are treated as a conflict, not a completed symptom', () => {
  assert.equal(hasItemSymptomConflict('시계', '지퍼 고장'), true);
  assert.equal(hasItemSymptomConflict('가방', '지퍼 고장'), false);
});

test('authenticity likelihood is bounded and confidence-aware', () => {
  assert.equal(normalizeAuthenticityLikelihood(112, []), 100);
  assert.equal(normalizeAuthenticityLikelihood(82, ['시리얼 사진 필요']), 70);
  assert.equal(normalizeAuthenticityLikelihood(-4, []), 0);
});
