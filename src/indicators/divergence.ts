import type { Candle } from "../data/types";

export interface Divergence {
  type: "bullish" | "bearish";
  fromIndex: number;
  toIndex: number;
}

function findSwingHighs(
  values: number[],
  lookback: number
): Array<{ index: number; value: number }> {
  const result: Array<{ index: number; value: number }> = [];
  for (let i = lookback; i < values.length - lookback; i++) {
    const v = values[i];
    if (isNaN(v)) continue;
    let isHigh = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j !== i && !isNaN(values[j]) && values[j] >= v) {
        isHigh = false;
        break;
      }
    }
    if (isHigh) result.push({ index: i, value: v });
  }
  return result;
}

function findSwingLows(
  values: number[],
  lookback: number
): Array<{ index: number; value: number }> {
  const result: Array<{ index: number; value: number }> = [];
  for (let i = lookback; i < values.length - lookback; i++) {
    const v = values[i];
    if (isNaN(v)) continue;
    let isLow = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j !== i && !isNaN(values[j]) && values[j] <= v) {
        isLow = false;
        break;
      }
    }
    if (isLow) result.push({ index: i, value: v });
  }
  return result;
}

/**
 * 일반 다이버전스 탐지
 * - Bearish regular: 가격 HH, RSI LH
 * - Bullish regular: 가격 LL, RSI HL
 */
export function detectDivergences(
  candles: Candle[],
  rsi: number[],
  swingLookback = 3,
  maxPivotGap = 40
): Divergence[] {
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const divergences: Divergence[] = [];

  // Bearish: 가격 HH, RSI LH
  const priceHighs = findSwingHighs(highs, swingLookback);
  const rsiHighs = findSwingHighs(rsi, swingLookback);

  for (let i = 1; i < priceHighs.length; i++) {
    const p1 = priceHighs[i - 1];
    const p2 = priceHighs[i];
    if (p2.index - p1.index > maxPivotGap) continue;
    if (p2.value <= p1.value) continue; // 가격 HH 아님

    const r1 = rsiHighs.find((r) => Math.abs(r.index - p1.index) <= swingLookback + 1);
    const r2 = rsiHighs.find((r) => Math.abs(r.index - p2.index) <= swingLookback + 1);
    if (!r1 || !r2) continue;

    if (r2.value < r1.value) {
      divergences.push({ type: "bearish", fromIndex: p1.index, toIndex: p2.index });
    }
  }

  // Bullish: 가격 LL, RSI HL
  const priceLows = findSwingLows(lows, swingLookback);
  const rsiLows = findSwingLows(rsi, swingLookback);

  for (let i = 1; i < priceLows.length; i++) {
    const p1 = priceLows[i - 1];
    const p2 = priceLows[i];
    if (p2.index - p1.index > maxPivotGap) continue;
    if (p2.value >= p1.value) continue; // 가격 LL 아님

    const r1 = rsiLows.find((r) => Math.abs(r.index - p1.index) <= swingLookback + 1);
    const r2 = rsiLows.find((r) => Math.abs(r.index - p2.index) <= swingLookback + 1);
    if (!r1 || !r2) continue;

    if (r2.value > r1.value) {
      divergences.push({ type: "bullish", fromIndex: p1.index, toIndex: p2.index });
    }
  }

  return divergences;
}
