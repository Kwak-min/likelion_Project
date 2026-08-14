import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildConsultInput,
  consultationCorrection,
  consultationReset,
  consultationScopeGuard,
  hasItemSymptomConflict,
  itemDetailRequest,
  normalizeAuthenticityLikelihood,
  symptomQuestion
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

test('generic branded items request a specific line or reference', () => {
  assert.deepEqual(itemDetailRequest('롤렉스 시계'), {
    reply: '롤렉스의 어떤 모델인가요? 서브마리너, 데이토나, 데이트저스트처럼 모델명이나 문자판·케이스의 레퍼런스 번호를 알려주세요.',
    quickReplies: ['서브마리너', '데이토나', '데이트저스트', 'GMT-마스터 II', '잘 모르겠어요']
  });
  assert.equal(itemDetailRequest('롤렉스 서브마리너 126610LN'), null);
  assert.notEqual(itemDetailRequest('샤넬 가방'), null);
});

test('changing to another product clears dependent consultation slots', () => {
  const slots = {
    item: '롤렉스 서브마리너 126610LN',
    purchase: '2024년 백화점',
    condition: '미사용',
    evidence: '보증서 있음',
    photos: 3
  };

  assert.deepEqual(consultationReset('그거 아니고 다른 제품이에요', slots), {
    reset: true,
    slots: {},
    reply: '알겠습니다. 이전 제품 정보는 지웠습니다. 새로 상담할 제품의 브랜드와 모델명을 알려주세요.'
  });
  assert.equal(consultationReset('다른 색상이에요', slots), null);
});

test('a newly named brand replaces the stale item immediately', () => {
  const slots = { item: '롤렉스', symptom: '', photos: 0 };

  assert.deepEqual(consultationCorrection('아 구찌 팔거야', slots), {
    slots: { item: '구찌' },
    reply: '구찌의 어떤 제품인가요? 가방, 지갑, 신발처럼 품목과 모델명이나 라인명을 알려주세요.'
  });
  assert.deepEqual(consultationCorrection('아니 구찌로 변경한다고', slots), {
    slots: { item: '구찌' },
    reply: '구찌의 어떤 제품인가요? 가방, 지갑, 신발처럼 품목과 모델명이나 라인명을 알려주세요.'
  });
  assert.equal(consultationCorrection('롤렉스 서브마리너예요', slots), null);
});

test('symptom questions only mention structures the identified item has', () => {
  assert.deepEqual(symptomQuestion('구찌 재키 1961'), {
    reply: '구찌 재키 1961의 어떤 증상이 있나요? 가죽 오염·변색, 모서리 마모, 스티치 풀림, 형태 변형, 잠금장치·금속 장식 이상, 안감 오염이나 냄새처럼 해당되는 증상을 모두 알려주세요.',
    quickReplies: ['가죽 오염·변색', '모서리 마모', '스티치 풀림', '잠금장치 이상', '형태 변형']
  });
  assert.deepEqual(symptomQuestion('롤렉스 서브마리너 126610LN'), {
    reply: '롤렉스 서브마리너 126610LN의 어떤 증상이 있나요? 시간이 느리거나 빨라짐, 작동 멈춤, 용두·베젤 이상, 유리 손상, 방수 문제, 브레이슬릿·버클 이상처럼 해당되는 증상을 모두 알려주세요.',
    quickReplies: ['시간 오차', '작동 멈춤', '용두·베젤 이상', '유리 손상', '브레이슬릿·버클 이상']
  });
  assert.doesNotMatch(symptomQuestion('롤렉스 서브마리너').reply, /지퍼|스티치/);
  assert.doesNotMatch(symptomQuestion('구찌 재키 1961').reply, /용두|베젤|브레이슬릿/);
});

test('unrelated questions are blocked without answering them', () => {
  const history = [
    { role: 'assistant', content: '구찌 지갑의 모델·라인명을 알려주세요. 모델을 모르시면 구매처의 공개 상품 링크를 보내주세요.' },
    { role: 'user', content: '1+2는?' }
  ];
  assert.deepEqual(consultationScopeGuard(history, { item: '구찌 지갑' }), {
    reply: '상담과 관련된 내용만 안내할 수 있습니다. 구찌 지갑의 모델·라인명을 알려주세요. 모델을 모르시면 구매처의 공개 상품 링크를 보내주세요.',
    nextSlot: 'item'
  });
  assert.notEqual(consultationScopeGuard([
    history[0],
    { role: 'user', content: 'GG 마몽이에요' }
  ], { item: '구찌 지갑' }), history);
});

test('authenticity likelihood is bounded and confidence-aware', () => {
  assert.equal(normalizeAuthenticityLikelihood(112, []), 100);
  assert.equal(normalizeAuthenticityLikelihood(82, ['시리얼 사진 필요']), 70);
  assert.equal(normalizeAuthenticityLikelihood(-4, []), 0);
});
