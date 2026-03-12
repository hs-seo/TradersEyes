/**
 * Wilder RSI 계산
 * 반환 배열 길이 = closes.length
 * 처음 period 개는 NaN
 */
export function calculateRSI(closes: number[], period = 14): number[] {
  if (closes.length < period + 1) {
    return new Array(closes.length).fill(NaN);
  }

  const rsi: number[] = new Array(period).fill(NaN);

  let avgGain = 0;
  let avgLoss = 0;

  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) avgGain += change;
    else avgLoss += Math.abs(change);
  }

  avgGain /= period;
  avgLoss /= period;

  const rs0 = avgLoss === 0 ? Infinity : avgGain / avgLoss;
  rsi.push(100 - 100 / (1 + rs0));

  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    const rs = avgLoss === 0 ? Infinity : avgGain / avgLoss;
    rsi.push(100 - 100 / (1 + rs));
  }

  return rsi;
}
