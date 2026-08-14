/* RE:GARDE 통합 QA — 실제 서버 + 실제 프런트(jsdom)로 프런트↔백엔드 계약을 검증합니다.
   OpenAI 가 필요한 상담/리포트 엔드포인트는 제외하고, 인증·접수·결제수단·감정사 경로만 봅니다.
   사용: node .qa/integration.mjs   (실패 시 exit 1) */
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8798;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = path.join(root, 'data.json');
if (fs.existsSync(DB)) fs.rmSync(DB);

const env = { ...process.env, PORT: String(PORT), JWT_SECRET: 'qa-integration', OPENAI_API_KEY: 'sk-test', DEMO_ADMIN: '1' };
const srv = spawn(process.execPath, ['server.js'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
let srvLog = '';
srv.stdout.on('data', d => { srvLog += d; });
srv.stderr.on('data', d => { srvLog += d; });

const fails = [];
const check = (cond, label, extra = '') => { if (!cond) fails.push(`${label}${extra ? ' — ' + extra : ''}`); };

async function ready(timeout = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try { if ((await fetch(BASE + '/api/health')).ok) return true; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  return false;
}

try {
  check(await ready(), '서버 기동 실패', srvLog.slice(-300));

  /* 프런트를 서버 모드로 띄웁니다 */
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
    .replace("API_BASE: ''", `API_BASE: '${BASE}'`);
  check(html.includes(`API_BASE: '${BASE}'`), 'API_BASE 주입 실패 — CONFIG 형태가 바뀌었습니다');

  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => { if (!/Not implemented/.test(e.message)) errors.push(e.message); });
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc, url: BASE + '/',
    beforeParse(window) { window.fetch = (...a) => globalThis.fetch(...a); }   // jsdom 에는 fetch 가 없습니다
  });
  const { window } = dom;
  const doc = window.document;
  const run = (label, code) => { try { return window.eval(code); } catch (e) { fails.push(`[${label}] ${e.message}`); } };
  const val = code => { try { return window.eval(code); } catch { return undefined; } };
  const until = async (label, code, timeout = 10000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) { if (val(code)) return true; await new Promise(r => setTimeout(r, 20)); }
    fails.push(`[timeout] ${label}: ${code}`); return false;
  };

  await until('부팅', `typeof go === 'function'`);
  check(val('API.on()') === true, '프런트가 서버 모드로 인식하지 않음');

  /* 1) 회원가입이 실제 서버 계정을 만든다 */
  run('signup', `
    Auth.mode('join');
    document.getElementById('i-name').value='통합테스트';
    document.getElementById('i-email').value='Integration@Example.com';
    document.getElementById('i-pw').value='abcd1234!';
    document.getElementById('i-pw2').value='abcd1234!';
    document.getElementById('i-phone').value='010-9999-8888';
    document.querySelectorAll('#joinTerms .trm').forEach(t => t.classList.add('on'));
    document.getElementById('authForm').dispatchEvent(new window.Event('submit', {cancelable:true}));
  `);
  await until('토큰 발급', `!!S.token`);
  check(val('S.user && S.user.email') === 'integration@example.com', '서버가 정규화한 이메일이 반영되지 않음', String(val('S.user && S.user.email')));
  check(val(`document.getElementById('s-home').classList.contains('on')`) === true, '가입 후 홈으로 진입하지 않음');

  /* 2) 세션이 localStorage 에 저장된다 */
  check(!!val(`localStorage.getItem('regarde.session')`), '세션이 저장되지 않음');

  /* 3) 픽업 접수가 서버에 생성된다 (금액은 리포트 기준) */
  run('quote', `
    S.consult = {mode:'sell', step:5, slots:{item:'루이비통 카푸신 MM', purchase:'2년 이내 · 백화점',
      condition:'사용감 약간', evidence:'데이트코드 있음', photos:0}, photos:[], msgs:[], done:true, kb:AUTHKB['루이비통']};
    S.quote = Report.build(S.consult);
    Pickup.open();
    document.getElementById('pkAddr').value='서울 강남구 테헤란로 1';
    document.getElementById('pkPhone').value='010-9999-8888';
    Pickup.submit();
  `);
  await until('접수 생성', `S.orders.length > 0 && /^RG-/.test(S.orders[0].id)`);
  {
    const token = val('S.token');
    const list = await (await fetch(BASE + '/api/orders', { headers: { Authorization: 'Bearer ' + token } })).json();
    check(list.orders?.length === 1, '서버에 접수가 저장되지 않음', JSON.stringify(list).slice(0, 200));
    const srvOrder = list.orders[0];
    check(srvOrder.type === 'sell' && !!srvOrder.pickup?.addr, '접수 내용(픽업 정보)이 서버에 저장되지 않음');
    check(srvOrder.price?.lo === val('S.quote.price.lo'), '서버 저장 금액이 리포트 금액과 다름',
      `${srvOrder.price?.lo} vs ${val('S.quote.price.lo')}`);
    check(val(`/^\\d{4}\\.\\d{2}\\.\\d{2}$/.test(S.orders[0].created)`) === true, '접수 날짜 표기가 화면 형식과 다름', String(val('S.orders[0].created')));
  }

  /* 4) 카드 등록이 서버 빌링키로 이어지고 화면에 undefined 가 없다 */
  run('card', `
    go('pay'); Pay.form();
    document.getElementById('cNo').value='4111 1111 1111 1111';
    document.getElementById('cExp').value='09/28';
    document.getElementById('cBirth').value='900101';
    document.getElementById('cPw').value='12';
    Pay.save();
  `);
  await until('카드 등록', `S.cards.length > 0`);
  check(val('S.cards[0].last4') === '1111', '서버가 준 카드 정보가 반영되지 않음');
  check(val('S.cards[0].expiry') === '09/28', '카드 유효기간 필드명이 서버와 어긋남', String(val('S.cards[0].expiry')));
  check(!doc.getElementById('payBody').textContent.includes('undefined'), '결제수단 화면에 undefined 노출');
  {
    const token = val('S.token');
    const cards = await (await fetch(BASE + '/api/billing-keys', { headers: { Authorization: 'Bearer ' + token } })).json();
    check(cards.cards?.length === 1, '서버에 빌링키가 저장되지 않음');
    const raw = JSON.parse(fs.readFileSync(DB, 'utf8'));
    check(raw.cards.every(c => !('cardNumber' in c) && !('pwd2' in c)), '카드 원본 정보가 서버에 저장됨');
  }

  /* 5) 감정사 콘솔이 서버 대기열을 읽고 최종 금액을 서버에 반영한다 */
  run('admin', `go('admin')`);
  await until('대기열 로드', `Array.isArray(S.queue) && S.queue.length > 0`);
  run('finalize', `Admin.finalize(S.queue[0].id); document.getElementById('fnPrice').value='7770000'; Admin.saveFinal(S.queue[0].id)`);
  await until('최종 금액 반영', `S.queue[0].final === 7770000`, 10000);
  {
    const token = val('S.token');
    const list = await (await fetch(BASE + '/api/orders', { headers: { Authorization: 'Bearer ' + token } })).json();
    check(list.orders[0].final === 7770000, '서버에 최종 금액이 저장되지 않음', String(list.orders[0].final));
    check(list.orders[0].stage >= 4, '최종 금액 확정 후 단계가 올라가지 않음', String(list.orders[0].stage));
  }

  /* 6) 고객 수락은 서버에 영속되어 새로고침 후에도 단계가 유지된다 */
  run('accept-final', `Track.open(S.orders[0].id); Track.accept()`);
  await until('수락 단계 영속', `S.orders[0].stage === STAGES.sell.length - 1`);
  {
    const token = val('S.token');
    const list = await (await fetch(BASE + '/api/orders', { headers: { Authorization: 'Bearer ' + token } })).json();
    check(list.orders[0].stage === 5, '고객 수락 단계가 서버에 저장되지 않음', String(list.orders[0].stage));
    check(list.orders[0].acceptedAt, '고객 수락 시각이 서버에 저장되지 않음');
  }
  /* 7) 고객 반송 요청도 서버 상태에 저장된다 (수락 완료 건과 별도 제안을 생성) */
  run('create-decline-order', `(async () => {
    const source = S.orders[0];
    const created = await API.createOrder({
      type: 'sell', title: '반송 검증용 접수', report: source.report, pickup: source.pickup
    });
    await API.finalize(created.order.id, 7770000, '반송 흐름의 서버 영속성을 검증하는 감정사 안내 메모입니다.');
    await Orders.sync();
    Track.open(created.order.id);
    Track.decline(document.querySelector('#trackActions .btn'));
  })()`);
  await until('반송 상태 영속', `S.orders.some(o => o.returned === true && o.final === null)`);
  {
    const token = val('S.token');
    const list = await (await fetch(BASE + '/api/orders', { headers: { Authorization: 'Bearer ' + token } })).json();
    check(list.orders.some(o => o.returned === true && o.final === null), '반송 요청이 서버에 저장되지 않음');
  }

  /* 8) 로그아웃하면 세션이 지워진다 */
  run('logout', `Auth.logout()`);
  check(!val(`localStorage.getItem('regarde.session')`), '로그아웃 후에도 세션이 남음');
  check(val('S.token') === null, '로그아웃 후에도 토큰이 남음');

  /* 9) 런타임 에러 없음 */
  check(errors.length === 0, '프런트 런타임 에러', errors.join(' | ').slice(0, 300));
  window.close();
} finally {
  srv.kill();
}

if (fails.length) {
  console.log(`INTEGRATION FAIL (${fails.length})`);
  for (const f of fails) console.log(' - ' + f);
  process.exit(1);
}
console.log('INTEGRATION PASS');
