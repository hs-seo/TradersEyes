import type { OrderBlock } from "../types";
import type { Divergence } from "../../indicators/divergence";
import { RSI_EXTREME_HIGH, RSI_EXTREME_LOW } from "../../config";

/**
 * RSI 과열권 및 다이버전스 가중치 적용
 *
 * - RSI ≥ 75 또는 ≤ 25 → inRsiExtreme = true, confidence +2
 * - 다이버전스 동반 → hasDivergence = true, confidence +3
 */
export function applyRsiFilter(
  ob: OrderBlock,
  rsiValues: number[],
  divergences: Divergence[]
): OrderBlock {
  const rsi = rsiValues[ob.formationCandleIndex];
  const rsiAtFormation = isNaN(rsi) ? 50 : rsi;

  const inRsiExtreme =
    rsiAtFormation >= RSI_EXTREME_HIGH || rsiAtFormation <= RSI_EXTREME_LOW;

  // 형성 시점 근처(±5)에 동일 방향 다이버전스 존재 여부
  const hasDivergence = divergences.some((d) => {
    const near =
      Math.abs(d.toIndex - ob.formationCandleIndex) <= 5;
    if (!near) return false;
    if (ob.direction === "bullish" && d.type === "bullish") return true;
    if (ob.direction === "bearish" && d.type === "bearish") return true;
    return false;
  });

  let confidence = ob.confidenceScore;
  if (inRsiExtreme) confidence += 2;
  if (hasDivergence) confidence += 3;

  return {
    ...ob,
    rsiAtFormation,
    inRsiExtreme,
    hasDivergence,
    confidenceScore: confidence,
  };
}
