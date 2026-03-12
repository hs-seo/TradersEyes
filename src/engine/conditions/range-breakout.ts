import type { Candle } from "../../data/types";
import type { OrderBlock, OBStatus } from "../types";
import { bodyHigh, bodyLow, isBullish, genId } from "../utils";

const MIN_RANGE_LEN = 10;
const MAX_RANGE_LEN = 30;
const BODY_MULT = 1.5;
const MAX_TREND_RATIO = 0.5; // 방향성 비율 이상이면 횡보 아님

type OBCandidate = Omit<OrderBlock, "rsiAtFormation" | "inRsiExtreme" | "hasDivergence" | "confidenceScore">;

/**
 * 조건2: 10개 이상 횡보 후 장대캔들 돌파 OB 탐지
 *
 * - 10개 이상 캔들이 레인지 형성 (방향성 낮음)
 * - 돌파 캔들: body > 레인지 평균 body × 1.5, 레인지 밖으로 종가
 * - OB = 돌파 직전 마지막 반대색 캔들의 body
 */
export function detectRangeBreakoutOBs(
  candles: Candle[],
  symbol: string,
  timeframe: string
): OBCandidate[] {
  const results: OBCandidate[] = [];
  let i = 0;

  while (i < candles.length - MIN_RANGE_LEN - 1) {
    let foundRange = false;

    for (let len = MAX_RANGE_LEN; len >= MIN_RANGE_LEN; len--) {
      const end = i + len - 1;
      if (end + 1 >= candles.length) continue;

      const rangeSlice = candles.slice(i, end + 1);
      const rangeHigh = Math.max(...rangeSlice.map((c) => c.high));
      const rangeLow = Math.min(...rangeSlice.map((c) => c.low));
      const rangeSize = rangeHigh - rangeLow;
      if (rangeSize === 0) continue;

      // 방향성 체크: 처음~끝 가격 변화가 레인지의 절반 미만이어야 횡보
      const priceDelta = Math.abs(
        rangeSlice[rangeSlice.length - 1].close - rangeSlice[0].close
      );
      if (priceDelta > rangeSize * MAX_TREND_RATIO) continue;

      // 평균 body 크기
      const avgBody =
        rangeSlice.reduce((s, c) => s + Math.abs(c.close - c.open), 0) / len;

      const breakout = candles[end + 1];
      const breakoutBody = Math.abs(breakout.close - breakout.open);

      if (breakoutBody < avgBody * BODY_MULT) continue;

      let direction: "bullish" | "bearish" | null = null;
      if (breakout.close > rangeHigh) direction = "bullish";
      else if (breakout.close < rangeLow) direction = "bearish";

      if (!direction) continue;

      // OB 존 = 레인지 마지막 3캔들 body 범위
      const obSlice = rangeSlice.slice(-3);
      const clusterHigh = Math.max(...obSlice.map(bodyHigh));
      const clusterLow = Math.min(...obSlice.map(bodyLow));

      results.push({
        id: genId(),
        symbol,
        timeframe,
        type: "range-breakout",
        direction,
        zoneHigh: clusterHigh,
        zoneLow: clusterLow,
        status: "active" as OBStatus,
        createdAt: breakout.timestamp,
        formationCandleIndex: end + 1,
      });

      i = end + 2;
      foundRange = true;
      break;
    }

    if (!foundRange) i++;
  }

  return results;
}
