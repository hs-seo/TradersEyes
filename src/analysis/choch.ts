import type { Candle } from "../data/types";

export interface StructureBreak {
  type: "BOS" | "CHoCH";
  direction: "bullish" | "bearish"; // 새 추세 방향
  level: number;       // 돌파된 스윙 레벨
  timestamp: number;   // 돌파 캔들 타임스탬프
  candleIndex: number;
}

/**
 * CHoCH / BOS 탐지
 *
 * BOS  (Break of Structure): 현재 추세 방향 스윙 돌파 → 추세 지속
 * CHoCH (Change of Character): 반대 방향 스윙 돌파 → 추세 전환
 *
 * 알고리즘:
 *  1. swingLookback으로 스윙 고점/저점 추출
 *  2. 최근 스윙들로 추세 판단 (HH+HL → 상승, LH+LL → 하락)
 *  3. 현재 캔들 close가 스윙 레벨을 돌파하면 BOS or CHoCH 판별
 */
export function detectStructureBreaks(
  candles: Candle[],
  swingLookback = 3,
  scanBars = 80   // 최근 N캔들 내에서만 스캔
): StructureBreak[] {
  const results: StructureBreak[] = [];
  const start = Math.max(swingLookback, candles.length - scanBars);

  // 스윙 고점/저점 추출
  const swingHighs: { idx: number; price: number }[] = [];
  const swingLows: { idx: number; price: number }[] = [];

  for (let i = swingLookback; i < candles.length - swingLookback; i++) {
    const c = candles[i];
    const isHigh =
      candles.slice(i - swingLookback, i).every((x) => x.high <= c.high) &&
      candles.slice(i + 1, i + swingLookback + 1).every((x) => x.high <= c.high);
    const isLow =
      candles.slice(i - swingLookback, i).every((x) => x.low >= c.low) &&
      candles.slice(i + 1, i + swingLookback + 1).every((x) => x.low >= c.low);

    if (isHigh) swingHighs.push({ idx: i, price: c.high });
    if (isLow) swingLows.push({ idx: i, price: c.low });
  }

  // 각 캔들에서 구조 이탈 확인 (start 이후)
  for (let i = start + 1; i < candles.length; i++) {
    const c = candles[i];

    // i 이전 스윙 중 가장 최근 것
    const prevHighs = swingHighs.filter((s) => s.idx < i);
    const prevLows = swingLows.filter((s) => s.idx < i);
    if (prevHighs.length < 2 || prevLows.length < 2) continue;

    const lastHigh = prevHighs[prevHighs.length - 1];
    const prevHigh = prevHighs[prevHighs.length - 2];
    const lastLow = prevLows[prevLows.length - 1];
    const prevLow = prevLows[prevLows.length - 2];

    // 추세 판단
    const isUptrend = lastHigh.price > prevHigh.price && lastLow.price > prevLow.price;
    const isDowntrend = lastHigh.price < prevHigh.price && lastLow.price < prevLow.price;

    // 이전 스캔에서 이미 탐지한 레벨 중복 방지
    const alreadyDetected = results.some((r) => r.candleIndex === i);
    if (alreadyDetected) continue;

    // 상승추세에서 이탈 체크
    if (isUptrend) {
      // 직전 스윙 저점 하향 돌파 → CHoCH (하락 전환)
      if (c.close < lastLow.price) {
        results.push({
          type: "CHoCH",
          direction: "bearish",
          level: lastLow.price,
          timestamp: c.timestamp,
          candleIndex: i,
        });
      }
      // 직전 스윙 고점 상향 돌파 → BOS (상승 지속)
      else if (c.close > lastHigh.price) {
        results.push({
          type: "BOS",
          direction: "bullish",
          level: lastHigh.price,
          timestamp: c.timestamp,
          candleIndex: i,
        });
      }
    }

    // 하락추세에서 이탈 체크
    if (isDowntrend) {
      // 직전 스윙 고점 상향 돌파 → CHoCH (상승 전환)
      if (c.close > lastHigh.price) {
        results.push({
          type: "CHoCH",
          direction: "bullish",
          level: lastHigh.price,
          timestamp: c.timestamp,
          candleIndex: i,
        });
      }
      // 직전 스윙 저점 하향 돌파 → BOS (하락 지속)
      else if (c.close < lastLow.price) {
        results.push({
          type: "BOS",
          direction: "bearish",
          level: lastLow.price,
          timestamp: c.timestamp,
          candleIndex: i,
        });
      }
    }
  }

  return results;
}

/** 가장 최근 구조 이탈만 반환 */
export function getLatestBreak(breaks: StructureBreak[]): StructureBreak | null {
  if (breaks.length === 0) return null;
  return breaks[breaks.length - 1];
}
