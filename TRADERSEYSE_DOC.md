# TradersEyes — 시스템 문서

> ICT/SMC 기반 Order Block 자동 탐지 + Discord 알림 봇
> 마지막 업데이트: 2026-03-12

---

## 1. 프로젝트 개요

바이낸스 코인 시장에서 ICT(Inner Circle Trader) / SMC(Smart Money Concepts) 개념인 **Order Block(OB)** 을 알고리즘으로 자동 탐지하고, Discord를 통해 **S급(골든존) 진입 자리만 자동 알림**을 보내는 트레이딩 보조 봇이다.

### 핵심 철학

| 알림 방식 | 조건 | 채널 |
|---|---|---|
| 🚨 **S급 자동 푸시** | 골든존 조건 충족 시 | Discord 자동 전송 |
| 📌 **A급/B급 조회** | 사용자가 원할 때 | 슬래시 커맨드 `/poi`, `/alert` |
| 📊 **심볼 상세 분석** | 개별 심볼 확인 | `/analyze <symbol>` |

---

## 2. 아키텍처

```
src/
├── index.ts                    엔트리포인트 (봇 + cron 시작)
│
├── config.ts                   환경변수, 상수, 심볼 목록
│
├── data/
│   ├── types.ts                Candle 인터페이스
│   └── fetcher.ts              ccxt Binance OHLCV fetch
│
├── indicators/
│   ├── rsi.ts                  Wilder RSI (period=14)
│   └── divergence.ts           일반 다이버전스 탐지
│
├── engine/                     OB 탐지 엔진
│   ├── types.ts                OrderBlock, OBStatus 타입
│   ├── utils.ts                calcATR, bodyHigh/Low, genId
│   ├── detector.ts             오케스트레이터 (탐지 → 무효화 → 중복제거)
│   ├── conditions/
│   │   ├── trend-continuation.ts   조건1: 추세 중간 횡보 후 이탈
│   │   ├── range-breakout.ts       조건2: 장기 횡보 돌파
│   │   └── reversal-point.ts       조건3: 변곡점 반전 (Swing H/L + 거래량)
│   ├── filters/
│   │   ├── invalidation.ts     무효화 필터 (forming 판단)
│   │   └── rsi-filter.ts       RSI 가중치 (극한 +2, 다이버전스 +3)
│   └── prioritizer.ts          OB 우선순위 정렬
│
├── analysis/
│   ├── analyzer.ts             전체 분석 파이프라인
│   ├── multi-timeframe.ts      MTF 진입 설계 (entry/SL/TP1/TP2)
│   ├── choch.ts                CHoCH / BOS 구조 탐지
│   └── grader.ts               S/A/B 등급 판별 (점수제)
│
├── store/
│   └── ob-store.ts             OB 상태 JSON 저장 (data/ob-store.json)
│
├── bot/
│   ├── client.ts               Discord Client, sendToChannel
│   ├── formatter.ts            등급별 Discord embed 생성
│   └── commands/
│       ├── deploy.ts           슬래시 커맨드 Discord 등록
│       ├── analyze.ts          /analyze 핸들러
│       ├── status.ts           /status 핸들러
│       ├── poi.ts              /poi 핸들러
│       └── alert.ts            /alert 핸들러
│
├── scheduler/
│   └── cron.ts                 1H × 7심볼 자동 분석, S급만 알림
│
└── scripts/
    ├── chart-generator.ts      @napi-rs/canvas 차트 이미지 생성
    └── send-chart.ts           수동 차트 전송 스크립트
```

---

## 3. 분석 파이프라인

```
fetchOHLCV(4h, 1h, 15m)
    │
    ├── RSI(14) + 다이버전스 계산
    │
    ├── OB 탐지 (detector.ts)
    │   ├── 조건1: trend-continuation  (4H)
    │   ├── 조건2: range-breakout      (4H)
    │   ├── 조건3: reversal-point      (4H + 1H)
    │   │
    │   ├── [무효화 먼저] 연속 2회 종가 이탈 OR 1% 큰 이탈 → invalidated
    │   └── [중복 제거] 동일 방향 zone 50% 이상 겹침 → 낮은 score 제거
    │
    ├── MTF 진입 설계 (multi-timeframe.ts)
    │   ├── 15m 현재가가 OB zone 0.5배 거리 이내 → isNear
    │   ├── 진입 시그널: 장악형 / 핀바 / BOS
    │   ├── TP1 = entry + risk × 2 (RR 2:1)
    │   └── TP2 = 반대 방향 OB까지 OR entry + risk × 3
    │
    ├── CHoCH / BOS 탐지 (choch.ts)
    │   ├── 15m: scanBars=80, swingLookback=3
    │   └── 1H:  scanBars=60, swingLookback=3
    │
    └── OB 등급 판별 (grader.ts)
        ├── CHoCH 확인     +3점
        ├── BOS 확인       +2점
        ├── MTF Confluence +3점  (4H + 1H 같은 방향 zone 겹침)
        ├── OB touched     +2점
        ├── RSI 극한       +2점  (RSI ≥75 or ≤25)
        ├── 다이버전스     +3점
        └── 4H timeframe   +1점
            ─────────────────────
            S급: 7점 이상 + isNear  → 자동 Discord 알림
            A급: 4~6점              → /poi, /alert 조회
            B급: 3점 이하           → 배경 감시
```

---

## 4. OB 탐지 조건 상세

### 조건1: trend-continuation (추세 중간 횡보)
- HH+HL(상승추세) 또는 LH+LL(하락추세) 스윙 구조 확인
- 횡보 구간: 5~15캔들, ATR 0.3배 이내 range
- OB 존: 횡보 마지막 3캔들 body 범위
- 이탈: 종가 기준 zone 돌파

### 조건2: range-breakout (장기 횡보 돌파)
- 횡보 구간: 10~30캔들
- 장대캔들 이탈: body > 평균 body × 1.5배
- OB 존: 횡보 마지막 3캔들 body 범위

### 조건3: reversal-point (변곡점 반전)
- Swing High/Low: SWING_LOOKBACK=5 (마지막 2캔들 전까지 탐지)
- 거래량 필터: 최근 5캔들 평균 > 직전 30캔들 평균
- 장악형 또는 핀바 캔들 패턴 확인

### OB 무효화 기준
- 연속 2개 캔들 종가 이탈 → `invalidated`
- 단일 캔들 1% 이상 큰 이탈 → `invalidated` (즉시)
- 이탈 후 1~3캔들 내 재진입 → `forming` (보류)

### RSI 가중치
- RSI ≥ 75 또는 ≤ 25 → `inRsiExtreme = true`, confidenceScore +2
- 다이버전스 동반 → `hasDivergence = true`, confidenceScore +3

---

## 5. CHoCH / BOS 개념

| 구분 | 정의 | 의미 |
|---|---|---|
| **BOS** (Break of Structure) | 현재 추세 방향 스윙 레벨 돌파 | 추세 지속 확인 |
| **CHoCH** (Change of Character) | 반대 방향 스윙 레벨 돌파 | 추세 전환 시그널 |

**활용**: OB zone 도달 후 LTF(15m/1H)에서 CHoCH 발생 시 → 진입 확정 신호

---

## 6. 실행 방법

### 환경 설정

```bash
# .env 파일 생성
DISCORD_BOT_TOKEN=your_token
DISCORD_APPLICATION_ID=your_app_id
DISCORD_CHANNEL_ID=your_channel_id
DISCORD_GUILD_ID=your_guild_id
```

### 명령어

```bash
npm start                                    # 봇 + cron 시작
npm run deploy-commands                      # 슬래시 커맨드 Discord 등록
npm test                                     # vitest 단위 테스트

# 수동 차트 전송 (테스트용)
npx tsx src/scripts/send-chart.ts BTCUSDT

# 봇 재시작 (코드 수정 후 반드시 필요)
kill $(ps aux | grep "tsx.*index" | grep -v grep | awk '{print $2}') 2>/dev/null
nohup npx tsx src/index.ts > /tmp/traderseyes.log 2>&1 &
cat /tmp/traderseyes.log   # "[Bot] 로그인 완료" 확인

# store 초기화 (알고리즘 변경 후)
rm -f data/ob-store.json
```

### 주의사항
- `tsx`는 핫 리로드 없음 → **코드 수정 시 반드시 봇 재시작**
- store 변경 시 기존 `data/ob-store.json` 삭제 후 재실행 권장

---

## 7. Discord 슬래시 커맨드

| 커맨드 | 설명 | 반환 내용 |
|---|---|---|
| `/analyze <symbol>` | 단일 심볼 즉시 분석 | 차트 이미지 + S/A급 OB + 진입 설계 |
| `/poi` | 전체 심볼 POI 현황 | A급 이상 OB, 현재가 기준 거리순 |
| `/alert` | 현재 S급 자리 조회 | S급 OB 즉시 진입 목록 |
| `/status` | 전체 심볼 OB 요약 | 심볼별 활성 OB 수 + 근접 수 |

---

## 8. 자동 알림 체계

- **주기**: 매시 5분 (캔들 마감 후)
- **대상**: SYMBOLS 7개 (`BTCUSDT ETHUSDT SOLUSDT XRPUSDT TRXUSDT DOGEUSDT ADAUSDT`)
- **조건**: S급 OB 발생 시만 자동 전송 (중복 알림 방지: 동일 OB는 1회만)
- **내용**: 차트 이미지 + OB Zone + 진입/SL/TP1/TP2 + CHoCH/BOS 정보

---

## 9. 데이터 소스

| 항목 | 내용 |
|---|---|
| 거래소 | Binance Spot (ccxt) |
| 타임프레임 | 4H (OB 탐지) / 1H (변곡점 보완) / 15m (진입 시그널) |
| 캔들 수 | FETCH_LIMIT=300개 (약 50일치 4H 기준) |
| 심볼 형식 | `BTCUSDT` → ccxt 내부에서 `BTC/USDT` 변환 |

---

## 10. 의존성

```json
"dependencies": {
  "discord.js": "^14",
  "ccxt": "^4",
  "node-cron": "^3",
  "@napi-rs/canvas": "최신",
  "dotenv": "최신",
  "tsx": "최신"
},
"devDependencies": {
  "vitest": "최신",
  "typescript": "최신",
  "@types/node-cron": "최신"
}
```

---

## 11. 향후 개선 로드맵

### Phase 3 — 국장/미장 확장 (중기)

| 시장 | API | 비고 |
|---|---|---|
| 미장 (나스닥, S&P500) | Yahoo Finance / IBKR API | ccxt → 별도 fetcher 추가 |
| 국장 (삼성전자 등) | 한국투자증권 KIS API | OAuth 인증 필요, 복잡도 높음 |
| 코인 추가 심볼 | ccxt Binance | config.ts SYMBOLS 배열 추가만으로 바로 가능 |

### 추가 기능 아이디어

**가독성 / 실용성**
- [ ] **지정가 추천 자리**: ATR 기반 "이번 캔들 내 OB 도달 확률" 계산 → 야간 주문 가이드
- [ ] **매물대 클러스터 시각화**: 차트에 주요 OB 겹침 구간 강조 표시
- [ ] **진입 이후 관리 알림**: OB 터치 후 TP1/TP2 도달 시 알림

**탐지 정확도**
- [ ] **FVG (Fair Value Gap)**: OB와 함께 미충전 갭 탐지 추가
- [ ] **Liquidity Sweep 탐지**: 스윙 고점/저점 일시적 돌파 후 복귀 패턴
- [ ] **5m LTF 진입 정밀화**: 현재 15m → 5m CHoCH로 더 정밀한 진입 타이밍

**S급 기준 고도화**
- [ ] **볼륨 프로파일**: HVN(고거래량 구간) 근처 OB 가중치 추가
- [ ] **세션 필터**: 런던/뉴욕 오픈 시간대 OB 신뢰도 상향
- [ ] **피보나치 Golden Zone (0.618~0.786)**: OB + 피보 겹침 시 S급 승격

**인프라**
- [ ] **프로세스 매니저 (PM2)**: 봇 자동 재시작, 크래시 복구
- [ ] **웹 대시보드**: Discord 외 웹에서 OB 현황 조회
- [ ] **백테스트 모듈**: `backdata/` 디렉터리 데이터로 탐지 알고리즘 성능 검증

---

## 12. 알고리즘 파라미터 요약

| 파라미터 | 값 | 위치 |
|---|---|---|
| RSI 기간 | 14 | `config.ts` |
| RSI 극한 상단 | 75 | `config.ts` |
| RSI 극한 하단 | 25 | `config.ts` |
| 캔들 fetch 수 | 300 | `config.ts` |
| 무효화 연속 이탈 | 2회 | `detector.ts` |
| 무효화 큰 이탈 | 1% | `detector.ts` |
| Zone 크기 상한 | avgCandle × 3 | `detector.ts` |
| 중복 제거 겹침 | 50% 이상 | `detector.ts` |
| 최대 OB 수 (4H) | 10개 | `detector.ts` |
| 최대 OB 수 (1H) | 5개 | `analyzer.ts` |
| Swing lookback (OB) | 5 | `reversal-point.ts` |
| Swing lookback (CHoCH) | 3 | `choch.ts` |
| S급 점수 기준 | 7점 이상 + isNear | `grader.ts` |
| A급 점수 기준 | 4~6점 | `grader.ts` |
| isNear 거리 기준 | 현재가 2% 이내 | `grader.ts` |
| cron 주기 | 매시 5분 | `cron.ts` |
