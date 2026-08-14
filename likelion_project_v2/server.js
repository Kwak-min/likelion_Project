/* ============================================================
   RE:GARDE — API 서버
   실행:  npm install && npm start     (기본 포트 8787)
   준비:  .env 에 OPENAI_API_KEY 채우기

   저장소는 data.json 한 파일입니다. 해커톤용으로 의존성을 줄인 구조이고,
   운영으로 넘길 때는 README 의 SQL 스키마로 옮기면 됩니다.
   ============================================================ */
import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import OpenAI from 'openai';
import 'dotenv/config';

import {
  SELL_SYSTEM, REPAIR_SYSTEM, PRICE_SEARCH, REPAIR_SEARCH, VISION_AUTH,
  SELL_REPORT_SCHEMA, REPAIR_REPORT_SCHEMA, VISION_SCHEMA
} from './prompts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.disable('x-powered-by');

/* 최소한의 보안 응답 헤더 */
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; " +
    "script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data: blob:; connect-src 'self'");
  next();
});

const PORT = process.env.PORT || 8787;
const PROD = process.env.NODE_ENV === 'production';
const DEFAULT_SECRET = 'regarde-dev-secret-change-me';
const JWT_SECRET = process.env.JWT_SECRET || DEFAULT_SECRET;
if (PROD && JWT_SECRET === DEFAULT_SECRET) {
  console.error('✖ JWT_SECRET 이 기본값입니다. 프로덕션에서는 반드시 .env 에 별도 값을 넣어 주세요.');
  process.exit(1);
}
/* 감정사 콘솔은 데모에서도 열어 둡니다. 운영(NODE_ENV=production)에서는 role 검사가 강제됩니다. */
const DEMO_ADMIN = process.env.DEMO_ADMIN ? process.env.DEMO_ADMIN === '1' : !PROD;
const BUDGET_USD = Number(process.env.BUDGET_USD || 100);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY?.trim();
if (!OPENAI_API_KEY) {
  console.error('✖ OPENAI_API_KEY 가 비어 있습니다. .env 를 확인하세요.');
  process.exit(1);
}
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

/* 모델: 대화는 싼 모델, 검색·감정은 중간 모델.
   $100 크레딧 기준 상담 약 900건 분량입니다(README 계산 참고). */
const MODEL_CHAT   = process.env.MODEL_CHAT   || 'gpt-5.6-luna';
const MODEL_SEARCH = process.env.MODEL_SEARCH || 'gpt-5.6-terra';
const MODEL_VISION = process.env.MODEL_VISION || 'gpt-5.6-terra';

/* 1M 토큰당 단가(USD). 요금이 바뀌면 여기만 고치면 됩니다. */
const RATE = {
  'gpt-4.1-mini':  { in: 0.40, out: 1.60 },
  'gpt-5.6-luna':  { in: 0.20, out: 1.20 },
  'gpt-5.6-terra': { in: 2.00, out: 12.00 },
  'gpt-5.6-sol':   { in: 5.00, out: 30.00 }
};
const WEB_SEARCH_CALL = 0.01;   // $10 / 1,000 calls

/* 화면을 같은 오리진에서 서빙하므로 기본은 CORS 가 필요 없습니다.
   다른 도메인에서 붙이려면 .env 의 CORS_ORIGIN 에 콤마로 나열하세요. */
const ORIGINS = (process.env.CORS_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
if (ORIGINS.length) app.use(cors({ origin: ORIGINS }));
else if (!PROD) app.use(cors({ origin: [/^http:\/\/localhost(:\d+)?$/, /^http:\/\/127\.0\.0\.1(:\d+)?$/] }));

/* 사진 업로드 경로만 크게, 나머지는 작게 (대용량 본문 DoS 방지) */
app.use('/api/authenticate', express.json({ limit: '25mb' }));
app.use(express.json({ limit: '256kb' }));

/* ---------- 파일 저장소 ---------- */
const DB_PATH = path.join(__dirname, 'data.json');
const blank = () => ({ users: [], orders: [], cards: [], spend: 0, seq: 100 });   // 매번 새 배열
function loadDB() {
  if (!fs.existsSync(DB_PATH)) return blank();
  try {
    const parsed = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    /* 기존 파일도 다음 기동부터 소유자 전용으로 바로잡습니다. */
    try { fs.chmodSync(DB_PATH, 0o600); } catch {}
    return { ...blank(), ...parsed };
  } catch (e) {
    /* 손상된 파일 때문에 서버가 못 뜨는 상황을 막고, 원본은 백업해 둡니다 */
    const bak = DB_PATH + '.corrupt-' + Date.now();
    fs.renameSync(DB_PATH, bak);
    console.error(`✖ data.json 을 읽지 못해 새로 시작합니다. 원본: ${bak} (${e.message})`);
    return blank();
  }
}
let DB = loadDB();
/* 쓰기 도중 프로세스가 죽어도 파일이 반쪽이 되지 않도록 임시파일에 쓴 뒤 교체합니다 */
const save = () => {
  const tmp = DB_PATH + '.tmp';
  /* 해시·빌링키가 들어 있으므로 소유자만 읽도록 저장합니다 */
  fs.writeFileSync(tmp, JSON.stringify(DB, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, DB_PATH);
};

/* ---------- 브루트포스 완화 (인메모리 슬라이딩 윈도) ---------- */
const HITS = new Map();
function rateLimit({ windowMs = 15 * 60_000, max = 10 } = {}) {
  return (req, res, next) => {
    const key = `${req.ip}|${req.path}|${normEmail(req.body?.email)}`;
    const now = Date.now();
    const list = (HITS.get(key) || []).filter(t => now - t < windowMs);
    list.push(now);
    HITS.set(key, list);
    if (HITS.size > 5000) HITS.clear();
    if (list.length > max) return res.status(429).json({ error: '시도가 너무 잦습니다. 잠시 후 다시 시도해 주세요' });
    next();
  };
}
const nextId = (p) => `${p}-${++DB.seq}`;
const normEmail = (e) => String(e || '').trim().toLowerCase();
const VALID_MODES = new Set(['sell', 'repair']);
function sanePrice(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
  const nums = ['lo', 'mo', 'hi'].map(k => Number(p[k]));
  if (nums.some(n => !Number.isFinite(n) || n < 0 || n > 1e11)) return null;
  if (nums[0] > nums[1] || nums[1] > nums[2]) return null;
  return { lo: nums[0], mo: nums[1], hi: nums[2] };
}
function validImageDataUrl(value) {
  return typeof value === 'string' &&
    /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value);
}
function luhnValid(digits) {
  let sum = 0;
  for (let i = digits.length - 1, flip = false; i >= 0; i--, flip = !flip) {
    let n = Number(digits[i]);
    if (flip && (n *= 2) > 9) n -= 9;
    sum += n;
  }
  return sum % 10 === 0;
}
/* 화면(fmtD)과 같은 표기 — 2026.08.13 */
const ymd = (d = new Date()) =>
  `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;

/* ---------- 인증 미들웨어 ---------- */
function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: '로그인이 필요합니다' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: '세션이 만료됐습니다. 다시 로그인해 주세요' });
  }
}

/* 감정사·관리자 전용 */
function appraiser(req, res, next) {
  if (['appraiser', 'admin'].includes(req.user?.role)) return next();
  if (DEMO_ADMIN) {
    console.warn(`[demo] 감정사 권한 없이 접근 허용됨 — ${req.user?.email} ${req.method} ${req.originalUrl}`);
    return next();
  }
  res.status(403).json({ error: '감정사 권한이 필요합니다' });
}

/* ---------- 비용 계산 + 예산 가드 ---------- */
function chargeOf(model, usage, searchCalls = 0) {
  const r = RATE[model] || RATE['gpt-5.6-terra'];
  const inTok = usage?.input_tokens ?? 0;
  const outTok = usage?.output_tokens ?? 0;
  return (inTok / 1e6) * r.in + (outTok / 1e6) * r.out + searchCalls * WEB_SEARCH_CALL;
}
function budgetLeft() { return BUDGET_USD - DB.spend; }
function spend(usd) { DB.spend = Number((DB.spend + usd).toFixed(6)); save(); }
function guard(res) {
  if (budgetLeft() <= 0.5) {
    res.status(429).json({ error: 'API 예산을 모두 사용했습니다. 관리자에게 문의해 주세요' });
    return false;
  }
  return true;
}

/* ---------- Responses API 헬퍼 ---------- */
function outputText(r) {
  if (r.output_text) return r.output_text;
  const msg = (r.output || []).find(o => o.type === 'message');
  return msg?.content?.find(c => c.type === 'output_text')?.text || '';
}
function countSearches(r) {
  return (r.output || []).filter(o => o.type === 'web_search_call').length;
}
function parseJSON(txt, fallback = null) {
  try { return JSON.parse(txt); }
  catch {
    const m = txt.match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch {} }
    return fallback;
  }
}

/* ============================================================
   회원가입 / 로그인
   ============================================================ */
app.post('/api/auth/signup', rateLimit({ max: 5 }), async (req, res) => {
  const { name, password, phone } = req.body || {};
  const email = normEmail(req.body?.email);   // 대소문자 차이로 계정이 갈리지 않도록 정규화
  if (!name || name.trim().length < 2 || name.trim().length > 60) return res.status(400).json({ error: '이름은 2~60자로 입력해 주세요' });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: '이메일 형식을 확인해 주세요' });
  if ((password || '').length < 8) return res.status(400).json({ error: '비밀번호는 8자 이상이어야 합니다' });
  if (!/[a-zA-Z]/.test(password) || !/\d/.test(password))
    return res.status(400).json({ error: '비밀번호에 영문과 숫자를 함께 넣어 주세요' });
  if (DB.users.some(u => u.email === email)) return res.status(409).json({ error: '이미 가입된 이메일입니다' });

  const user = {
    id: nextId('U'), name: name.trim(), email, phone: phone || '',
    hash: await bcrypt.hash(password, 10),           // 평문은 저장하지 않습니다
    role: 'customer', created: new Date().toISOString()
  };
  DB.users.push(user); save();
  const token = jwt.sign({ id: user.id, email, name: user.name, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { id: user.id, name: user.name, email, phone: user.phone, role: user.role } });
});

app.post('/api/auth/login', rateLimit({ max: 8 }), async (req, res) => {
  const { password } = req.body || {};
  const email = normEmail(req.body?.email);
  const user = DB.users.find(u => u.email === email);
  // 사용자 유무를 구분해 알려주지 않습니다(계정 존재 여부 노출 방지)
  if (!user || !(await bcrypt.compare(password || '', user.hash)))
    return res.status(401).json({ error: '이메일 또는 비밀번호가 맞지 않습니다' });
  const token = jwt.sign({ id: user.id, email, name: user.name, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { id: user.id, name: user.name, email, phone: user.phone, role: user.role } });
});

app.get('/api/me', auth, (req, res) => {
  const u = DB.users.find(x => x.id === req.user.id);
  if (!u) return res.status(404).json({ error: '계정을 찾을 수 없습니다' });
  res.json({ id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role });
});

/* ============================================================
   상담 — 한 턴씩 대화 (슬롯 채우기)
   body: { mode:'sell'|'repair', history:[{role,content}], slots:{} }
   ============================================================ */
app.post('/api/consult/message', auth, async (req, res) => {
  if (!guard(res)) return;
  const { mode = 'sell', history = [], slots = {} } = req.body || {};
  if (!VALID_MODES.has(mode)) return res.status(400).json({ error: '상담 종류를 확인해 주세요' });
  if (!Array.isArray(history) || history.length > 14 ||
      history.some(m => !m || !['user', 'assistant'].includes(m.role) ||
        typeof m.content !== 'string' || m.content.length > 4_000)) {
    return res.status(400).json({ error: '상담 내역 형식을 확인해 주세요' });
  }
  if (!slots || typeof slots !== 'object' || Array.isArray(slots)) {
    return res.status(400).json({ error: '상담 정보 형식을 확인해 주세요' });
  }
  const system = mode === 'repair' ? REPAIR_SYSTEM : SELL_SYSTEM;

  try {
    const r = await openai.responses.create({
      model: MODEL_CHAT,
      instructions: system,
      input: [
        ...history.slice(-14).map(m => ({ role: m.role, content: m.content })),
        { role: 'user', content: `[지금까지 채워진 슬롯]\n${JSON.stringify(slots)}\n\n응답은 json 객체로만 반환하세요.` }
      ],
      text: { format: { type: 'json_object' } },
      max_output_tokens: 700
    });
    const usd = chargeOf(MODEL_CHAT, r.usage);
    spend(usd);
    const data = parseJSON(outputText(r), {
      reply: '다시 한 번 말씀해 주시겠어요?', quick_replies: [], slots, ready_for_search: false
    });
    res.json({ ...data, usd, budget_left: budgetLeft() });
  } catch (e) {
    console.error('[consult/message]', e.message);
    res.status(502).json({ error: 'AI 응답을 받지 못했습니다. 잠시 후 다시 시도해 주세요' });
  }
});

/* ============================================================
   리포트 — 웹 검색으로 시세/단가를 찾아 구조화된 결과 반환
   프런트의 Report 객체와 같은 모양으로 변환해 돌려줍니다.
   ============================================================ */
app.post('/api/consult/report', auth, async (req, res) => {
  if (!guard(res)) return;
  const { mode = 'sell', slots = {}, photos = 0 } = req.body || {};
  if (!VALID_MODES.has(mode)) return res.status(400).json({ error: '상담 종류를 확인해 주세요' });
  if (!slots || typeof slots !== 'object' || Array.isArray(slots) ||
      !Number.isInteger(photos) || photos < 0 || photos > 6) {
    return res.status(400).json({ error: '상담 정보 형식을 확인해 주세요' });
  }
  const sell = mode === 'sell';
  const s = { ...slots, photos };

  try {
    const r = await openai.responses.create({
      model: MODEL_SEARCH,
      reasoning: { effort: 'medium' },
      tools: [{
        type: 'web_search',
        search_context_size: 'medium',
        user_location: { type: 'approximate', country: 'KR', timezone: 'Asia/Seoul' },
        filters: sell ? {
          allowed_domains: [
            'gugus.co.kr', 'feelway.com', 'kream.co.kr', 'bunjang.co.kr',
            'trenbe.com', 'balaan.co.kr', 'joongna.com', 'chanel.com', 'louisvuitton.com'
          ]
        } : undefined
      }],
      tool_choice: 'required',
      include: ['web_search_call.action.sources'],
      input: sell ? PRICE_SEARCH(s) : REPAIR_SEARCH(s),
      text: {
        format: {
          type: 'json_schema',
          name: sell ? 'sell_report' : 'repair_report',
          schema: sell ? SELL_REPORT_SCHEMA : REPAIR_REPORT_SCHEMA,
          strict: true
        }
      },
      max_output_tokens: 2500
    });

    const searches = countSearches(r);
    const usd = chargeOf(MODEL_SEARCH, r.usage, searches);
    spend(usd);
    const d = parseJSON(outputText(r));
    if (!d) return res.status(502).json({ error: '검색 결과를 정리하지 못했습니다. 다시 시도해 주세요' });

      const repairItems = (d.items || []).map(i => ({
        name: i.name + (i.official_only ? ' (정품 A/S 전용)' : ''),
        lo: i.low, hi: i.high, days: i.days
      }));
      const dayMax = value => Math.max(...(String(value).match(/\d+/g) || ['0']).map(Number));
      const longestRepair = repairItems.reduce((a, b) => dayMax(b.days) > dayMax(a.days) ? b : a, null);
      const report = sell ? {
      mode: 'sell', title: s.item, item: s.item, slots: s,
      created: ymd(),
      summary: d.summary,
      price: {
        lo: d.buy_low, mo: Math.round((d.buy_low + d.buy_high) / 2), hi: d.buy_high,
        mkLo: d.market_low, mkMo: d.market_mode, mkHi: d.market_high,
        n: d.sample_size, consign: d.consign_estimate
      },
      cond: s.condition,
        adj: Math.max(-0.30, Math.min(0.12,
          (d.adjustments || []).reduce((a, b) => a + (b.percent || 0), 0) / 100)),
      auth: {
        score: d.auth_score, level: d.auth_level, warn: d.warning, brand: s.item,
        checks: (d.auth_checks || []).map(c => ({ k: c.point, v: c.detail, st: c.status }))
      },
      comps: (d.comps || []).map(c => ({ t: c.title, p: c.price, src: c.source, d: c.date, url: c.url }))
    } : {
      mode: 'repair', title: s.item, item: s.item, slots: s,
      created: ymd(),
      summary: d.summary,
      price: { lo: d.total_low, mo: Math.round((d.total_low + d.total_high) / 2), hi: d.total_high, uplift: d.resale_uplift },
        items: repairItems,
        days: longestRepair?.days || '5~7일',
      auth: { score: 0, level: '-', checks: [], warn: d.caution || '', brand: '' }
    };

    res.json({ report, usd, searches, budget_left: budgetLeft() });
  } catch (e) {
    console.error('[consult/report]', e.message);
    res.status(502).json({ error: '시세를 찾지 못했습니다. 잠시 후 다시 시도해 주세요' });
  }
});

/* ============================================================
   1차 감정 (사진)
   body: { slots:{}, images:[ "data:image/jpeg;base64,..." ] }
   ============================================================ */
app.post('/api/authenticate', auth, async (req, res) => {
  if (!guard(res)) return;
  const { slots = {}, images = [] } = req.body || {};
  if (!slots || typeof slots !== 'object' || Array.isArray(slots)) {
    return res.status(400).json({ error: '상담 정보 형식을 확인해 주세요' });
  }
  if (!Array.isArray(images) || !images.length) return res.status(400).json({ error: '사진을 1장 이상 올려 주세요' });
  if (images.length > 6) return res.status(400).json({ error: '사진은 한 번에 6장까지 올릴 수 있습니다' });
  if (images.some(u => !validImageDataUrl(u))) {
    return res.status(400).json({ error: '사진은 JPEG, PNG, WebP 파일만 올려 주세요' });
  }
  if (images.some(u => u.length > 8 * 1024 * 1024)) {
    return res.status(413).json({ error: '사진 한 장은 6MB 이하여야 합니다' });
  }

  try {
    const r = await openai.responses.create({
      model: MODEL_VISION,
      reasoning: { effort: 'medium' },
      input: [{
        role: 'user',
        content: [
          { type: 'input_text', text: VISION_AUTH(slots) },
          ...images.slice(0, 6).map(url => ({ type: 'input_image', image_url: url, detail: 'high' }))
        ]
      }],
      text: { format: { type: 'json_schema', name: 'vision_auth', schema: VISION_SCHEMA, strict: true } },
      max_output_tokens: 1600
    });
    const usd = chargeOf(MODEL_VISION, r.usage);
    spend(usd);
    res.json({ result: parseJSON(outputText(r)), usd, budget_left: budgetLeft() });
  } catch (e) {
    console.error('[authenticate]', e.message);
    res.status(502).json({ error: '사진을 분석하지 못했습니다. 밝은 곳에서 다시 찍어 올려 주세요' });
  }
});

/* ============================================================
   접수 / 픽업 / 감정사 확정
   ============================================================ */
const STAGE_COUNT = { sell: 6, repair: 6, buy: 4 };

app.post('/api/orders', auth, (req, res) => {
  const { type, title, report, pickup } = req.body || {};
  if (!['sell', 'repair', 'buy'].includes(type)) return res.status(400).json({ error: '접수 종류를 확인해 주세요' });
  if (!title || String(title).trim().length < 1) return res.status(400).json({ error: '접수 제목이 필요합니다' });
  let safePickup = null;
  if (type !== 'buy') {
    if (!pickup || typeof pickup !== 'object' || Array.isArray(pickup) ||
        !['direct', 'parcel'].includes(pickup.mode) ||
        typeof pickup.addr !== 'string' || !pickup.addr.trim() || pickup.addr.length > 300 ||
        typeof pickup.date !== 'string' || pickup.date.length > 40 ||
        typeof pickup.time !== 'string' || pickup.time.length > 40) {
      return res.status(400).json({ error: '픽업 정보를 확인해 주세요' });
    }
    safePickup = {
      mode: pickup.mode, date: pickup.date.trim(), time: pickup.time.trim(),
      addr: pickup.addr.trim(), memo: typeof pickup.memo === 'string' ? pickup.memo.slice(0, 1_000) : '',
      box: Boolean(pickup.box)
    };
  }
  /* 매입·수선 금액은 클라이언트 값을 믿지 않고 AI 리포트에서만 가져옵니다.
     구매(buy)는 카탈로그가 아직 프런트에 있어 리포트에 담긴 가격을 검증만 하고 씁니다.
     TODO: 카탈로그를 서버로 옮기면 productId 로 대체하세요. */
  const sane = (p) => {
    if (!p || typeof p !== 'object') return null;
    const nums = ['lo', 'mo', 'hi'].map(k => Number(p[k]));
    if (nums.some(n => !Number.isFinite(n) || n < 0 || n > 1e11)) return null;
    return { lo: nums[0], mo: nums[1], hi: nums[2] };
  };
  const price = sanePrice(report?.price);
  if (!price) return res.status(400).json({ error: type === 'buy' ? '결제 금액을 확인해 주세요' : 'AI 리포트의 금액을 확인해 주세요' });
  const o = {
    id: nextId('RG'), userId: req.user.id, type, title: String(title).slice(0, 120),
    created: new Date().toISOString(), stage: type === 'buy' ? 0 : 1,
    price, report: report || null, pickup: safePickup,
    final: null, finalNote: ''
  };
  DB.orders.unshift(o); save();
  res.json({ order: o });
});

app.get('/api/orders', auth, (req, res) => {
  res.json({ orders: DB.orders.filter(o => o.userId === req.user.id) });
});

/* 감정사 전용 */
app.get('/api/admin/queue', auth, appraiser, (req, res) => {
  res.json({ orders: DB.orders.filter(o => o.type !== 'buy') });
});

app.post('/api/admin/orders/:id/final', auth, appraiser, (req, res) => {
  const o = DB.orders.find(x => x.id === req.params.id);
  if (!o) return res.status(404).json({ error: '접수를 찾을 수 없습니다' });
  const { final, note } = req.body || {};
  const finalNote = String(note || '').trim().slice(0, 1000);
  if (!Number.isFinite(final) || final <= 0 || final > 1e11) {
    return res.status(400).json({ error: '확정 금액을 확인해 주세요' });
  }
  const reference = Number(o.price?.mo);
  if (Number.isFinite(reference) && reference > 0 &&
      (final < reference * 0.4 || final > reference * 1.6) && finalNote.length < 12) {
    return res.status(400).json({ error: '예상가와 크게 다른 금액은 사유를 12자 이상 입력해 주세요' });
  }
  o.final = final; o.finalNote = finalNote;
  o.stage = Math.max(o.stage ?? 0, o.type === 'sell' ? 4 : 3);   // 진행 단계를 뒤로 되돌리지 않습니다
  save();
  res.json({ order: o });
});

app.post('/api/orders/:id/stage', auth, (req, res) => {
  const o = DB.orders.find(x => x.id === req.params.id);
  if (!o) return res.status(404).json({ error: '접수를 찾을 수 없습니다' });
  /* 진행 단계는 내부 업무 상태입니다. 감정사·관리자만 변경할 수 있습니다. */
  const isStaff = ['appraiser', 'admin'].includes(req.user.role) || DEMO_ADMIN;
  if (!isStaff) return res.status(403).json({ error: '감정사 권한이 필요합니다' });
  o.stage = Math.min((o.stage ?? 0) + 1, STAGE_COUNT[o.type] - 1);
  save();
  res.json({ order: o });
});

/* 고객의 매입 제안 수락은 허용하되, 그 결과를 서버에 영속합니다. */
app.post('/api/orders/:id/accept', auth, (req, res) => {
  const o = DB.orders.find(x => x.id === req.params.id && x.userId === req.user.id);
  if (!o) return res.status(404).json({ error: '접수를 찾을 수 없습니다' });
  if (o.type !== 'sell' || !o.final || o.stage !== 4) {
    return res.status(409).json({ error: '현재 수락할 수 있는 매입 제안이 없습니다' });
  }
  o.stage = STAGE_COUNT.sell - 1;
  o.acceptedAt = new Date().toISOString();
  save();
  res.json({ order: o });
});

app.post('/api/orders/:id/decline', auth, (req, res) => {
  const o = DB.orders.find(x => x.id === req.params.id && x.userId === req.user.id);
  if (!o) return res.status(404).json({ error: '접수를 찾을 수 없습니다' });
  if (o.type !== 'sell' || !o.final || o.stage !== 4) {
    return res.status(409).json({ error: '현재 반송을 요청할 수 있는 매입 제안이 없습니다' });
  }
  o.final = null;
  o.returned = true;
  o.returnedAt = new Date().toISOString();
  o.stage = STAGE_COUNT.sell - 1;
  save();
  res.json({ order: o });
});

/* 실제 PG 연동 전에는 운영 환경에서 수선비를 결제 완료로 처리하지 않습니다.
   개발 환경에서만 빌링키 흐름을 검증할 수 있도록 명시적인 개발 결제로 기록합니다. */
app.post('/api/orders/:id/repair-payment', auth, (req, res) => {
  const o = DB.orders.find(x => x.id === req.params.id && x.userId === req.user.id);
  if (!o) return res.status(404).json({ error: '접수를 찾을 수 없습니다' });
  if (o.type !== 'repair' || !o.final || o.stage !== 3) {
    return res.status(409).json({ error: '현재 결제할 수 있는 수선 견적이 없습니다' });
  }
  const card = DB.cards.find(c => c.userId === req.user.id);
  if (!card) return res.status(409).json({ error: '결제수단을 먼저 등록해 주세요' });
  if (PROD) return res.status(503).json({ error: '수선 결제 연동을 준비 중입니다. 담당자가 안내드리겠습니다' });
  o.stage = 4;
  o.payment = { status: 'development_paid', cardId: card.id, paidAt: new Date().toISOString() };
  save();
  res.json({ order: o });
});

/* ============================================================
   결제수단 — 빌링키 발급
   카드번호는 PG(포트원/토스페이먼츠)로 바로 넘기고
   우리 DB 에는 빌링키와 마스킹된 뒷 4자리만 남깁니다.
   아래는 PG 계약 전 개발용 스텁입니다. 실연동 코드는 README 참고.
   ============================================================ */
app.post('/api/billing-keys', auth, async (req, res) => {
  const { cardNumber, expiry, birth, pwd2 } = req.body || {};
  const digits = (cardNumber || '').replace(/\D/g, '');
  if (digits.length < 15) return res.status(400).json({ error: '카드번호를 확인해 주세요' });
  if (!luhnValid(digits)) return res.status(400).json({ error: '카드번호를 확인해 주세요' });
  if (!/^\d{2}\/\d{2}$/.test(expiry || '')) return res.status(400).json({ error: '유효기간을 MM/YY 형식으로 입력해 주세요' });
  if (Number(expiry.slice(0, 2)) < 1 || Number(expiry.slice(0, 2)) > 12) {
    return res.status(400).json({ error: '유효기간의 월을 확인해 주세요' });
  }
  if (!/^\d{6}$/.test(birth || '')) return res.status(400).json({ error: '생년월일 6자리를 입력해 주세요' });
  if (!/^\d{2}$/.test(pwd2 || '')) return res.status(400).json({ error: '카드 비밀번호 앞 2자리를 입력해 주세요' });

  /* ── 실연동 시 이 자리에서 PG 를 호출합니다 ──
     const pg = await fetch('https://api.portone.io/billing-keys', {
       method:'POST',
       headers:{ Authorization:`PortOne ${process.env.PORTONE_API_SECRET}`,
                 'Content-Type':'application/json' },
       body: JSON.stringify({ storeId, channelKey, customer:{ id:req.user.id },
                              method:{ card:{ credential:{ number:digits, expiryYear, expiryMonth, birthOrBusinessRegistrationNumber:birth, passwordTwoDigits:pwd2 } } } })
     }).then(r=>r.json());
     const billingKey = pg.billingKey;
  */
  const billingKey = 'billing_' + Math.random().toString(36).slice(2, 12);   // 개발용

  const card = {
    id: nextId('C'), userId: req.user.id, billingKey,
    brand: { '4': '비자', '5': '마스터', '3': '아멕스' }[digits[0]] || '국내전용',
    last4: digits.slice(-4), expiry, created: new Date().toISOString()
  };
  DB.cards.push(card); save();
  // cardNumber, pwd2 는 이 시점 이후 어디에도 남기지 않습니다
  res.json({ card: { id: card.id, brand: card.brand, last4: card.last4, expiry } });
});

app.get('/api/billing-keys', auth, (req, res) => {
  res.json({
    cards: DB.cards.filter(c => c.userId === req.user.id)
      .map(c => ({ id: c.id, brand: c.brand, last4: c.last4, expiry: c.expiry }))
  });
});

app.delete('/api/billing-keys/:id', auth, (req, res) => {
  const i = DB.cards.findIndex(c => c.id === req.params.id && c.userId === req.user.id);
  if (i < 0) return res.status(404).json({ error: '카드를 찾을 수 없습니다' });
  DB.cards.splice(i, 1); save();
  res.json({ ok: true });
});

/* ---------- 운영 확인용 ---------- */
app.get('/api/health', (req, res) => {
  /* 사용자 수·누적 지출 같은 내부 지표는 감정사/관리자에게만 (개발 모드 제외) */
  let staff = DEMO_ADMIN;
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) {
    try { staff = staff || ['appraiser', 'admin'].includes(jwt.verify(h.slice(7), JWT_SECRET).role); } catch {}
  }
  if (!staff) return res.json({ ok: true });
  res.json({
    ok: true, model: { chat: MODEL_CHAT, search: MODEL_SEARCH, vision: MODEL_VISION },
    spend_usd: DB.spend, budget_usd: BUDGET_USD, budget_left: budgetLeft(),
    users: DB.users.length, orders: DB.orders.length
  });
});

/* ---------- 프런트 정적 서빙 ----------
   서버 하나로 http://localhost:PORT 에서 화면까지 열립니다(같은 오리진이라 CORS 문제 없음). */
/* 이 앱은 인라인 단일 페이지입니다. HTML 진입점 하나만 공개하고 서버 구현·프롬프트·개발 데이터는 노출하지 않습니다. */
app.get('/', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8')
    .replace("API_BASE: ''", 'API_BASE: location.origin');
  res.type('html').send(html);
});

/* ---------- 404 / 전역 에러 ---------- */
app.use((req, res) => res.status(404).json({ error: '요청한 경로를 찾을 수 없습니다' }));
app.use((err, req, res, _next) => {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error('[unhandled]', err);
  res.status(status).json({ error: status === 400 ? '요청 형식을 확인해 주세요' : '서버에서 처리하지 못했습니다' });
});

app.listen(PORT, () => {
  console.log(`RE:GARDE — http://localhost:${PORT} (화면 + API)`);
  console.log(`남은 예산 $${budgetLeft().toFixed(2)} / $${BUDGET_USD}`);
});
