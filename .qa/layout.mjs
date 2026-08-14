/* RE:GARDE 레이아웃 QA — 실제 Chrome 으로 여러 뷰포트에서 "잘림/삐져나감"을 잡습니다.
   검사 항목
     1) 가로 스크롤 발생 (document.scrollWidth > innerWidth)
     2) 뷰포트 밖으로 나간 엘리먼트 (right > vw, left < 0)
     3) overflow:hidden 인데 내용이 넘쳐 잘린 엘리먼트 (가로/세로)
     4) 화면 하단 고정 CTA(.stick / .tabbar) 가 뷰포트 밖으로 밀린 경우
     5) 터치 타깃이 지나치게 작은 버튼(모바일 폭에서만)
   사용: node .qa/layout.mjs [--json]
*/
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pageUrl = pathToFileURL(path.join(root, 'index.html')).href;

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
].find(p => fs.existsSync(p));
if (!CHROME) { console.log('LAYOUT SKIP — Chrome/Edge 를 찾지 못했습니다'); process.exit(0); }

const VIEWPORTS = [
  { w: 320, h: 700, name: '320 (iPhone SE 가로 최소)' },
  { w: 360, h: 740, name: '360 (안드로이드 표준)' },
  { w: 390, h: 844, name: '390 (iPhone 14)' },
  { w: 430, h: 932, name: '430 (iPhone 14 Pro Max)' },
  { w: 768, h: 1024, name: '768 (태블릿 세로)' },
  { w: 900, h: 800, name: '900 (데스크톱 진입)' },
  { w: 1280, h: 800, name: '1280 (노트북)' },
  { w: 1920, h: 1080, name: '1920 (와이드)' }
];

/* 화면별 진입 스크립트 — mock 지연 없이 상태를 직접 만들어 렌더합니다 */
/* 로그아웃은 견적을 지우므로(정상 동작) 필요할 때 다시 만들 수 있게 헬퍼를 심어 둡니다 */
const SETUP = `
  window.__mkQuote = () => {
    S.consult = {mode:'sell', step:5, slots:{item:'루이비통 카푸신 MM', purchase:'2년 이내 · 백화점',
      condition:'사용감 약간', evidence:'데이트코드 있음', photos:4}, photos:[], msgs:[], done:true,
      kb:AUTHKB['루이비통']};
    S.quote = Report.build(S.consult);
    return S.quote;
  };
  Auth.demo();
  Report.render(__mkQuote());
`;
const SCREENS = [
  { id: 'auth',     enter: `Auth.logout()` },
  { id: 'home',     enter: `Auth.demo();go('home')` },
  { id: 'shop',     enter: `go('shop')` },
  { id: 'shop-sel', enter: `go('shop');Shop.toggleSelect();Shop.pick('p1');Shop.pick('p2')`, screen: 'shop' },
  { id: 'pdp',      enter: `Shop.pdp('p14')` },
  { id: 'chat',     enter: `Consult.start('sell')`, screen: 'chat' },
  { id: 'quote',    enter: `Report.render(S.quote || __mkQuote());go('quote')` },
  { id: 'pickup',   enter: `Pickup.open()` },
  { id: 'orders',   enter: `go('orders')` },
  { id: 'track',    enter: `Track.open(S.orders[0].id)` },
  { id: 'my',       enter: `go('my')` },
  { id: 'pay',      enter: `go('pay')` },
  { id: 'checkout', enter: `Checkout.open(PRODUCTS.find(p=>p.id==='p14'))` },
  { id: 'admin',    enter: `go('admin')` },
  { id: 'sheet-cat',   enter: `go('shop');Shop.catSheet()`, screen: 'shop' },
  { id: 'sheet-brand', enter: `go('shop');Shop.brandFilterSheet()`, screen: 'shop' },
  { id: 'sheet-card',  enter: `go('pay');Pay.form()`, screen: 'pay' },
  { id: 'sheet-final', enter: `go('admin');Admin.finalize(S.orders.find(o=>o.type!=='buy').id)`, screen: 'admin' }
];

/* 880px 이상은 반드시 웹사이트형 데스크톱 정보 구조를 사용해야 합니다. */
const DESKTOP_ASSERT = `(() => {
  const numCols = sel => (getComputedStyle(document.querySelector(sel)).gridTemplateColumns.match(/\\S+/g) || []).length;
  const proof = document.querySelector('.desktop-proof');
  const hero = document.querySelector('#s-home .hero');
  const nav = document.querySelector('#webnav');
  return {
    proof: !!proof && getComputedStyle(proof).display !== 'none',
    homeCols: numCols('#homeGrid'),
    shopCols: numCols('#shopGrid'),
    heroHeight: Math.round(hero?.getBoundingClientRect().height || 0),
    nav: nav ? getComputedStyle(nav).display : 'none'
  };
})()`;

const MEASURE = `(() => {
  const vw = window.innerWidth, vh = window.innerHeight;
  const out = { hScroll: document.documentElement.scrollWidth - vw, outside: [], clipped: [], offscreen: [], tiny: [] };
  const label = el => {
    const id = el.id ? '#' + el.id : '';
    const cls = (el.className && typeof el.className === 'string') ? '.' + el.className.trim().split(/\\s+/).slice(0,3).join('.') : '';
    const txt = (el.textContent || '').trim().replace(/\\s+/g,' ').slice(0, 28);
    return el.tagName.toLowerCase() + id + cls + (txt ? ' « ' + txt + ' »' : '');
  };
  const visible = el => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  /* 자기 텍스트를 직접 가진 요소만 "잘림" 판정 대상 */
  const ownsText = el => [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim().length > 0);
  /* 장식용(배경 일러스트/아이콘)은 잘려도 정상 */
  const decorative = el => el.closest('.fig, .shot, .badges, .pw-meter, .steps') !== null
    || el.getAttribute('aria-hidden') === 'true';
  /* 가장 가까운 오버플로 조상 정보 */
  const clipper = el => {
    let n = el.parentElement;
    while (n && n !== document.documentElement) {
      const cs = getComputedStyle(n);
      if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible')
        return { node: n, ox: cs.overflowX, oy: cs.overflowY, rect: n.getBoundingClientRect() };
      n = n.parentElement;
    }
    return null;
  };
  const scrollableX = el => {
    let n = el.parentElement;
    while (n && n !== document.documentElement) {
      const ox = getComputedStyle(n).overflowX;
      if ((ox === 'auto' || ox === 'scroll') && n.scrollWidth > n.clientWidth + 1) return true;
      n = n.parentElement;
    }
    return false;
  };

  const all = [...document.querySelectorAll('body *')].filter(el => {
    if (['SCRIPT','STYLE','svg','path','circle','rect','line','g','defs','SVG'].includes(el.tagName)) return false;
    const scr = el.closest('.screen');
    if (scr && !scr.classList.contains('on')) return false;
    return true;
  }).filter(visible);

  for (const el of all) {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const ci = clipper(el);

    /* 1) 뷰포트 밖으로 나가 도달할 수 없음 (가로 스크롤 컨테이너 안이면 정상) */
    if ((r.right > vw + 1 || r.left < -1) && !scrollableX(el) && !decorative(el) && cs.position !== 'fixed'
        && (ownsText(el) || el.tagName === 'BUTTON' || el.tagName === 'INPUT' || el.tagName === 'A')) {
      out.outside.push({ el: label(el), left: Math.round(r.left), right: Math.round(r.right), vw });
    }

    /* 2) overflow:hidden 조상에 의해 실제로 잘린 텍스트 */
    if (ci && ownsText(el) && !decorative(el)) {
      const hardX = ci.ox === 'hidden' || ci.ox === 'clip';
      const hardY = ci.oy === 'hidden' || ci.oy === 'clip';
      if (hardX && r.right > ci.rect.right + 1.5)
        out.clipped.push({ el: label(el), axis: 'x', by: label(ci.node), over: Math.round(r.right - ci.rect.right) });
      if (hardY && r.bottom > ci.rect.bottom + 1.5)
        out.clipped.push({ el: label(el), axis: 'y', by: label(ci.node), over: Math.round(r.bottom - ci.rect.bottom) });
    }

    /* 3) 터치 타깃 (모바일 폭에서 주요 버튼만) */
    if (vw <= 430 && el.matches('.tabbar button, .btn, .fbtn, .catchip, .chip, .bk, .seg button, .quick button')) {
      if (r.height > 0 && r.height < 30) out.tiny.push({ el: label(el), h: Math.round(r.height) });
    }
  }

  /* 4) 하단 고정 CTA 가 뷰포트 밖(스크롤해야만 보임) */
  for (const sel of ['.screen.on .stick:not([hidden])', '#tabbar:not([hidden])']) {
    const el = document.querySelector(sel);
    if (el && visible(el)) {
      const r = el.getBoundingClientRect();
      if (r.top >= vh - 1 || r.bottom > vh + 1)
        out.offscreen.push({ el: label(el), top: Math.round(r.top), bottom: Math.round(r.bottom), vh });
    }
  }
  return out;
})()`;

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--allow-file-access-from-files', '--hide-scrollbars'] });
const issues = [];

for (const vp of VIEWPORTS) {
  const page = await browser.newPage();
  await page.setViewport({ width: vp.w, height: vp.h, deviceScaleFactor: 1 });
  await page.goto(pageUrl, { waitUntil: 'load' });
  await page.evaluate(SETUP);
  for (const sc of SCREENS) {
    try {
      await page.evaluate(sc.enter);
      await new Promise(r => setTimeout(r, 60));
      const m = await page.evaluate(MEASURE);
      const where = `${vp.name} / ${sc.id}`;
      if (vp.w >= 880 && sc.id === 'home') {
        const d = await page.evaluate(DESKTOP_ASSERT);
        if (!d.proof || d.homeCols < 4 || d.heroHeight < 500 || d.nav === 'none')
          issues.push(`[데스크톱구조] ${where} — landing=${d.proof}, 상품열=${d.homeCols}, hero=${d.heroHeight}px, nav=${d.nav}`);
      }
      if (vp.w >= 1180 && sc.id === 'shop') {
        const d = await page.evaluate(DESKTOP_ASSERT);
        if (d.shopCols < 5 || d.nav === 'none')
          issues.push(`[데스크톱카탈로그] ${where} — 상품열=${d.shopCols}, nav=${d.nav}`);
      }
      if (m.hScroll > 1) issues.push(`[가로스크롤] ${where} — 문서 폭이 뷰포트보다 ${m.hScroll}px 넓습니다`);
      for (const o of m.outside.slice(0, 4)) issues.push(`[화면밖] ${where} — ${o.el} (left ${o.left}, right ${o.right} > ${o.vw})`);
      for (const c of m.clipped.slice(0, 4)) issues.push(`[잘림-${c.axis}] ${where} — ${c.el} (내용 ${c.content} > 박스 ${c.box})`);
      for (const o of m.offscreen) issues.push(`[CTA밖] ${where} — ${o.el} (top ${o.top}, bottom ${o.bottom} / vh ${o.vh})`);
      for (const t of m.tiny.slice(0, 3)) issues.push(`[터치타깃] ${where} — ${t.el} 높이 ${t.h}px`);
      await page.evaluate(`Sheet.close()`);
    } catch (e) {
      issues.push(`[에러] ${vp.name} / ${sc.id} — ${e.message.split('\n')[0]}`);
    }
  }
  await page.close();
}
await browser.close();

const uniq = [...new Set(issues)];
if (process.argv.includes('--json')) console.log(JSON.stringify(uniq, null, 1));
else {
  if (!uniq.length) console.log('LAYOUT PASS — 모든 뷰포트에서 잘림/삐져나감 없음');
  else { console.log(`LAYOUT FAIL (${uniq.length})`); for (const i of uniq) console.log(' - ' + i); }
}
process.exit(uniq.length ? 1 : 0);
