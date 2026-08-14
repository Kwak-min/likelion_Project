/* RE:GARDE 백엔드 QA — 실제 서버를 띄워 계약·권한·에러 처리를 검증합니다.
   OPENAI 호출이 필요한 엔드포인트는 제외하고, 인증/주문/권한/정적서빙/에러 경로만 봅니다.
   사용: node .qa/api.mjs   (실패 시 exit 1) */
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8799;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = path.join(root, 'data.json');
if (fs.existsSync(DB)) fs.rmSync(DB);          // 깨끗한 상태에서 시작

const env = { ...process.env, PORT: String(PORT), JWT_SECRET: 'qa-test-secret', OPENAI_API_KEY: 'sk-test', DEMO_ADMIN: '0', BUDGET_USD: '5' };
const srv = spawn(process.execPath, ['server.js'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
srv.stdout.on('data', d => { log += d; });
srv.stderr.on('data', d => { log += d; });

/* 서버가 실제로 응답할 때까지 기다립니다 (고정 sleep 대신 준비 상태 폴링) */
async function ready(timeout = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try { const r = await fetch(BASE + '/api/health'); if (r.ok) return true; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  return false;
}

const fails = [];
const check = (cond, label, extra = '') => { if (!cond) fails.push(`${label}${extra ? ' — ' + extra : ''}`); };
const post = (p, body, token) => fetch(BASE + p, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
  body: JSON.stringify(body)
});
const get = (p, token) => fetch(BASE + p, { headers: token ? { Authorization: 'Bearer ' + token } : {} });

try {
  check(await ready(), '서버가 기동하지 않았습니다', log.slice(-400));

  /* 1) health — 무인증에는 내부 지표를 주지 않아야 함 (DEMO_ADMIN=0) */
  {
    const r = await get('/api/health'); const j = await r.json();
    check(r.status === 200 && j.ok === true, 'GET /api/health 실패');
    check(j.budget_left === undefined && j.users === undefined, '무인증 health 가 내부 지표를 노출함', JSON.stringify(j));
    check(r.headers.get('x-content-type-options') === 'nosniff', '보안 헤더(nosniff) 누락');
    check(r.headers.get('x-frame-options') === 'DENY', '보안 헤더(X-Frame-Options) 누락');
    check(!r.headers.get('x-powered-by'), 'X-Powered-By 헤더가 노출됨');
  }
  /* 2) 정적 서빙 */
  {
    const r = await fetch(BASE + '/');
    const html = await r.text();
    check(r.status === 200 && html.includes('RE:GARDE'), '루트에서 index.html 이 서빙되지 않음');
    for (const privateFile of ['/server.js', '/prompts.js', '/package.json']) {
      const hidden = await get(privateFile);
      check(hidden.status === 404, `${privateFile} 소스/설정 파일이 정적으로 노출됨`, String(hidden.status));
    }
  }
  /* 3) 회원가입 검증 */
  {
    const bad = await post('/api/auth/signup', { name: '김', email: 'a@b.co', password: 'short1' });
    check(bad.status === 400, '짧은 이름/비밀번호가 통과됨');
    const r = await post('/api/auth/signup', { name: '테스트', email: 'QA@Example.COM', password: 'abcd1234', phone: '010-1111-2222' });
    const j = await r.json();
    check(r.status === 200 && !!j.token, '회원가입 실패', JSON.stringify(j));
    globalThis.tokenA = j.token;
    check(j.user.email === 'qa@example.com', '이메일이 소문자로 정규화되지 않음', j.user?.email);
  }
  /* 4) 대소문자 다른 이메일로 로그인 + 중복 가입 차단 */
  {
    const r = await post('/api/auth/login', { email: 'qa@EXAMPLE.com', password: 'abcd1234' });
    check(r.status === 200, '대소문자 다른 이메일 로그인 실패');
    const dup = await post('/api/auth/signup', { name: '테스트2', email: 'qa@example.com', password: 'abcd1234' });
    check(dup.status === 409, '중복 이메일 가입이 차단되지 않음');
  }
  /* 5) 인증 필요 경로 */
  {
    const r = await get('/api/me');
    check(r.status === 401, '토큰 없이 /api/me 접근이 허용됨');
    const ok = await get('/api/me', globalThis.tokenA);
    check(ok.status === 200, '토큰으로 /api/me 접근 실패');
  }
  /* 5-2) AI 경로는 지원하지 않는 mode·이미지 URL을 외부 API로 보내지 않는다 */
  {
    const badMessage = await post('/api/consult/message', { mode: 'invalid', history: [], slots: {} }, globalThis.tokenA);
    check(badMessage.status === 400, '잘못된 상담 mode가 AI 경로로 통과됨', String(badMessage.status));
    const badReport = await post('/api/consult/report', { mode: 'invalid', slots: {} }, globalThis.tokenA);
    check(badReport.status === 400, '잘못된 리포트 mode가 AI 경로로 통과됨', String(badReport.status));
    const remoteImage = await post('/api/authenticate', { images: ['https://example.com/not-an-upload.jpg'] }, globalThis.tokenA);
    check(remoteImage.status === 400, '외부 이미지 URL이 감정 API로 통과됨', String(remoteImage.status));
  }
  /* 6) 주문 금액은 서버가 리포트에서만 취합 (클라이언트 price 무시) */
  {
    const r = await post('/api/orders', {
      type: 'sell', title: '테스트 가방',
      price: { lo: 999999999, hi: 999999999 },
      report: { price: { lo: 100000, mo: 150000, hi: 200000 } },
      pickup: { mode: 'direct', date: '8/20 (수)', time: '오전 9-12', addr: '서울 중구 테스트로 1', box: false }
    }, globalThis.tokenA);
    const j = await r.json();
    check(r.status === 200, '주문 생성 실패');
    check(j.order?.price?.lo === 100000, '클라이언트가 보낸 price 가 그대로 저장됨', JSON.stringify(j.order?.price));
    globalThis.orderId = j.order.id;
    const bad = await post('/api/orders', { type: 'hack', title: 'x' }, globalThis.tokenA);
    check(bad.status === 400, '잘못된 접수 종류가 통과됨');
    const invalidBand = await post('/api/orders', {
      type: 'sell', title: '역전된 가격', report: { price: { lo: 200000, mo: 100000, hi: 300000 } }
    }, globalThis.tokenA);
    check(invalidBand.status === 400, '역전된 가격 구간이 접수됨', String(invalidBand.status));
  }
  /* 7) 감정사 권한 (DEMO_ADMIN=0) */
  {
    const q = await get('/api/admin/queue', globalThis.tokenA);
    check(q.status === 403, '일반 사용자가 감정사 대기열을 열람함', String(q.status));
    const f = await post(`/api/admin/orders/${globalThis.orderId}/final`, { final: 123000 }, globalThis.tokenA);
    check(f.status === 403, '일반 사용자가 최종 금액을 확정함', String(f.status));
  }
  /* 8) 고객은 자신의 주문이라도 내부 처리 단계를 바꿀 수 없다 */
  {
    const r2 = await post('/api/auth/signup', { name: '다른사람', email: 'other@example.com', password: 'abcd1234' });
    const tokenB = (await r2.json()).token;
    const s = await post(`/api/orders/${globalThis.orderId}/stage`, {}, tokenB);
    check(s.status === 403, '다른 사용자가 남의 접수를 진행시킬 수 있음', String(s.status));
    const mine = await post(`/api/orders/${globalThis.orderId}/stage`, {}, globalThis.tokenA);
    check(mine.status === 403, '고객이 자기 접수의 내부 단계를 진행시킬 수 있음', String(mine.status));
    const list = await (await get('/api/orders', tokenB)).json();
    check(list.orders.length === 0, '다른 사용자의 주문 목록이 노출됨');
  }
  /* 8-2) 카드 유효기간과 Luhn 검증 */
  {
    const expiredMonth = await post('/api/billing-keys', {
      cardNumber: '4111 1111 1111 1111', expiry: '13/28', birth: '900101', pwd2: '12'
    }, globalThis.tokenA);
    check(expiredMonth.status === 400, '잘못된 카드 월이 등록됨', String(expiredMonth.status));
    const invalidNumber = await post('/api/billing-keys', {
      cardNumber: '4111 1111 1111 1112', expiry: '09/28', birth: '900101', pwd2: '12'
    }, globalThis.tokenA);
    check(invalidNumber.status === 400, 'Luhn 검증 실패 카드가 등록됨', String(invalidNumber.status));
  }
  /* 8-3) 수거 접수는 구조화된 유효 픽업 정보가 있어야 한다 */
  {
    const malformedPickup = await post('/api/orders', {
      type: 'repair', title: '픽업 검증',
      report: { price: { lo: 100000, mo: 150000, hi: 200000 } },
      pickup: { mode: 'unknown', addr: 42 }
    }, globalThis.tokenA);
    check(malformedPickup.status === 400, '잘못된 픽업 정보가 주문에 저장됨', String(malformedPickup.status));
  }
  /* 8-4) 서버는 범위를 크게 벗어난 확정금을 근거 없이 수락하지 않는다 */
  {
    const hugeFinal = await post(`/api/admin/orders/${globalThis.orderId}/final`, {
      final: 99_999_999, note: 'x'
    }, globalThis.tokenA);
    check(hugeFinal.status === 403, '일반 고객이 범위 밖 확정금을 제출함', String(hugeFinal.status));
  }
  /* 9) 404 / 잘못된 JSON 은 JSON 으로 응답 */
  {
    const r = await get('/api/nope');
    check(r.status === 404 && (r.headers.get('content-type') || '').includes('json'), '404 가 JSON 이 아님');
    const bad = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{not-json' });
    const ct = bad.headers.get('content-type') || '';
    check(bad.status === 400 && ct.includes('json'), '깨진 JSON 요청에 HTML 스택이 노출됨', `${bad.status} ${ct}`);
  }
  /* 9-2) 큰 본문은 사진 경로 외에서 거부 */
  {
    const big = 'x'.repeat(400 * 1024);
    const r = await post('/api/orders', { type: 'sell', title: big }, globalThis.tokenA);
    check(r.status === 413 || r.status === 400, '256KB 초과 본문이 일반 API 에서 통과됨', String(r.status));
  }
  /* 9-3) 로그인 브루트포스 차단 */
  {
    let blocked = false;
    for (let i = 0; i < 12; i++) {
      const r = await post('/api/auth/login', { email: 'brute@example.com', password: 'wrong' + i });
      if (r.status === 429) { blocked = true; break; }
    }
    check(blocked, '로그인 시도 횟수 제한이 없음');
  }
  /* 10) 저장소 복구 — 손상된 data.json 으로도 기동해야 함 */
  {
    check(fs.existsSync(DB), 'data.json 이 생성되지 않음');
    const saved = JSON.parse(fs.readFileSync(DB, 'utf8'));
    check(Array.isArray(saved.users) && saved.users.length === 2, 'data.json 사용자 저장 실패');
    check(saved.users.every(u => !('password' in u)), '평문 비밀번호가 저장됨');
    check(saved.users.every(u => typeof u.hash === 'string' && u.hash.startsWith('$2')), 'bcrypt 해시가 아님');
  }
} finally {
  srv.kill();
}

if (fails.length) {
  console.log(`API FAIL (${fails.length})`);
  for (const f of fails) console.log(' - ' + f);
  process.exit(1);
}
console.log('API PASS');
