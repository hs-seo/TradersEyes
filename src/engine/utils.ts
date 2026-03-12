import type { Candle } from "../data/types";

/** Wilder ATR. 인덱스 0..period-2 = NaN, period-1부터 유효 */
export function calcATR(candles: Candle[], period = 14): number[] {
  const n = candles.length;
  const tr = new Array<number>(n);

  tr[0] = candles[0].high - candles[0].low;
  for (let i = 1; i < n; i++) {
    tr[i] = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close)
    );
  }

  const atr = new Array<number>(n).fill(NaN);
  if (n < period) return atr;

  let sum = 0;
  for (let i = 0; i < period; i++) sum += tr[i];
  atr[period - 1] = sum / period;

  for (let i = period; i < n; i++) {
    atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period;
  }

  return atr;
}

export function bodyHigh(c: Candle): number {
  return Math.max(c.open, c.close);
}

export function bodyLow(c: Candle): number {
  return Math.min(c.open, c.close);
}

export function isBullish(c: Candle): boolean {
  return c.close >= c.open;
}

export function genId(): string {
  return `ob_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}
