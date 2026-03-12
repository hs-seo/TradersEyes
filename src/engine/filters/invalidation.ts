import type { Candle } from "../../data/types";
import type { OrderBlock } from "../types";

/**
 * 무효화 필터: 돌파 후 1~3캔들 내 OB 영역 재진입 시 status = "forming"
 *
 * 재진입 조건: 해당 캔들의 close가 OB zone 내에 있을 때
 */
export function applyInvalidationFilter(
  ob: OrderBlock,
  candles: Candle[]
): OrderBlock {
  const { formationCandleIndex, zoneHigh, zoneLow } = ob;

  // 이미 무효/터치 상태면 건드리지 않음
  if (ob.status === "invalidated" || ob.status === "touched") return ob;

  const checkEnd = Math.min(
    formationCandleIndex + 3,
    candles.length - 1
  );

  for (let i = formationCandleIndex + 1; i <= checkEnd; i++) {
    const c = candles[i];
    const close = c.close;

    if (close >= zoneLow && close <= zoneHigh) {
      return { ...ob, status: "forming" };
    }
  }

  return ob;
}

/**
 * 현재 가격 기준 OB 상태 업데이트
 * - active → touched: 현재가가 zone 내
 * - active/touched → invalidated: 방향 반대로 zone 완전 돌파
 */
export function updateOBStatus(ob: OrderBlock, currentCandle: Candle): OrderBlock {
  if (ob.status === "invalidated" || ob.status === "forming") return ob;

  const { zoneHigh, zoneLow, direction } = ob;
  const { close, low, high } = currentCandle;

  // 무효화: 방향 반대로 zone 완전 관통
  if (direction === "bullish" && close < zoneLow) {
    return { ...ob, status: "invalidated" };
  }
  if (direction === "bearish" && close > zoneHigh) {
    return { ...ob, status: "invalidated" };
  }

  // 터치: 현재가가 zone 내
  if (ob.status === "active") {
    if (
      (direction === "bullish" && low <= zoneHigh && low >= zoneLow) ||
      (direction === "bearish" && high >= zoneLow && high <= zoneHigh)
    ) {
      return { ...ob, status: "touched" };
    }
  }

  return ob;
}
