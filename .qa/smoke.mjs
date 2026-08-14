/* RE:GARDE QA 스모크 — jsdom 으로 실제 DOM 을 띄우고 화면 전환·렌더를 강제 실행합니다.
   index.html 의 최상위 선언은 const/let 이라 window 프로퍼티가 아니므로
   전부 window.eval() 로 전역 렉시컬 스코프에서 실행합니다.
   대기는 고정 sleep 이 아니라 상태 조건 폴링(until)으로 합니다.
   사용: node .qa/smoke.mjs   (실패 시 exit 1) */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const errors = [];
const vc = new VirtualConsole();
/* jsdom 은 레이아웃·스크롤을 구현하지 않습니다. 그 한계는 제품 결함이 아니므로 걸러냅니다. */
const JSDOM_GAP = /Not implemented/;
vc.on('jsdomError', e => { if (!JSDOM_GAP.test(e.message)) errors.push(`[jsdomError] ${e.message}`); });
vc.on('error', (...a) => errors.push(`[console.error] ${a.join(' ')}`));

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  virtualConsole: vc,
  url: 'http://localhost:8787/'
});
const { window } = dom;
const { document } = window;
window.addEventListener('error', e => errors.push(`[window.onerror] ${e.message}`));
window.addEventListener('unhandledrejection', e => errors.push(`[unhandledrejection] ${e.reason}`));

const tick = () => new Promise(r => setTimeout(r, 10));
const run = (label, code) => {
  try { return window.eval(code); }
  catch (e) { errors.push(`[${label}] ${e.message}`); return undefined; }
};
const val = code => { try { return window.eval(code); } catch { return undefined; } };
/* 조건이 참이 될 때까지 폴링 — 최대 timeout(ms) */
async function until(label, code, timeout = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (val(code)) return true;
    await tick();
  }
  errors.push(`[timeout] ${label} — 조건이 만족되지 않았습니다: ${code}`);
  return false;
}

const SCREENS = ['auth','home','shop','pdp','chat','quote','pickup','orders','track','my','pay','checkout','admin'];

await until('boot', `typeof go === 'function'`);

/* 1) 전역 심볼 */
for (const g of ['go','back','Auth','Shop','Consult','Report','Pickup','Orders','Track','My','Pay','Checkout','Admin','Sheet','PRODUCTS','S']) {
  if (val(`typeof ${g}`) === 'undefined') errors.push(`[global] ${g} 가 정의되지 않았습니다`);
}
if (window.history.state?.screen !== 'auth') errors.push('[history] 첫 화면이 브라우저 히스토리에 기록되지 않았습니다');
if (document.getElementById('demoNote')?.hidden) errors.push('[demo] 대본 모드의 새로고침 안내가 보이지 않습니다');

/* 2) 화면 DOM */
for (const s of SCREENS) if (!document.getElementById('s-' + s)) errors.push(`[dom] #s-${s} 섹션이 없습니다`);

/* 3) 데모 로그인 → 홈 */
run('demo', 'Auth.demo()');
await until('home 활성화', `document.getElementById('s-home').classList.contains('on')`);
if (!document.getElementById('homeGrid').children.length) errors.push('[flow] 홈 상품 그리드가 비었습니다');
if (!document.getElementById('homeBrandRow').children.length) errors.push('[flow] 홈 브랜드 스트립이 비었습니다');
if (String(val(`Report.bar(0, 0, 0)`)).includes('NaN')) errors.push('[report] 0원 구간에서 가격 막대에 NaN이 노출됩니다');

/* 4) 전 화면 라우팅 */
for (const s of SCREENS) {
  run('go:' + s, `go('${s}')`);
  if (!document.getElementById('s-' + s).classList.contains('on')) errors.push(`[route] go('${s}') 후 화면이 활성화되지 않았습니다`);
}

/* 5) 둘러보기 필터/정렬/시트 */
run('shop', `go('shop')`);
run('shop.sorts', `SORTS.forEach(s => Shop.setSort(s.v))`);
run('shop.cat', `Shop.pickCat(document.querySelector('#shopCatChips .catchip'),'가방')`);
run('shop.sheets', `Shop.catSheet();Sheet.close();Shop.brandFilterSheet();Sheet.close();Shop.gradeSheet();Sheet.close();Shop.storeSheet();Sheet.close();Shop.priceSheet();Sheet.close();Shop.brandSheet();Sheet.close()`);
run('shop.select', `Shop.toggleSelect();Shop.pick('p1');Shop.pickDone()`);
run('shop.search', `Shop.search('샤넬')`);
if (!document.getElementById('shopGrid').innerHTML.trim()) errors.push('[shop] 검색 결과 그리드가 비었습니다');
run('shop.reset', `Shop.reset()`);

/* 6) 상세 → 결제 */
run('pdp', `Shop.pdp('p1')`);
if (!document.getElementById('pdpBody').innerHTML.trim()) errors.push('[pdp] 상세 본문이 비었습니다');
const guarantee = document.querySelector('#pdpBody .seal');
if (guarantee?.tagName !== 'BUTTON') errors.push('[pdp] 보증 카드가 선택 가능한 버튼이 아닙니다');
run('pdp.guarantee', `document.querySelector('#pdpBody .seal').click()`);
if (guarantee?.getAttribute('aria-pressed') !== 'true' || !guarantee?.classList.contains('selected')) {
  errors.push('[pdp] 보증 카드 선택 상태가 반영되지 않습니다');
}
run('checkout', `Checkout.open(PRODUCTS[0])`);

/* 7) 매입 상담 → 리포트 (mock 전 구간) */
run('consult.start', `Consult.start('sell')`);
await until('상담 첫 질문', `document.querySelectorAll('#chatQuick button').length > 0`);
for (const a of ['루이비통 카푸신 MM','2년 이내 · 백화점','사용감 약간','데이트코드 있음','사진 없이 진행할게요']) {
  run('consult:' + a, `Consult.quick(${JSON.stringify(a)})`);
  await until('턴 종료: ' + a, `S.consult && S.consult.busy === false`, 12000);
}
await until('매입 리포트 렌더', `S.quote && document.getElementById('quoteBody').innerHTML.trim().length > 0`, 12000);
if (val(`document.getElementById('s-quote').classList.contains('on')`) !== true) errors.push('[consult] 리포트 화면으로 이동하지 않았습니다');

/* 8) 수선 상담도 한 바퀴 */
run('consult.repair', `Consult.start('repair')`);
await until('수선 첫 질문', `document.querySelectorAll('#chatQuick button').length > 0`);
for (const a of ['가방 가죽','모서리 까짐','사진 없이 진행할게요','3년 미만 · 수선 이력 없음','최대한 새것처럼']) {
  run('repair:' + a, `Consult.quick(${JSON.stringify(a)})`);
  await until('턴 종료: ' + a, `S.consult && S.consult.busy === false`, 12000);
}
await until('수선 리포트 렌더', `S.quote && S.quote.mode === 'repair' && document.getElementById('quoteBody').innerHTML.trim().length > 0`, 12000);

/* 9) 픽업 신청 */
run('pickup.open', `Pickup.open()`);
run('pickup.fill', `document.getElementById('pkAddr').value='서울 강남구 테헤란로 1';document.getElementById('pkPhone').value='010-1234-5678'`);
run('pickup.submit', `Pickup.submit()`);
if (!val('S.orders.length')) errors.push('[pickup] 접수가 생성되지 않았습니다');
run('sheet.close', `Sheet.close()`);

/* 10) 접수 목록 / 진행 상세 / 감정사 콘솔 */
run('orders', `go('orders');Orders.render();Orders.filter(document.querySelector('#ordFilt button'),'all')`);
run('track', `Track.open(S.orders[0].id)`);
run('admin', `go('admin');Admin.render()`);
run('admin.finalize', `Admin.finalize(S.orders.find(o=>o.type!=='buy').id)`);
run('admin.saveFinal', `Admin.saveFinal(S.orders.find(o=>o.type!=='buy').id)`);

/* 11) 결제수단 등록 */
const cardCountBeforeForm = val('S.cards.length');
run('pay.form', `go('pay');Pay.form()`);
if (!document.getElementById('cAgree')) errors.push('[pay] 카드 약관 동의 컨트롤 식별자가 없습니다');
run('pay.invalid-card', `document.getElementById('cNo').value='4111 1111 1111 1112';document.getElementById('cExp').value='09/28';document.getElementById('cBirth').value='900101';document.getElementById('cPw').value='12';Pay.save()`);
if (val('S.cards.length') !== cardCountBeforeForm) errors.push('[pay] Luhn 검증에 실패한 카드가 대본 모드에 등록됩니다');
run('pay.save', `document.getElementById('cNo').value='4111 1111 1111 1111';document.getElementById('cExp').value='09/28';document.getElementById('cBirth').value='900101';document.getElementById('cPw').value='12';Pay.save()`);
if (val('S.cards.length') !== cardCountBeforeForm + 1) errors.push('[pay] 유효한 카드가 등록되지 않았습니다');
run('pay.render', `Pay.render()`);

/* 12) 마이페이지 + 로그아웃 */
run('address.save', `Address.save('서울특별시 종로구 1')`);
run('my', `go('my');My.render()`);
run('logout', `Auth.logout()`);
if (val(`localStorage.getItem(Address.KEY)`) !== null) errors.push('[privacy] 로그아웃 뒤 배송지 정보가 남아 있습니다');

/* 13) 화면 누수 값 — script/style 소스는 제외하고 실제로 보이는 텍스트만 검사 */
const walker = document.createTreeWalker(document.body, 4, {
  acceptNode: n => (n.parentElement && ['SCRIPT', 'STYLE'].includes(n.parentElement.tagName)) ? 2 : 1
});
let text = '';
while (walker.nextNode()) text += walker.currentNode.textContent + ' ';
for (const bad of ['undefined', 'NaN', '[object Object]']) {
  if (text.includes(bad)) errors.push(`[render] 화면 텍스트에 "${bad}" 가 노출됩니다`);
}

window.close();

const uniq = [...new Set(errors)];
if (uniq.length) {
  console.log('SMOKE FAIL (' + uniq.length + ')');
  for (const e of uniq) console.log(' - ' + e);
  process.exit(1);
}
console.log('SMOKE PASS');
