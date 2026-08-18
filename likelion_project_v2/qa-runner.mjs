import fs from 'node:fs/promises';

const allowedSlots = {
  sell: ['item', 'purchase', 'condition', 'evidence', 'photos'],
  repair: ['item', 'category', 'variant', 'product_name', 'reference',
    'repair_area', 'symptom', 'photos', 'history', 'goal']
};

const scenario = (id, mode, user, slots, validate, assistant = '제품 정보를 알려주세요.') => ({
  id, mode, history: [
    { role: 'assistant', content: assistant },
    { role: 'user', content: user }
  ], slots, validate
});

export const QA_SCENARIOS = [
  scenario('repair-full-identity', 'repair',
    '구찌 재키 1961 미디엄 호보백이고 제품 번호 636706, 잠금장치가 헐거워요.',
    {}, body => [
      body.slots?.category === '가방' ? null : 'category must be 가방',
      body.slots?.product_name?.includes('재키 1961') ? null : 'product_name missing',
      body.slots?.reference === '636706' ? null : 'reference missing',
      body.slots?.repair_area === '잠금장치' ? null : 'repair_area missing',
      /만원/.test(body.reply) ? null : 'estimated repair price missing'
    ]),
  scenario('watch-structure', 'repair', '롤렉스 서브마리너 126610LN의 용두가 빠졌어요.',
    {}, body => [
      /용두/.test(body.reply) ? null : 'watch repair area missing',
      /지퍼|스티치/.test(body.reply) ? 'watch reply mentions bag structure' : null
    ]),
  scenario('bag-structure', 'repair', '모서리 가죽이 벗겨졌어요.',
    { item: '샤넬 클래식 플랩백', category: '가방', variant: '플랩백',
      product_name: '클래식 플랩백', reference: '확인 못 함', repair_area: '', symptom: '' }, body => [
      /모서리|가죽/.test(body.slots?.repair_area || '') ? null : 'bag repair area missing',
      /용두|베젤|브레이슬릿/.test(body.reply) ? 'bag reply mentions watch structure' : null
    ], '수리할 위치와 증상을 알려주세요.'),
  scenario('brand-correction', 'repair', '아 구찌 팔거야',
    { item: '롤렉스', category: '시계', product_name: '', reference: '' },
    body => [
      body.slots?.item?.includes('구찌') ? null : 'brand was not corrected',
      /롤렉스/.test(body.reply) ? 'stale Rolex repeated' : null
    ], '롤렉스의 모델명을 알려주세요.'),
  scenario('out-of-scope', 'repair', '1+2는?',
    { item: '구찌 지갑', category: '지갑', product_name: '', reference: '' },
    body => [
      /3/.test(body.reply) ? 'answered arithmetic' : null,
      /상담과 관련된 내용만/.test(body.reply) ? null : 'scope guard missing'
    ], '구찌 지갑의 모델·라인명을 알려주세요.'),
  scenario('impossible-symptom', 'repair', '지퍼가 고장났어요.',
    { item: '롤렉스 서브마리너', category: '시계', product_name: '서브마리너', reference: '확인 못 함' },
    body => [
      body.slots?.symptom ? 'impossible symptom was stored' : null,
      /지퍼.*(?:없|존재하지 않)/.test(body.reply) ? null : 'structure conflict not explained'
    ], '어떤 증상인가요?'),
  scenario('unknown-reference', 'repair', '레퍼런스 번호는 잘 모르겠어요.',
    { item: '오메가 씨마스터', category: '시계', variant: '다이버 시계', product_name: '씨마스터', reference: '' },
    body => [
      /확인 못|모름/.test(body.slots?.reference || '') ? null : 'unknown reference not recorded',
      body.next_slot === 'reference' ? 'stuck asking unknown reference' : null
    ], '레퍼런스 번호를 알려주세요.'),
  scenario('repair-location-followup', 'repair', '손잡이 부분이요.',
    { item: '루이비통 네버풀 MM', category: '가방', variant: '토트백',
      product_name: '네버풀 MM', reference: 'M40995', repair_area: '', symptom: '' },
    body => [
      body.slots?.repair_area?.includes('손잡이') ? null : 'repair area not captured',
      body.next_slot === 'symptom' ? null : 'did not advance to symptom'
    ], '어느 위치를 수리할까요?'),
  scenario('sell-mode-contract', 'sell', '에르메스 버킨 30을 팔고 싶어요.',
    {}, body => [
      Object.keys(body.slots || {}).some(key => ['category','repair_area','symptom'].includes(key))
        ? 'repair slots leaked into sell mode' : null,
      body.next_slot === 'purchase' || body.next_slot === 'item' ? null : 'invalid sell progression'
    ]),
  scenario('malformed-natural-input', 'repair', '아 그거 프라다 리나일론 백으로 바꿀게ㅐ',
    { item: '샤넬 클래식 플랩', category: '가방', product_name: '클래식 플랩' },
    body => [
      body.slots?.item?.includes('프라다') ? null : 'typo correction brand not captured',
      /샤넬/.test(body.reply) ? 'stale Chanel repeated' : null
    ], '샤넬 클래식 플랩의 수리 위치를 알려주세요.')
];

export function validateQaResult(scenarioSpec, response) {
  const body = response.body || {};
  const violations = [];
  if (response.status !== 200) violations.push(`HTTP ${response.status}`);
  if (!body.reply || typeof body.reply !== 'string') violations.push('reply is empty');
  if (!body.slots || typeof body.slots !== 'object') violations.push('slots missing');
  const next = body.next_slot;
  if (next && !allowedSlots[scenarioSpec.mode].includes(next)) {
    violations.push(`invalid next_slot ${next}`);
  }
  for (const violation of scenarioSpec.validate(body)) {
    if (violation) violations.push(violation);
  }
  return { id: scenarioSpec.id, status: response.status, body, violations };
}

async function login(baseUrl) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'a@naver.com', password: 'aaaaaaaa' })
  });
  const body = await response.json();
  if (!response.ok || !body.token) throw new Error(`login failed: ${response.status}`);
  return body.token;
}

async function runScenario(baseUrl, token, scenarioSpec) {
  const started = performance.now();
  const request = () => fetch(`${baseUrl}/api/consult/message`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      mode: scenarioSpec.mode,
      history: scenarioSpec.history,
      slots: scenarioSpec.slots
    })
  });
  let response = await request();
  const retryAfter = Number(response.headers.get('retry-after') || 0);
  if (response.status === 429 && retryAfter > 0) {
    await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
    response = await request();
  }
  const body = await response.json().catch(() => ({}));
  return {
    ...validateQaResult(scenarioSpec, { status: response.status, body }),
    latency_ms: Math.round(performance.now() - started)
  };
}

export async function runQa({
  baseUrl = 'http://127.0.0.1:8787',
  outputPath = 'evidence/qa-10.json'
} = {}) {
  const token = await login(baseUrl);
  const results = [];
  for (const scenarioSpec of QA_SCENARIOS) {
    results.push(await runScenario(baseUrl, token, scenarioSpec));
  }
  const artifact = {
    generated_at: new Date().toISOString(),
    base_url: baseUrl,
    total: results.length,
    violation_count: results.reduce((sum, result) => sum + result.violations.length, 0),
    results
  };
  await fs.mkdir(new URL('.', new URL(outputPath, `file://${process.cwd()}/`)), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`);
  return artifact;
}

if (process.argv[1]?.endsWith('qa-runner.mjs')) {
  const artifact = await runQa({ outputPath: process.argv[2] || 'evidence/qa-10.json' });
  console.log(JSON.stringify({
    total: artifact.total,
    violation_count: artifact.violation_count,
    output: process.argv[2] || 'evidence/qa-10.json'
  }));
}
