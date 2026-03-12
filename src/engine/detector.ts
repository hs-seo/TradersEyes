import type { Candle } from "../data/types";
import type { OrderBlock } from "./types";
import { detectTrendContinuationOBs } from "./conditions/trend-continuation";
import { detectRangeBreakoutOBs } from "./conditions/range-breakout";
import { detectReversalPointOBs } from "./conditions/reversal-point";
import { applyInvalidationFilter, updateOBStatus } from "./filters/invalidation";
import { applyRsiFilter } from "./filters/rsi-filter";
import { prioritize } from "./prioritizer";
import type { Divergence } from "../indicators/divergence";

interface DetectorInput {
  candles: Candle[];
  symbol: string;
  timeframe: string;
  rsiValues: number[];
  divergences: Divergence[];
}

/**
 * OB 탐지 오케스트레이터
 *
 * 1. 3가지 조건으로 OB 후보 수집
 * 2. confidence 기본값 설정 (type별)
 * 3. 무효화 필터 적용
 * 4. RSI 가중치 적용
 * 5. 우선순위 정렬
 * 6. active / touched 상태만 반환
 */
export function detectOrderBlocks({
  candles,
  symbol,
  timeframe,
  rsiValues,
  divergences,
}: DetectorInput): OrderBlock[] {
  const BASE_CONFIDENCE: Record<string, number> = {
    "trend-continuation": 5,
    "range-breakout": 4,
    "reversal-point": 4,
  };

  // 1. 후보 수집
  const candidates = [
    ...detectTrendContinuationOBs(candles, symbol, timeframe),
    ...detectRangeBreakoutOBs(candles, symbol, timeframe),
    ...detectReversalPointOBs(candles, symbol, timeframe),
  ].map((ob) => ({
    ...ob,
    rsiAtFormation: 50,
    inRsiExtreme: false,
    hasDivergence: false,
    confidenceScore: BASE_CONFIDENCE[ob.type] ?? 4,
  } as OrderBlock));

  // 2. 무효화 필터
  const filtered = candidates.map((ob) =>
    applyInvalidationFilter(ob, candles)
  );

  // 3. RSI 가중치
  const scored = filtered.map((ob) =>
    applyRsiFilter(ob, rsiValues, divergences)
  );

  // 4. forming 상태 제외
  const active = scored.filter(
    (ob) => ob.status === "active" || ob.status === "touched"
  );

  // 5. zone 크기 이상값 제거: ATR 평균의 3배 초과 zone은 제외
  const avgCandle =
    candles.slice(-20).reduce((s, c) => s + (c.high - c.low), 0) / 20;
  const sizeFiltered = active.filter(
    (ob) => ob.zoneHigh - ob.zoneLow <= avgCandle * 3
  );

  // 6. 형성 이후 전체 캔들에 대해 상태 업데이트 (중복 제거 전에 먼저 수행)
  //    무효화 기준: 연속 2개 이상 종가 이탈 OR 1% 이상 단일 큰 이탈
  const BREACH_PCT = 0.01;
  const statusUpdated = sizeFiltered.map((ob) => {
    let curr = ob;
    let breachCount = 0;

    for (let i = ob.formationCandleIndex + 1; i < candles.length; i++) {
      const c = candles[i];
      const { zoneHigh, zoneLow, direction } = curr;

      const isBreach =
        (direction === "bullish" && c.close < zoneLow) ||
        (direction === "bearish" && c.close > zoneHigh);

      const isLargeBreach =
        (direction === "bullish" && c.close < zoneLow * (1 - BREACH_PCT)) ||
        (direction === "bearish" && c.close > zoneHigh * (1 + BREACH_PCT));

      if (isBreach) {
        breachCount++;
        if (breachCount >= 2 || isLargeBreach) {
          curr = { ...curr, status: "invalidated" as const };
          break;
        }
      } else {
        breachCount = 0;

        if (curr.status === "active") {
          const isTouched =
            (direction === "bullish" && c.low <= zoneHigh && c.low >= zoneLow) ||
            (direction === "bearish" && c.high >= zoneLow && c.high <= zoneHigh);
          if (isTouched) curr = { ...curr, status: "touched" as const };
        }
      }
    }
    return curr;
  });

  // 7. invalidated 제외 후 우선순위 정렬
  const valid = statusUpdated.filter(
    (ob) => ob.status === "active" || ob.status === "touched"
  );
  const sorted = prioritize(valid);

  // 8. zone 겹침 기반 중복 제거 (무효화 이후 살아남은 것들끼리만)
  //    동일 방향에서 두 zone이 50% 이상 겹치면 낮은 confidence 제거
  const deduped: OrderBlock[] = [];
  for (const ob of sorted) {
    const overlaps = deduped.some((kept) => {
      if (kept.direction !== ob.direction) return false;
      const overlapLo = Math.max(kept.zoneLow, ob.zoneLow);
      const overlapHi = Math.min(kept.zoneHigh, ob.zoneHigh);
      if (overlapHi <= overlapLo) return false;
      const overlapSize = overlapHi - overlapLo;
      const obSize = ob.zoneHigh - ob.zoneLow;
      return overlapSize / obSize > 0.5;
    });
    if (!overlaps) deduped.push(ob);
  }

  // 9. 최대 10개 제한
  return deduped.slice(0, 10);
}
