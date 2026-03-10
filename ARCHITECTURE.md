# TradersEyes — Architecture

ICT SMC + Elliott Wave 기반 트레이딩 분석 도구.
차트 이미지를 LLM에 넘겨 분석하고, 결과를 웹 UI 또는 Discord로 전달한다.

---

## 전체 구조

```
TradersEyes/
├── src/                        # Next.js 웹 애플리케이션
│   ├── app/
│   │   ├── page.tsx            # 실시간 분석 페이지
│   │   ├── journal/page.tsx    # 거래 복기 저널
│   │   ├── align/page.tsx      # LLM과 인식 정렬 연습
│   │   └── api/analyze/
│   │       └── route.ts        # POST /api/analyze — Claude API 호출
│   ├── components/
│   │   ├── ChartUpload.tsx     # 드래그앤드롭 / 클립보드 붙여넣기 이미지 업로드
│   │   ├── AnalysisResult.tsx  # 마크다운 렌더러
│   │   ├── MarketSelector.tsx  # 시장 / 타임프레임 선택
│   │   └── NavBar.tsx
│   └── lib/
│       ├── prompts.ts          # 분석 프롬프트 빌더 (ICT + Elliott Wave)
│       ├── types.ts            # 공용 TypeScript 타입
│       ├── storage.ts          # localStorage 기반 영속성 (Phase 1)
│       └── utils.ts
└── scripts/
    └── hourly-analysis.ts      # 자동화 스크립트 (crontab으로 매시 실행)
```

---

## 두 가지 실행 경로

### A. 웹 UI (수동 분석)

```
사용자
  │ 차트 이미지 업로드 (드래그 / 붙여넣기)
  ▼
ChartUpload.tsx
  │ base64 인코딩
  ▼
POST /api/analyze   ← route.ts
  │ buildAnalysisPrompt() 로 프롬프트 생성
  │ Anthropic SDK → claude-sonnet-4-6
  ▼
AnalysisResult.tsx  (마크다운 렌더링)
```

### B. 자동화 파이프라인 (매시간 crontab)

```
crontab (0 * * * *)
  ▼
scripts/hourly-analysis.ts
  │
  ├─ 1. captureChart()
  │      Playwright headless Chromium
  │      TradingView 위젯 embed URL → screenshot (PNG)
  │      → /tmp/tradereyes-chart-<ts>.png
  │
  ├─ 2. analyzeChart()
  │      프롬프트(stdin) + 이미지(-i) → codex exec
  │      OpenAI Codex CLI (gpt-5.4) 로 분석
  │      stdout 파싱: "codex\n<답변>\ntokens used" 구조에서 답변만 추출
  │
  └─ 3. sendToDiscord()
         multipart/form-data → Discord Webhook
         embed: 제목(KST 시간) + 분석 텍스트 + 차트 이미지 첨부
         4096자 초과 시 embed 자동 분할
```

---

## 핵심 모듈

### `src/lib/prompts.ts`

`buildAnalysisPrompt(ctx: AnalysisContext): string`

분석 모드에 따라 프롬프트를 조립한다.

| mode | 용도 | 포함 섹션 |
|------|------|-----------|
| `realtime` | 실시간 분석 | ICT + Elliott + 트레이딩 셋업 |
| `journal` | 거래 복기 | ICT + Elliott + 복기 피드백 |
| `align` | LLM과 인식 정렬 | ICT + Elliott + 셋업 + 토론 안내 |

프롬프트 구성:
- **ICT 섹션**: 시장 구조(BOS/CHoCH), 유동성(BSL/SSL), 핵심 레벨(OB/FVG), POI
- **Elliott Wave 섹션**: 현재 파동 위치, 3대 규칙 검증, 피보나치 레벨, 패턴
- **셋업 섹션**: Confluence Score(/10), 진입/SL/TP, R:R, 무효화 조건

자동화 스크립트(`hourly-analysis.ts`)는 이 함수를 import하지 않고 **인라인 단문 프롬프트**를 사용한다 (빠른 응답 우선).

### `src/lib/types.ts`

```typescript
// 지원 시장
type Market = "BTC/USDT" | "ETH/USDT" | "SOL/USDT" | "NQ" | "ES" | "CL" | "GC" | "EUR/USD" | ...

// 지원 타임프레임
type Timeframe = "1m" | "3m" | "5m" | "15m" | "30m" | "1h" | "4h" | "1D" | "1W"

// API 요청/응답
interface AnalysisRequest { imageBase64?, imageMimeType?, market, timeframe, additionalContext?, mode }
interface AnalysisResponse { analysis, error? }

// 저널 항목
interface JournalEntry { id, createdAt, market, timeframe, direction, entryPrice, exitPrice, stopLoss, takeProfit, pnl, pnlPercent, imageBase64?, notes, aiReview?, tags[] }

// Align 세션
interface AlignSession { id, createdAt, market, timeframe, imageBase64?, userAnalysis, aiAnalysis, discussionNotes, alignScore? }
```

### `src/lib/storage.ts`

localStorage 기반 CRUD. Phase 3에서 DB로 교체 예정.

```typescript
getJournalEntries() / saveJournalEntry() / deleteJournalEntry()
getAlignSessions()  / saveAlignSession()  / deleteAlignSession()
generateId()  // `${Date.now()}-${random}`
```

### `src/app/api/analyze/route.ts`

```
POST /api/analyze
  Body: AnalysisRequest (JSON)
  → buildAnalysisPrompt()
  → anthropic.messages.create({ model: "claude-sonnet-4-6", max_tokens: 4096 })
  → { analysis: string }
```

이미지가 있으면 `content: [image_block, text_block]`, 없으면 텍스트 단독 요청.

---

## 자동화 스크립트 상세: `scripts/hourly-analysis.ts`

### 환경 설정

```
.env.local
  DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
  ANTHROPIC_API_KEY=sk-ant-...   (웹 UI용, 자동화에선 미사용)
```

스크립트는 `.env.local`을 직접 파싱해서 `process.env`에 주입한다 (dotenv 미사용).

### LLM: OpenAI Codex CLI

웹 UI(Anthropic SDK)와 별개로, 자동화 스크립트는 **로컬에 설치된 Codex CLI**를 사용한다.

```
바이너리: /opt/homebrew/bin/codex
모델: gpt-5.4 (config.toml)
호출: spawnSync(codex, ["exec", "-i", imagePath], { input: prompt })
```

stdout 파싱 규칙:
```
...헤더...
codex          ← 이 줄 다음부터
<답변 텍스트>
tokens used    ← 이 줄 직전까지
...
```

### Discord 전송 포맷

```
embed.title       = "📊 BTCUSDT 15m 자동 분석 (YYYY. MM. DD. 오전/오후 HH:MM KST)"
embed.description = <분석 텍스트>
embed.image       = attachment://chart.png
embed.color       = #F0A500
embed.footer      = "TradersEyes 자동 분석 | ICT SMC + Elliott Wave | Powered by Codex"
files[0]          = chart.png (PNG binary)
```

### 자동화 프롬프트 (인라인)

```
BTCUSDT 15분봉 차트를 보고 아래 항목만 간단히 한국어로 답해줘. 6줄 이내.

1. 현재 파동 (예: 5파 상승 중, ABC 조정 B파 등)
2. 직전 파동 완료 여부
3. 다음 예상 움직임 (방향 + 타겟 레벨)
4. 핵심 무효화 레벨
5. 트레이딩 셋업 (롱/숏, 진입가, TP1/TP2, SL + 각 %)
```

### crontab 등록

```bash
# 매 정각 실행, 로그: /tmp/tradereyes-cron.log
0 * * * * cd /Users/hs/Desktop/Zorba/TradersEyes && node node_modules/.bin/tsx scripts/hourly-analysis.ts >> /tmp/tradereyes-cron.log 2>&1
```

---

## 기술 스택

| 레이어 | 기술 |
|--------|------|
| 프레임워크 | Next.js 16 (App Router, TypeScript) |
| 스타일 | Tailwind CSS v4 |
| UI 컴포넌트 | shadcn/ui (base-ui 기반) |
| LLM — 웹 UI | Anthropic SDK → claude-sonnet-4-6 |
| LLM — 자동화 | OpenAI Codex CLI (gpt-5.4) |
| 차트 캡처 | Playwright (Chromium headless) |
| 차트 소스 | TradingView Widget Embed (로그인 불필요) |
| 알림 | Discord Webhook (multipart/form-data) |
| 스크립트 실행 | tsx (TypeScript 직접 실행) |
| 스케줄링 | macOS crontab |
| 영속성 (현재) | localStorage |
| 영속성 (예정) | DB (Phase 3) |

---

## 환경변수 일람

| 변수 | 사용처 | 필수 여부 |
|------|--------|-----------|
| `ANTHROPIC_API_KEY` | 웹 UI → `/api/analyze` | 웹 UI 사용 시 필수 |
| `DISCORD_WEBHOOK_URL` | 자동화 스크립트 | 자동화 사용 시 필수 |

---

## Phase 로드맵

| Phase | 상태 | 내용 |
|-------|------|------|
| 1 | ✅ 완료 | 웹 UI + API 라우트 + 자동화 스크립트 + Discord 연동 |
| 2 | 🔲 예정 | OHLCV 엔진 (ccxt), ICT/Elliott 자동 탐지 |
| 3 | 🔲 예정 | DB 연동, 영속성 고도화 |
| 4 | 🔲 예정 | 멀티타임프레임 정렬, 히스토리 트래킹 |

---

## 다른 LLM/환경으로 포팅 시 교체 지점

| 항목 | 현재 | 교체 방법 |
|------|------|-----------|
| 웹 UI LLM | Anthropic SDK (claude-sonnet-4-6) | `route.ts`의 `anthropic.messages.create()` 교체 |
| 자동화 LLM | Codex CLI (`codex exec`) | `analyzeChart()` 내 `spawnSync` 호출 부분 교체 |
| 차트 소스 | TradingView Widget Embed | `captureChart()` 내 URL 교체 |
| 알림 채널 | Discord Webhook | `sendToDiscord()` 전체 교체 |
| 프롬프트 | `src/lib/prompts.ts` | `buildAnalysisPrompt()` 수정 |
| 스케줄러 | macOS crontab | 동일한 tsx 명령어를 다른 스케줄러에 등록 |
