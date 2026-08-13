# RE:GARDE

**중고 명품 거래 + 수선을 하나로 합친 플랫폼**
`re-`(다시 거래한다) + `garder`(프랑스어: 지키다·보관하다) + `regard`(소중히 여기다)
태그라인 — **CARE MAKES VALUE** / 잘 관리한 명품이 제값을 받도록.

로고는 **감정 인장(원)** 안에 **R**을 넣고, 다리 한 획만 **점선(바느질 자국)** 으로 처리했습니다.
거래(원=인증 씰)와 수선(점선=스티치)이라는 두 축이 한 글자에 들어갑니다.
같은 점선 모티프를 화면 전체의 구분선으로 반복해 브랜드 언어로 씁니다.

---

## 무엇을 합쳤나

| | 구구스에서 가져온 것 | 쿨화이트에서 가져온 것 | RE:GARDE가 더한 것 |
|---|---|---|---|
| 매입 | 매입 · 위탁 판매 · 감정사 검수 | — | **AI가 실거래가를 검색해 구간을 먼저 제시** |
| 수선 | 품목별 보증·무상/유상 기준 | 사진 기반 견적 문의, 1~2주 소요 안내 | **증상별 항목·비용을 AI가 자동 산출** |
| 물류 | 매장 방문 · 택배 접수 | 직접 픽업 / 택배 픽업 + 안심 박스 | 두 방식을 한 폼에서 선택 |
| 신뢰 | 전 상품 감정사 감정 | 30년 경력 기술팀 | **1차 AI → 2차 전문가, 2단계로 분리** |

핵심 논리는 이겁니다. **2021년에 루이비통(3월)과 샤넬(5월)이 각인 코드와 홀로그램 스티커를
없애고 내장 칩으로 바꿨습니다.** 게다가 미러급 복제품은 코드 형식까지 재현합니다.
그래서 **코드 한 줄로는 진품을 확정할 수 없습니다.** AI가 위험 신호만 걸러내고,
확정은 사람이 실물로 하는 2단계 구조가 필요한 이유이자 이 서비스의 명분입니다.

---

## 실행

### 1. 화면만 보기 (설치 없음)
`index.html`을 브라우저로 열면 끝입니다. API 키 없이 **대본 모드**로 전 기능이 동작합니다.
발표 시연은 이 상태로 해도 됩니다.

### 2. 실제 GPT 붙이기
```bash
cd server
cp .env.example .env        # OPENAI_API_KEY 채우기
npm install
npm start                   # http://localhost:8787
```
그다음 `index.html` 맨 위 `CONFIG.API_BASE`를 `'http://localhost:8787'`로 바꾸면
상담과 시세 검색이 실제 API 호출로 바뀝니다. (그 외 코드는 손댈 필요 없습니다.)

```js
const CONFIG = {
  API_BASE: 'http://localhost:8787',
  ...
};
```

---

## 구조

```
regarde/
├─ index.html          프런트 전체 (단일 파일, 빌드 없음)
├─ logo.svg            로고
└─ server/
   ├─ server.js        API 서버 — 인증·상담·검색·감정·주문·빌링키
   ├─ prompts.js       프롬프트 + JSON 스키마  ← 품질 튜닝은 여기서
   ├─ package.json
   └─ .env.example
```

화면 13개: 로그인/가입 · 홈 · 둘러보기 · 상품상세 · AI상담 · 견적리포트 ·
픽업신청 · 내접수 · 진행상세 · 마이 · 결제수단 · 결제 · 감정사 콘솔

---

## AI가 들어가는 자리

```
  고객                         RE:GARDE                        GPT
   │
   ├─ 매입 상담 신청 ─────────▶ 채팅 열림
   │                            │
   │  ◀── 질문 1개씩 ───────────┤  POST /api/consult/message
   │      브랜드·모델            │  gpt-5.6-luna, JSON 출력
   │      구입 시기·구입처        │  → { reply, quick_replies, slots }
   │      사용 상태              │
   │      정품 확인 요소 ★       │  ★ 브랜드에 맞는 질문만 골라서 물음
   │      사진 4장              │    (LV는 데이트코드/칩, 샤넬은 홀로그램/NFC)
   │                            │
   ├─ 슬롯 5개 완료 ───────────▶ POST /api/consult/report
   │                            │  gpt-5.6-terra + web_search 툴
   │                            │  구구스·필웨이·크림·번개장터로 도메인 제한
   │                            │  tool_choice:'required' → 검색 반드시 실행
   │  ◀── 예상 구간 리포트 ──────┤  Structured Outputs로 스키마 고정
   │      ~에서 ~ 사이           │  → 최빈 가격대 + 근거 매물 + 감정 체크리스트
   │
   ├─ 픽업 신청 ───────────────▶ 접수 생성 (stage 1)
   │                            │
   │                            ├──▶ 감정사 콘솔에 대기열로 뜸
   │                            │    AI 초안(구간·정품 점수)을 함께 보여줌
   │  ◀── 최종 금액 제안 ────────┤    사람이 실물 보고 확정 (stage 4)
   │
   └─ 수락 / 반송 선택
```

수선 상담도 같은 구조입니다. 증상 → 사진 → 사용 이력 → 원하는 정도를 채우고,
수선 단가를 검색해 **항목별 비용·소요 기간·재판매가 상승분**을 냅니다.

### 프롬프트를 이렇게 짠 이유

`server/prompts.js`에 전부 들어 있고, 설계 원칙은 넷입니다.

1. **한 번에 하나만 묻습니다.** 폼을 채팅으로 옮기면 이탈률이 떨어집니다.
2. **브랜드를 먼저 알아낸 뒤 질문을 고릅니다.** 샤넬 고객에게 데이트코드를 묻거나,
   2021년 이후 루이비통에 "코드가 없으니 확인 불가"라고 답하면 신뢰를 잃습니다.
   `AUTH_KB` 상수에 브랜드별 체크포인트와 연도별 변경 내역을 넣어 두었습니다.
3. **AI는 절대 진품/가품을 확정하지 않습니다.** `통과 / 주의 / 보류` 세 단계로만 말합니다.
   확정은 법적 책임이 따르는 판단이라 사람이 해야 합니다.
4. **가격은 항상 구간입니다.** 단일 금액을 말하면 그게 약속이 되어 버립니다.

### 검색 품질을 위해 건 장치

```js
tools: [{ type:'web_search',
  filters:{ allowed_domains:['gugus.co.kr','feelway.com','kream.co.kr','bunjang.co.kr', ...] },
  user_location:{ type:'approximate', country:'KR', timezone:'Asia/Seoul' } }],
tool_choice:'required',                        // 검색 없이 지어내는 것 방지
include:['web_search_call.action.sources'],    // 실제로 본 URL 전부 회수
text:{ format:{ type:'json_schema', strict:true } }   // 스키마 강제
```
도메인 제한이 핵심입니다. 열어 두면 블로그 광고 글의 호가를 실거래가로 착각합니다.
프롬프트에서도 *"정가·호가 제외, 최근 3개월 판매 완료가 우선, 못 찾으면 빈 배열"* 을 못박았습니다.

---

## $100 크레딧을 어떻게 쓸까

측정 기준: 대화 6턴 + 리포트 1회(검색 3회) + 사진 감정 1회 = **상담 1건**

| 항목 | 모델 | 계산 | 비용 |
|---|---|---|---|
| 대화 6턴 | luna | (2,000 in + 200 out) × 6 | $0.004 |
| 시세 검색 | terra | 검색 3콜 $0.03 + 콘텐츠 25k in $0.05 + 1.5k out $0.018 | $0.098 |
| 사진 1차 감정 | terra | 이미지 4장 8k in + 800 out | $0.026 |
| | | **상담 1건 합계** | **약 $0.13** |

→ **$100이면 약 770건.** 해커톤 시연·테스트에는 차고 넘칩니다.

아껴야 하면 `.env`에서 `MODEL_SEARCH=gpt-5.6-luna`로 바꾸세요.
검색 콜 비용($0.01/콜)은 그대로지만 토큰값이 10분의 1이라 **상담당 $0.067 → 약 1,490건**이 됩니다.

안전장치는 서버에 이미 들어 있습니다.
- `BUDGET_USD` 초과 시 자동 차단 (429 응답)
- 응답마다 실제 사용량으로 비용을 계산해 `data.json`에 누적
- `GET /api/health`로 남은 예산 확인
- 화면 우측 상단 미터에 누적 비용 실시간 표시

> **주의:** 발표 전날 밤 무한 루프로 크레딧을 태우는 사고가 가장 흔합니다.
> OpenAI 콘솔에서 **월 사용량 한도(Usage limit)도 별도로** 걸어 두세요.

---

## 보안에서 양보하면 안 되는 두 가지

**비밀번호** — `bcrypt` 해시로만 저장합니다. 평문·단순 해시(MD5, SHA-1) 금지.
로그인 실패 시 "이메일이 없습니다 / 비밀번호가 틀립니다"를 구분해 알려주지 않습니다.
계정 존재 여부가 새어 나갑니다.

**카드 정보** — 카드번호는 **우리 서버·DB에 절대 저장하지 않습니다.**
PG(포트원·토스페이먼츠)로 넘겨 **빌링키**를 받고, 우리는 빌링키와 뒷 4자리만 보관합니다.
`server.js`의 `/api/billing-keys`에 실연동 위치를 주석으로 표시해 두었습니다.
직접 카드번호를 받는 API 방식은 PG·카드사 심사가 까다로우니, 해커톤에서는
**PG 결제창(SDK) 방식**을 쓰는 편이 빠릅니다.

---

## DB로 옮길 때 (지금은 data.json)

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
  phone TEXT, password_hash TEXT NOT NULL,
  role TEXT DEFAULT 'customer',            -- customer | appraiser | admin
  created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE orders (
  id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id),
  type TEXT NOT NULL,                      -- sell | repair | buy
  title TEXT, stage INT DEFAULT 0,
  price_low INT, price_high INT,           -- AI 예상 구간
  final_price INT, final_note TEXT,        -- 감정사 확정
  appraiser_id TEXT REFERENCES users(id),
  created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE reports (                      -- AI 1차 리포트 원본
  id TEXT PRIMARY KEY, order_id TEXT REFERENCES orders(id),
  mode TEXT, slots JSONB, payload JSONB,
  model TEXT, usd NUMERIC(10,6),           -- 건별 원가 추적
  created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE photos (
  id TEXT PRIMARY KEY, order_id TEXT REFERENCES orders(id),
  url TEXT NOT NULL, kind TEXT             -- front | code | hardware | corner
);

CREATE TABLE pickups (
  id TEXT PRIMARY KEY, order_id TEXT REFERENCES orders(id),
  mode TEXT,                               -- direct | parcel
  date TEXT, time_slot TEXT, address TEXT, need_box BOOLEAN, memo TEXT
);

CREATE TABLE billing_keys (                 -- 카드번호는 여기에도 없습니다
  id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id),
  billing_key TEXT NOT NULL, brand TEXT, last4 CHAR(4), expiry CHAR(5)
);
```

---

## 발표 시연 3분

1. **가입** — 비밀번호 강도 미터, 필수 약관 검증까지 보여주고 진입 (20초)
2. **홈에서 "명품 팔기"** — 채팅이 열림 (10초)
3. **"루이비통 카푸신 MM" 입력** → *여기가 하이라이트*.
   AI가 **2021년 3월 데이트코드 폐지**를 스스로 설명하며 브랜드에 맞는 질문을 던집니다.
   "코드가 없어도 정상"이라는 답변이 나오는 순간을 강조하세요 (50초)
4. **사진 첨부 → 검색 실행** — 검색어가 하나씩 찍히는 화면 (20초)
5. **리포트** — 구간 바에 최빈 가격대 점이 찍히고, 근거 매물 4건과
   감정 체크리스트가 나옴. **즉시 매입 vs 위탁 판매** 비교까지 (40초)
6. **픽업 신청** — 직접/택배, 안심 박스 (15초)
7. **마이 → 감정사 콘솔** — 같은 접수가 대기열에 뜸.
   AI 초안을 보고 **사람이 최종 금액 확정** (25초)
8. **고객 화면으로 돌아와 금액 수락** — 2단계 감정이 닫히는 지점 (20초)

심사위원이 반드시 묻는 질문 두 개와 답:
- *"AI가 가품을 진품이라 하면요?"* → AI는 확정하지 않습니다. 통과/주의/보류만 냅니다.
  판정과 책임은 2차 감정사에게 있고, 그래서 픽업이 구조에 들어가 있습니다.
- *"시세를 지어내지 않나요?"* → 도메인을 국내 중고 플랫폼으로 제한하고
  `tool_choice: 'required'`로 검색을 강제하며, 근거 URL을 리포트에 그대로 노출합니다.

---

## 아직 안 된 것 (솔직하게)

- 실시간 스트리밍 응답 — 지금은 완성된 답을 한 번에 보여줍니다
- 사진 업로드가 메모리에만 있음 — S3 같은 저장소 연결 필요
- 감정사 계정 권한 분리 — `role` 필드는 있지만 검사를 켜지 않았습니다
- 위탁 판매 정산 플로우, 배송 추적 연동, 알림(카카오 알림톡)
- 접근성: 스크린리더 라벨은 넣었지만 실제 테스트는 못 했습니다

---

## 팀 분업 제안

| 역할 | 파일 | 할 일 |
|---|---|---|
| 프런트 | `index.html` | 화면 다듬기, 실제 상품 이미지 교체 |
| 백엔드 | `server/server.js` | DB 이전, 사진 업로드, 권한 검사 |
| AI | `server/prompts.js` | 브랜드 추가, 검색 도메인 튜닝, 응답 품질 테스트 |
| 기획·발표 | `README.md` | 시연 대본, 심사 질문 대비, 비용 실측 |

프롬프트와 서버 코드가 분리돼 있어 **AI 담당은 `prompts.js`만 고치면 됩니다.**
서버를 재시작할 필요도 없이 `npm run dev`로 켜 두면 자동 반영됩니다.
