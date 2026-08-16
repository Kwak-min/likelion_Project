const WATCH = /시계|워치|롤렉스|오메가|까르띠에|rolex|omega|watch/i;
const ZIPPER = /지퍼|zipper/i;
const CHANGE_PRODUCT = /(?:그거|이거|제품|물건|품목).*(?:아니|말고|다른)|(?:아니고|말고).*(?:다른|새)|다른\s*(?:제품|물건|품목)(?:이에요|입니다|로|을|으로)?/i;
const OUT_OF_SCOPE = /(?:\d+\s*[+\-*/×÷]\s*\d+)|(?:날씨|뉴스|번역|코딩|코드|프로그래밍|숙제|문제\s*풀|주식|코인|맛집|영화|노래|게임|정치|스포츠).*(?:뭐|어때|알려|해줘|추천|는\?)/i;
const BRANDS = [
  ['롤렉스', /롤렉스|rolex/i],
  ['구찌', /구찌|gucci/i],
  ['샤넬', /샤넬|chanel/i],
  ['루이비통', /루이비통|louis\s*vuitton|\blv\b/i],
  ['오메가', /오메가|omega/i],
  ['까르띠에', /까르띠에|cartier/i],
  ['프라다', /프라다|prada/i],
  ['디올', /디올|dior/i],
  ['에르메스', /에르메스|herm[eè]s/i],
  ['버버리', /버버리|burberry/i]
];
const FAST_ITEM_CATALOG = [
  { brand: '롤렉스', pattern: /롤렉스|rolex/i, lines: ['서브마리너', '데이토나', '데이트저스트', 'GMT-마스터 II'], watch: true },
  { brand: '구찌', pattern: /구찌|gucci/i, lines: ['GG 마몽', '오피디아', '재키 1961', '홀스빗'] },
  { brand: '샤넬', pattern: /샤넬|chanel/i, lines: ['클래식 플랩', '보이백', '코코핸들', '샤넬 19'] },
  { brand: '루이비통', pattern: /루이비통|louis\s*vuitton|\blv\b/i, lines: ['네버풀', '스피디', '알마', '카푸신'] },
  { brand: '에르메스', pattern: /에르메스|herm[eè]s/i, lines: ['버킨', '켈리', '가든 파티', '에블린'] },
  { brand: '오메가', pattern: /오메가|omega/i, lines: ['스피드마스터', '씨마스터', '컨스텔레이션', '드 빌'], watch: true },
  { brand: '까르띠에', pattern: /까르띠에|cartier/i, lines: ['탱크', '산토스', '발롱 블루', '팬더'] },
  { brand: '프라다', pattern: /프라다|prada/i, lines: ['리나일론', '갤러리아', '클레오', '카이에'] },
  { brand: '디올', pattern: /디올|dior/i, lines: ['레이디 디올', '새들', '북 토트', '바비'] },
  { brand: '버버리', pattern: /버버리|burberry/i, lines: ['롤라', '프란시스', '포켓백', 'TB백'] }
];
const DETAIL_REQUESTS = [
  {
    broad: /(?:롤렉스|rolex).*(?:시계|워치)?$|^(?:롤렉스|rolex)$/i,
    detail: /서브마리너|데이토나|데이트저스트|gmt|익스플로러|오이스터|요트마스터|밀가우스|에어킹|\b\d{5,6}[a-z]{0,3}\b/i,
    reply: '롤렉스의 어떤 모델인가요? 서브마리너, 데이토나, 데이트저스트처럼 모델명이나 문자판·케이스의 레퍼런스 번호를 알려주세요.',
    quickReplies: ['서브마리너', '데이토나', '데이트저스트', 'GMT-마스터 II', '잘 모르겠어요']
  },
  {
    broad: /(?:샤넬|chanel).*(?:가방|백)?$|^(?:샤넬|chanel)$/i,
    detail: /클래식|보이|코코핸들|가브리엘|19백|22백|플랩|woc|[a-z]{1,2}\d{4,}/i,
    reply: '샤넬의 어떤 모델인가요? 클래식 플랩, 보이백, 코코핸들처럼 라인명과 크기를 알려주세요.',
    quickReplies: ['클래식 플랩', '보이백', '코코핸들', '샤넬 19', '잘 모르겠어요']
  },
  {
    broad: /(?:루이비통|louis vuitton|lv).*(?:가방|백)?$|^(?:루이비통|louis vuitton|lv)$/i,
    detail: /네버풀|스피디|알마|카푸신|온더고|쁘띠뜨|트위스트|키폴|[mn]\d{4,}/i,
    reply: '루이비통의 어떤 모델인가요? 네버풀, 스피디, 알마, 카푸신처럼 모델명과 크기를 알려주세요.',
    quickReplies: ['네버풀', '스피디', '알마', '카푸신', '잘 모르겠어요']
  }
];

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

export function consultationReset(message, slots = {}) {
  if (!Object.keys(slots).length || !CHANGE_PRODUCT.test(String(message || ''))) return null;
  return {
    reset: true,
    slots: {},
    reply: '알겠습니다. 이전 제품 정보는 지웠습니다. 새로 상담할 제품의 브랜드와 모델명을 알려주세요.'
  };
}

export function consultationCorrection(message, slots = {}) {
  const text = String(message || '');
  const current = String(slots.item || '');
  const incomingBrand = BRANDS.find(([, pattern]) => pattern.test(text));
  if (!incomingBrand) return null;
  const currentBrand = BRANDS.find(([, pattern]) => pattern.test(current));
  if (!currentBrand || incomingBrand[0] === currentBrand[0]) return null;
  const brand = incomingBrand[0];
  return {
    slots: { item: brand },
    reply: `${brand}의 어떤 제품인가요? 가방, 지갑, 신발처럼 품목과 모델명이나 라인명을 알려주세요.`
  };
}

export function consultationScopeGuard(history, slots = {}) {
  const messages = Array.isArray(history) ? history : [];
  const latestUser = [...messages].reverse().find(message => message?.role === 'user')?.content || '';
  if (!Object.keys(slots).length || !OUT_OF_SCOPE.test(latestUser)) return null;
  const latestQuestion = [...messages].reverse().find(message => message?.role === 'assistant')?.content || '';
  const request = latestQuestion
    .replace(/^.*?(?=(?:구찌|샤넬|루이비통|롤렉스|오메가|까르띠에|프라다|디올|에르메스|버버리|제품|품목))/s, '')
    .trim();
  return {
    reply: `상담과 관련된 내용만 안내할 수 있습니다. ${request || '현재 상담 중인 제품 정보를 알려주세요.'}`,
    nextSlot: ['item', 'category', 'variant', 'product_name', 'reference',
      'repair_area', 'symptom', 'photos', 'history', 'goal']
      .find(slot => slots[slot] === '' || slots[slot] === null || slots[slot] === undefined) || ''
  };
}

export function fastItemQuestion(message, slots = {}) {
  if (slots.item) return null;
  const value = String(message || '').trim();
  const entry = FAST_ITEM_CATALOG.find(candidate => candidate.pattern.test(value));
  if (!entry || entry.lines.some(line => value.toLowerCase().includes(line.toLowerCase()))) return null;
  const kind = /지갑|wallet/i.test(value) ? '지갑' :
    /가방|백|bag/i.test(value) ? '가방' :
    /시계|워치|watch/i.test(value) || entry.watch ? '시계' : '제품';
  const item = kind === '제품' ? entry.brand : `${entry.brand} ${kind}`;
  const reference = entry.watch ? ' 가능하면 레퍼런스 번호도 함께 알려주세요.' : ' 모델을 모르시면 공개 상품 링크를 보내주세요.';
  return {
    item,
    reply: `${item}의 모델·라인명을 알려주세요. 예: ${entry.lines.join(', ')}.${reference}`,
    quickReplies: [...entry.lines, '잘 모르겠어요'],
    nextSlot: 'item'
  };
}

export function itemDetailRequest(item) {
  const value = String(item || '').trim();
  if (!value || /모르|확인 못|잘 모름/.test(value)) return null;
  const request = DETAIL_REQUESTS.find(entry =>
    entry.broad.test(value) && !entry.detail.test(value)
  );
  return request ? {
    reply: request.reply,
    quickReplies: request.quickReplies
  } : null;
}

export function symptomQuestion(item, repairArea = '') {
  const value = String(item || '').trim();
  const area = String(repairArea || '').trim();
  if (/손잡이|핸들/i.test(area)) {
    return {
      reply: `${value} 손잡이의 어떤 증상이 있나요? 갈라짐, 끊어짐, 오염·변색, 형태 변형, 연결부 풀림처럼 해당되는 증상을 모두 알려주세요.`,
      quickReplies: ['손잡이 갈라짐', '손잡이 끊어짐', '손잡이 오염·변색', '손잡이 형태 변형', '손잡이 연결부 풀림']
    };
  }
  if (WATCH.test(value)) {
    return {
      reply: `${value}의 어떤 증상이 있나요? 시간이 느리거나 빨라짐, 작동 멈춤, 용두·베젤 이상, 유리 손상, 방수 문제, 브레이슬릿·버클 이상처럼 해당되는 증상을 모두 알려주세요.`,
      quickReplies: ['시간 오차', '작동 멈춤', '용두·베젤 이상', '유리 손상', '브레이슬릿·버클 이상']
    };
  }
  if (/가방|백|재키|마몽|디오니서스|홀스빗|플랩|보이|카푸신|네버풀|스피디|알마|가든\s*파티/i.test(value)) {
    return {
      reply: `${value}의 어떤 증상이 있나요? 가죽 오염·변색, 모서리 마모, 스티치 풀림, 형태 변형, 잠금장치·금속 장식 이상, 안감 오염이나 냄새처럼 해당되는 증상을 모두 알려주세요.`,
      quickReplies: ['가죽 오염·변색', '모서리 마모', '스티치 풀림', '잠금장치 이상', '형태 변형']
    };
  }
  if (/신발|구두|스니커즈|로퍼|부츠/i.test(value)) {
    return {
      reply: `${value}의 어떤 증상이 있나요? 밑창 마모, 접착 분리, 가죽 오염·변색, 스크래치, 형태 변형, 안감 손상이나 냄새처럼 해당되는 증상을 모두 알려주세요.`,
      quickReplies: ['밑창 마모', '접착 분리', '가죽 오염·변색', '스크래치', '형태 변형']
    };
  }
  if (/지갑|카드\s*지갑|반지갑|장지갑/i.test(value)) {
    return {
      reply: `${value}의 어떤 증상이 있나요? 모서리 마모, 가죽 오염·변색, 스티치 풀림, 카드 슬롯 늘어남, 잠금장치 이상처럼 해당되는 증상을 모두 알려주세요.`,
      quickReplies: ['모서리 마모', '가죽 오염·변색', '스티치 풀림', '카드 슬롯 늘어남', '잠금장치 이상']
    };
  }
  return null;
}

export function normalizeAuthenticityLikelihood(value, needMorePhotos = []) {
  const bounded = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  return needMorePhotos.length ? Math.min(bounded, 70) : bounded;
}
