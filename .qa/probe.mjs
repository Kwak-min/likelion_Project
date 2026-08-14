/* 임시 조사용 프로브 — 특정 폭에서 의심 지점의 실제 수치를 찍어봅니다.
   사용: node .qa/probe.mjs <width> <height> */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pageUrl = pathToFileURL(path.join(root, 'index.html')).href;
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));

const W = Number(process.argv[2] || 1280), H = Number(process.argv[3] || 800);
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: W, height: H });
await page.goto(pageUrl, { waitUntil: 'load' });

const report = await page.evaluate(() => {
  const box = sel => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    return { sel, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
      pos: cs.position, top: cs.top, bottom: cs.bottom, z: cs.zIndex, ov: cs.overflow };
  };
  const out = { vw: innerWidth, vh: innerHeight, docH: document.documentElement.scrollHeight, boxes: [] };
  out.boxes.push(box('.app'), box('#s-auth .auth'), box('#webnav'), box('.cost'));
  return out;
});
console.log(JSON.stringify(report, null, 1));

/* 로그인 후 홈/샵/PDP 상태 */
const after = await page.evaluate(() => {
  Auth.demo();
  const snap = {};
  const box = sel => { const el = document.querySelector(sel); if (!el) return null;
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), pos: cs.position, top: cs.top, z: cs.zIndex }; };
  snap.home = { hero: box('.hero'), heroOv: box('.hero .ov'), duo: box('.duo'), grid: box('#homeGrid'),
    cols: getComputedStyle(document.querySelector('#homeGrid')).gridTemplateColumns,
    topbar: box('.topbar'), docH: document.documentElement.scrollHeight, bodyScroll: document.documentElement.scrollWidth - innerWidth };
  go('shop');
  snap.shop = { backbar: box('#s-shop .backbar'), chips: box('#shopCatChips'), filt: box('#shopFilt'),
    cols: getComputedStyle(document.querySelector('#shopGrid')).gridTemplateColumns, grid: box('#shopGrid') };
  Shop.pdp('p1');
  snap.pdp = { pdp: box('.pdp'), heroshot: box('.pdp .heroshot'), info: box('.pdp .info'), stick: box('#s-pdp .stick'),
    backbar: box('#s-pdp .backbar') };
  go('my');
  snap.my = { pad: box('#s-my .pad'), tabbar: box('#tabbar'), bodyClass: document.body.className };
  return snap;
});
console.log(JSON.stringify(after, null, 1));
await browser.close();
