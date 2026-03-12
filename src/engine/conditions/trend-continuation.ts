import type { Candle } from "../../data/types";
import type { OrderBlock, OBStatus } from "../types";
import { bodyHigh, bodyLow, genId, calcATR } from "../utils";

const MIN_CONSOL = 5;
const MAX_CONSOL = 15;
const ATR_MULT = 1.5;
const TREND_LOOKBACK = 20;
const ATR_PERIOD = 14;
const SWING_N = 2;       // 추세 판단용 스윙 lookback (작게 유지: trendSlice가 20캔들로 짧음)
const OB_ZONE_CANDLES = 3; // OB 존 = 횡보 마지막 N캔들 body 범위

type OBCandidate = Omit<OrderBlock, "rsiAtFormation" | "inRsiExtreme" | "hasDivergence" | "confidenceScore">;

/**
 * HH+HL → uptrend, LH+LL → downtrend, null → 불명확
 * trendSlice 내 스윙 고점/저점 2개 이상 확인
 */
function getTrendDirection(trendSlice: Candle[]): "up" | "down" | null {
  const highs: number[] = [];
  const lows: number[] = [];

  for (let i = SWING_N; i < trendSlice.length - SWING_N; i++) {
    const c = trendSlice[i];
    const isHigh =
      trendSlice.slice(i - SWING_N, i).every((x) => x.high <= c.high) &&
      trendSlice.slice(i + 1, i + SWING_N + 1).every((x) => x.high <= c.high);
    if (isHigh) highs.push(c.high);

    const isLow =
      trendSlice.slice(i - SWING_N, i).every((x) => x.low >= c.low) &&
      trendSlice.slice(i + 1, i + SWING_N + 1).every((x) => x.low >= c.low);
    if (isLow) lows.push(c.low);
  }

  if (highs.length >= 2 && lows.length >= 2) {
    const hh = highs[highs.length - 1] > highs[highs.length - 2];
    const hl = lows[lows.length - 1] > lows[lows.length - 2];
    const lh = highs[highs.length - 1] < highs[highs.length - 2];
    const ll = lows[lows.length - 1] < lows[lows.length - 2];
    if (hh && hl) return "up";   // HH + HL
    if (lh && ll) return "down"; // LH + LL
  }

  // 스윙이 불충분하면 close 방향으로 fallback (최소 2% 변화)
  const delta =
    trendSlice[trendSlice.length - 1].close - trendSlice[0].close;
  const pct = Math.abs(delta) / trendSlice[0].close;
  if (pct >= 0.02) return delta > 0 ? "up" : "down";

  return null;
}

/**
 * 조건1: 추세 중간 횡보 후 이탈 OB 탐지
 *
 * - 명확한 추세: HH+HL(상승) 또는 LH+LL(하락)
 * - 5~15개 캔들이 ATR × 1.5 이내 횡보
 * - 종가 기준 횡보 경계 돌파
 * - OB 존 = 횡보 마지막 3캔들 body 범위
 */
export function detectTrendContinuationOBs(
  candles: Candle[],
  symbol: string,
  timeframe: string
): OBCandidate[] {
  const atr = calcATR(candles, ATR_PERIOD);
  const results: OBCandidate[] = [];
  const usedConsolRanges = new Set<string>();

  for (
    let breakoutIdx = MIN_CONSOL + TREND_LOOKBACK;
    breakoutIdx < candles.length;
    breakoutIdx++
  ) {
    for (let len = MIN_CONSOL; len <= MAX_CONSOL; len++) {
      const consolStart = breakoutIdx - len;
      if (consolStart < TREND_LOOKBACK) continue;

      const rangeKey = `${consolStart}-${breakoutIdx - 1}`;
      if (usedConsolRanges.has(rangeKey)) continue;

      const atrVal = atr[consolStart] ?? atr[consolStart + 1];
      if (!atrVal || isNaN(atrVal)) continue;

      const consolSlice = candles.slice(consolStart, breakoutIdx);
      const rangeHigh = Math.max(...consolSlice.map((c) => c.high));
      const rangeLow = Math.min(...consolSlice.map((c) => c.low));

      if (rangeHigh - rangeLow > atrVal * ATR_MULT) continue; // 횡보 아님

      const breakout = candles[breakoutIdx];

      // 종가 기준 돌파 확인
      const isBullBreak = breakout.close > rangeHigh;
      const isBearBreak = breakout.close < rangeLow;
      if (!isBullBreak && !isBearBreak) continue;

      // HH+HL / LH+LL 추세 판단
      const trendSlice = candles.slice(consolStart - TREND_LOOKBACK, consolStart);
      const trend = getTrendDirection(trendSlice);

      let direction: "bullish" | "bearish" | null = null;
      if (isBullBreak && trend === "up") direction = "bullish";
      else if (isBearBreak && trend === "down") direction = "bearish";

      if (!direction) continue;

      // OB 존 = 횡보 마지막 OB_ZONE_CANDLES개 캔들 body 범위
      const obSlice = consolSlice.slice(-OB_ZONE_CANDLES);
      const zoneHigh = Math.max(...obSlice.map(bodyHigh));
      const zoneLow = Math.min(...obSlice.map(bodyLow));

      usedConsolRanges.add(rangeKey);
      results.push({
        id: genId(),
        symbol,
        timeframe,
        type: "trend-continuation",
        direction,
        zoneHigh,
        zoneLow,
        status: "active" as OBStatus,
        createdAt: breakout.timestamp,
        formationCandleIndex: breakoutIdx,
      });

      break;
    }
  }

  return results;
}
