export type AnalysisMode = "realtime" | "journal" | "align";

export interface AnalysisContext {
  market: string;
  timeframe: string;
  additionalContext?: string;
  mode: AnalysisMode;
}

export function buildAnalysisPrompt(ctx: AnalysisContext): string {
  const base = `당신은 ICT (Inner Circle Trader)의 Smart Money Concepts와 Elliott Wave 이론을 깊이 이해한 전문 트레이딩 분석가입니다.

시장: ${ctx.market}
타임프레임: ${ctx.timeframe}
${ctx.additionalContext ? `추가 정보: ${ctx.additionalContext}` : ""}

차트를 분석할 때 다음 프레임워크를 사용하세요:`;

  const ictSection = `
## ICT / Smart Money Concepts 분석

### 1. 시장 구조 (Market Structure)
- 현재 HTF (Higher Timeframe) 추세 방향
- BOS (Break of Structure) 확인 여부
- CHoCH (Change of Character) 발생 여부
- 현재 가격이 Premium/Discount zone 중 어디에 위치하는지

### 2. 유동성 분석 (Liquidity Analysis)
- Buy-side / Sell-side Liquidity 레벨 식별
- Equal Highs/Lows (유동성 풀) 위치
- Stop Hunt 가능성이 있는 구간

### 3. 핵심 레벨 (Key Levels)
- Order Block (OB): Bearish / Bullish OB 위치
- Fair Value Gap (FVG): 미채워진 FVG 구간
- Breaker Block 존재 여부
- 킬존 (Killzone) 해당 여부: London / NY / Asia

### 4. Mitigation & POI
- 현재 가격에서 가장 가까운 Point of Interest (POI)
- OB 또는 FVG로의 Mitigation 가능성`;

  const elliottSection = `
## Elliott Wave 분석

### 1. 현재 파동 위치
- 가장 큰 사이클에서 현재 예상 파동 번호 (1-5 또는 A-B-C)
- 현재 파동이 추진파(Motive)인지 조정파(Corrective)인지

### 2. 파동 규칙 검증
- Wave 2가 Wave 1의 시작점을 침범하지 않는지
- Wave 3이 Wave 1, 5 중 가장 짧지 않는지
- Wave 4가 Wave 1 영역과 겹치지 않는지

### 3. 피보나치 레벨
- Wave 2/4의 되돌림 레벨 (0.382 / 0.5 / 0.618)
- Wave 3 연장 타겟 (1.618 / 2.618)
- Wave 5 프로젝션 타겟

### 4. 파동 패턴
- 현재 관찰되는 패턴: Impulse / Zigzag / Flat / Triangle / WXY 등`;

  const setupSection = `
## 종합 분석 및 트레이딩 셋업

### Confluence Score (합류 점수)
각 항목 확인 시 점수 부여:
- [ ] HTF 추세 방향과 일치 (+2)
- [ ] ICT POI (OB/FVG) 도달 (+2)
- [ ] Elliott Wave 반전 구간 (+2)
- [ ] 유동성 스윕 완료 (+2)
- [ ] 킬존 시간대 (+1)
- [ ] 멀티타임프레임 정렬 (+1)

총점: /10

### 트레이딩 셋업 제안
- **방향:** Long / Short / 관망
- **진입 가격:** (구체적 레벨 또는 조건)
- **Stop Loss:** (레벨 + 근거)
- **Take Profit 1:** (레벨 + 근거)
- **Take Profit 2:** (레벨 + 근거)
- **Risk:Reward Ratio:**
- **신뢰도:** 높음 / 중간 / 낮음

### 주요 무효화 조건 (Invalidation)
- 이 분석이 틀렸다고 판단해야 하는 시나리오

### 모니터링 포인트
- 다음에 확인해야 할 핵심 이벤트/레벨`;

  if (ctx.mode === "journal") {
    return `${base}${ictSection}${elliottSection}

## 거래 복기 분석

위 프레임워크를 기반으로, 첨부된 차트의 거래를 다음 관점에서 복기하세요:

1. **진입 근거 평가:** ICT/Elliott 관점에서 이 진입이 적절했는가?
2. **리스크 관리:** SL 위치가 논리적이었는가?
3. **실수 분석:** 무엇을 놓쳤는가? 무엇을 잘했는가?
4. **개선점:** 같은 셋업이 다시 나온다면 어떻게 다르게 접근할 것인가?
5. **패턴 인식:** 이 거래에서 반복적으로 발생하는 실수나 강점이 있는가?

분석 결과를 구체적이고 건설적인 피드백으로 제공하세요.`;
  }

  if (ctx.mode === "align") {
    return `${base}${ictSection}${elliottSection}${setupSection}

## Align 학습 모드

이 분석은 트레이더와의 인식 정렬을 위한 것입니다.
- 가능한 한 구체적이고 명확하게 분석하세요
- 확실하지 않은 부분은 "불확실" 또는 복수의 시나리오로 표현하세요
- 트레이더가 다른 관점을 제시하면 열린 마음으로 토론하세요`;
  }

  return `${base}${ictSection}${elliottSection}${setupSection}`;
}

export function buildJournalReviewPrompt(
  market: string,
  timeframe: string,
  entryPrice: string,
  exitPrice: string,
  direction: "long" | "short",
  pnl: string,
  notes: string
): string {
  return `당신은 ICT SMC와 Elliott Wave 전문 트레이딩 코치입니다.

다음 거래를 분석하고 상세한 복기를 제공하세요:

**거래 정보:**
- 시장: ${market}
- 타임프레임: ${timeframe}
- 방향: ${direction === "long" ? "롱 (매수)" : "숏 (매도)"}
- 진입가: ${entryPrice}
- 청산가: ${exitPrice}
- 손익: ${pnl}
- 트레이더 메모: ${notes || "없음"}

첨부된 차트 이미지를 분석하여:

1. **ICT 관점 평가**
   - 진입 시점의 시장 구조
   - OB/FVG 활용 여부
   - 유동성 레벨 고려 여부

2. **Elliott Wave 관점**
   - 진입/청산 시점의 파동 위치
   - 파동 카운팅이 진입 방향을 지지했는가?

3. **총점 및 피드백**
   - 이 거래의 강점 (잘한 점)
   - 이 거래의 약점 (개선할 점)
   - 같은 상황에서 최적의 접근법

구체적이고 교육적인 피드백을 제공하세요.`;
}
