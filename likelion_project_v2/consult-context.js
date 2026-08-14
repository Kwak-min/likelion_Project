const WATCH = /시계|워치|롤렉스|오메가|까르띠에|rolex|omega|watch/i;
const ZIPPER = /지퍼|zipper/i;

export function buildConsultInput(history, slots) {
  return [
    ...history,
    {
      role: 'developer',
      content: `[현재 누적 슬롯]\n${JSON.stringify(slots)}\n\n대화 전체와 이 슬롯을 함께 판단해 JSON으로 답하세요.`
    }
  ];
}

export function hasItemSymptomConflict(item, symptom) {
  return WATCH.test(String(item || '')) && ZIPPER.test(String(symptom || ''));
}

export function normalizeAuthenticityLikelihood(value, needMorePhotos = []) {
  const bounded = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  return needMorePhotos.length ? Math.min(bounded, 70) : bounded;
}
