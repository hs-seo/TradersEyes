import { fetchOHLCV } from "../data/fetcher";
import { calculateRSI } from "../indicators/rsi";
import { detectDivergences } from "../indicators/divergence";
import { detectOrderBlocks } from "../engine/detector";
import { detectReversalPointOBs } from "../engine/conditions/reversal-point";
import { applyRsiFilter } from "../engine/filters/rsi-filter";
import { mergeAndSave } from "../store/ob-store";
import { analyzeMultiTimeframe, MTFSignal } from "./multi-timeframe";
import { detectStructureBreaks, type StructureBreak } from "./choch";
import { gradeOBs, type GradedOB } from "./grader";
import { evaluateWithLLM } from "./llm-evaluator";
import type { OrderBlock, OBStatus } from "../engine/types";
import type { Candle } from "../data/types";
import { RSI_PERIOD, TIMEFRAMES } from "../config";

export interface AnalysisResult {
  symbol: string;
  analyzedAt: number;
  candles4h: Candle[];
  rsi4h: number[];
  orderBlocks: OrderBlock[];
  mtfSignals: MTFSignal[];
  gradedOBs: GradedOB[];
  breaks15m: StructureBreak[];
  breaks1h: StructureBreak[];
  currentPrice: number;
  llmComment?: string;
}

/**
 * 전체 분석 파이프라인
 *
 * fetch → RSI/Divergence 계산 → OB 탐지 → 필터/가중치
 * → store 병합 → MTF 분석 → (선택) LLM 보조 평가
 */
export async function runAnalysis(
  symbol: string,
  useLLM = false
): Promise<AnalysisResult> {
  console.log(`[Analyzer] ${symbol} 분석 시작`);

  // 1. 데이터 fetch
  const [candles4h, candles15m, candles1h] = await Promise.all([
    fetchOHLCV(symbol, TIMEFRAMES.primary),
    fetchOHLCV(symbol, TIMEFRAMES.entry),
    fetchOHLCV(symbol, "1h"),
  ]);

  // 2. 지표 계산
  const closes4h = candles4h.map((c) => c.close);
  const rsi4h = calculateRSI(closes4h, RSI_PERIOD);
  const divergences4h = detectDivergences(candles4h, rsi4h);

  // 3. 4H OB 탐지
  const detectedObs = detectOrderBlocks({
    candles: candles4h,
    symbol,
    timeframe: TIMEFRAMES.primary,
    rsiValues: rsi4h,
    divergences: divergences4h,
  });

  // 3b. 1H 변곡점 OB 탐지 (reversal-point만 — 중요 변곡점 위주)
  const closes1h = candles1h.map((c) => c.close);
  const rsi1h = calculateRSI(closes1h, RSI_PERIOD);
  const divs1h = detectDivergences(candles1h, rsi1h);
  const BREACH_PCT_1H = 0.01;
  const avgCandle1h =
    candles1h.slice(-20).reduce((s, c) => s + (c.high - c.low), 0) / 20;

  const raw1hObs = detectReversalPointOBs(candles1h, symbol, "1h")
    .map((ob) => {
      const base = {
        ...ob,
        rsiAtFormation: 50,
        inRsiExtreme: false,
        hasDivergence: false,
        confidenceScore: 3,
      } as OrderBlock;
      return applyRsiFilter(base, rsi1h, divs1h);
    })
    .filter((ob) => ob.zoneHigh - ob.zoneLow <= avgCandle1h * 3);

  // 1H OB 무효화 체크
  const valid1hObs = raw1hObs
    .map((ob) => {
      let curr = ob;
      let breachCount = 0;
      for (let i = ob.formationCandleIndex + 1; i < candles1h.length; i++) {
        const c = candles1h[i];
        const { zoneHigh, zoneLow, direction } = curr;
        const isBreach =
          (direction === "bullish" && c.close < zoneLow) ||
          (direction === "bearish" && c.close > zoneHigh);
        const isLarge =
          (direction === "bullish" && c.close < zoneLow * (1 - BREACH_PCT_1H)) ||
          (direction === "bearish" && c.close > zoneHigh * (1 + BREACH_PCT_1H));
        if (isBreach) {
          breachCount++;
          if (breachCount >= 2 || isLarge) {
            curr = { ...curr, status: "invalidated" as OBStatus };
            break;
          }
        } else {
          breachCount = 0;
          if (curr.status === "active") {
            const isTouched =
              (direction === "bullish" && c.low <= zoneHigh && c.low >= zoneLow) ||
              (direction === "bearish" && c.high >= zoneLow && c.high <= zoneHigh);
            if (isTouched) curr = { ...curr, status: "touched" as OBStatus };
          }
        }
      }
      return curr;
    })
    .filter((ob) => ob.status === "active" || ob.status === "touched")
    // 4H OB와 겹치는 1H OB 제외 (4H가 더 신뢰도 높음)
    .filter((ob1h) =>
      !detectedObs.some((ob4h) => {
        if (ob4h.direction !== ob1h.direction) return false;
        const ol = Math.max(ob4h.zoneLow, ob1h.zoneLow);
        const oh = Math.min(ob4h.zoneHigh, ob1h.zoneHigh);
        return oh > ol && (oh - ol) / (ob1h.zoneHigh - ob1h.zoneLow) > 0.5;
      })
    )
    .slice(0, 5); // 1H OB는 최대 5개

  // 4. store 병합 및 상태 업데이트
  const latest4h = candles4h[candles4h.length - 1];
  const allObs = mergeAndSave([...detectedObs, ...valid1hObs], latest4h, symbol);

  // 5. MTF 분석
  const mtfSignals = analyzeMultiTimeframe(allObs, candles15m);

  // 6. CHoCH / BOS 탐지
  const breaks15m = detectStructureBreaks(candles15m, 3, 80);
  const breaks1h  = detectStructureBreaks(candles1h,  3, 60);

  // 7. OB 등급 판별 (S/A/B)
  const currentPrice = candles15m[candles15m.length - 1].close;
  const gradedOBs = gradeOBs(allObs, currentPrice, breaks15m, breaks1h);

  const sCount = gradedOBs.filter((g) => g.grade === "S").length;
  console.log(
    `[Analyzer] ${symbol} 완료 — OB ${allObs.length}개 (S:${sCount}) | CHoCH/BOS: 15m ${breaks15m.length}개, 1H ${breaks1h.length}개`
  );

  // 8. LLM 보조 평가 (선택)
  let llmComment: string | undefined;
  if (useLLM) {
    const topObs = allObs.filter((ob) => ob.status === "active").slice(0, 5);
    llmComment = evaluateWithLLM(symbol, topObs, candles4h) || undefined;
  }

  return {
    symbol,
    analyzedAt: Date.now(),
    candles4h,
    rsi4h,
    orderBlocks: allObs,
    mtfSignals,
    gradedOBs,
    breaks15m,
    breaks1h,
    currentPrice,
    llmComment,
  };
}
