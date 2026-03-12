import type { Candle } from "../../data/types";
import type { OrderBlock, OBStatus } from "../types";
import { bodyHigh, bodyLow, isBullish, genId } from "../utils";

const SWING_LOOKBACK = 5;
const VOLUME_PREV = 30;   // 직전 기준 봉 수
const VOLUME_RECENT = 5;  // 최근 비교 봉 수

type OBCandidate = Omit<OrderBlock, "rsiAtFormation" | "inRsiExtreme" | "hasDivergence" | "confidenceScore">;

/**
 * 조건3: 변곡점 대거래량 장악형/핀바 OB 탐지
 *
 * - Swing High/Low (전후 SWING_LOOKBACK 캔들 대비)
 * - 거래량 > 직전 20캔들 평균 × 1.5
 * - 장악형(engulfing) 또는 핀바(wick > 2× body)
 * - OB = 해당 캔들의 body
 */
export function detectReversalPointOBs(
  candles: Candle[],
  symbol: string,
  timeframe: string
): OBCandidate[] {
  const results: OBCandidate[] = [];
  // 충분한 데이터 확보: swing lookback + 직전 30 + 최근 5
  const start = SWING_LOOKBACK + VOLUME_PREV + VOLUME_RECENT;

  const MIN_LOOKFWD = 2; // 최소 이후 확인 캔들 수 (마지막 구간도 탐지 가능)

  for (let i = start; i < candles.length - MIN_LOOKFWD; i++) {
    const c = candles[i];
    const lookFwd = Math.min(SWING_LOOKBACK, candles.length - 1 - i);

    // Swing High / Low 판별
    const isSwingHigh =
      candles.slice(i - SWING_LOOKBACK, i).every((x) => x.high < c.high) &&
      candles.slice(i + 1, i + lookFwd + 1).every((x) => x.high < c.high);
    const isSwingLow =
      candles.slice(i - SWING_LOOKBACK, i).every((x) => x.low > c.low) &&
      candles.slice(i + 1, i + lookFwd + 1).every((x) => x.low > c.low);

    if (!isSwingHigh && !isSwingLow) continue;

    // 거래량 필터: 최근 5개 평균 vs 직전 30개 평균
    // i 기준: 최근 5개 = [i-4 .. i], 직전 30개 = [i-VOLUME_RECENT-VOLUME_PREV .. i-VOLUME_RECENT]
    const recentStart = i - VOLUME_RECENT + 1;
    const prevStart = recentStart - VOLUME_PREV;

    const avgRecent =
      candles.slice(recentStart, i + 1).reduce((s, x) => s + x.volume, 0) /
      VOLUME_RECENT;
    const avgPrev =
      candles.slice(prevStart, recentStart).reduce((s, x) => s + x.volume, 0) /
      VOLUME_PREV;

    if (avgRecent <= avgPrev) continue; // 최근 5개가 직전 30개보다 크지 않으면 제외

    // 캔들 패턴 필터
    const prev = candles[i - 1];
    const bodySize = Math.abs(c.close - c.open);
    const fullRange = c.high - c.low;
    const wickSize = fullRange - bodySize;

    const isEngulfing =
      bodyHigh(c) > bodyHigh(prev) && bodyLow(c) < bodyLow(prev);
    const isPinbar = bodySize > 0 && wickSize > bodySize * 2;

    if (!isEngulfing && !isPinbar) continue;

    const direction: "bullish" | "bearish" = isSwingLow ? "bullish" : "bearish";

    results.push({
      id: genId(),
      symbol,
      timeframe,
      type: "reversal-point",
      direction,
      zoneHigh: bodyHigh(c),
      zoneLow: bodyLow(c),
      status: "active" as OBStatus,
      createdAt: c.timestamp,
      formationCandleIndex: i,
    });
  }

  return results;
}
