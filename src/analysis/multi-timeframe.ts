import type { Candle } from "../data/types";
import type { OrderBlock } from "../engine/types";
import { bodyHigh, bodyLow } from "../engine/utils";

export interface TradeSetup {
  direction: "bullish" | "bearish";
  ob: OrderBlock;
  isNearEntry: boolean;
  entrySignalType?: "engulfing" | "pinbar" | "break-of-structure";

  entry: number;
  stop: number;
  tp1: number;   // RR 2:1 최소 보장
  tp2: number;   // 다음 OB/변곡점 레벨 (더 큰 목표)
  rr1: number;   // 실제 RR (TP1 기준)
  rr2: number;   // 실제 RR (TP2 기준)
}

export type MTFSignal = TradeSetup; // 하위 호환 별칭

const MIN_RR = 2;

/**
 * 현재 진입 가능한 OB를 기준으로 롱/숏 전체 TradeSetup 생성
 *
 * - 4H + 1H OB zone에 현재 15m 가격이 근접했는지 확인
 * - 15m 진입 시그널(장악형, 핀바, BOS) 판별
 * - entry / stop / TP1 (RR 2:1) / TP2 (다음 OB or RR 3:1) 계산
 * - 매물대(반대방향 OB) 도달 전 TP 조정
 */
export function analyzeMultiTimeframe(
  allObs: OrderBlock[],
  candles15m: Candle[]
): TradeSetup[] {
  if (candles15m.length < 2) return [];

  const recent = candles15m[candles15m.length - 1];
  const prev = candles15m[candles15m.length - 2];
  const currentPrice = recent.close;
  const setups: TradeSetup[] = [];

  const activeObs = allObs.filter(
    (ob) => ob.status === "active" || ob.status === "touched"
  );

  for (const ob of activeObs) {
    const { zoneHigh, zoneLow, direction } = ob;
    const zoneSize = zoneHigh - zoneLow;

    // 근접 판단: zone의 0.5배 거리 이내
    const proximity = zoneSize * 0.5;
    const isNear =
      direction === "bullish"
        ? recent.low <= zoneHigh + proximity && recent.low >= zoneLow - proximity
        : recent.high >= zoneLow - proximity && recent.high <= zoneHigh + proximity;

    // 15m 진입 시그널 판별
    const bodySize = Math.abs(recent.close - recent.open);
    const fullRange = recent.high - recent.low;
    const wickSize = fullRange - bodySize;

    let entrySignalType: TradeSetup["entrySignalType"];
    if (isNear) {
      const isEngulfing =
        bodyHigh(recent) > bodyHigh(prev) && bodyLow(recent) < bodyLow(prev);
      const isPinbar = bodySize > 0 && wickSize > bodySize * 2;
      const isBOS =
        direction === "bullish"
          ? recent.close > prev.high
          : recent.close < prev.low;

      if (isBOS) entrySignalType = "break-of-structure";
      else if (isEngulfing) entrySignalType = "engulfing";
      else if (isPinbar) entrySignalType = "pinbar";
    }

    // ── 진입 / 손절 계산 ──────────────────────────────
    let entry: number;
    let stop: number;

    if (direction === "bullish") {
      // 롱: zone 상단 근처 진입, 손절은 zone 하단 아래
      entry = isNear ? currentPrice : zoneHigh;
      stop = zoneLow - zoneSize * 0.1;
    } else {
      // 숏: zone 하단 근처 진입, 손절은 zone 상단 위
      entry = isNear ? currentPrice : zoneLow;
      stop = zoneHigh + zoneSize * 0.1;
    }

    const risk = Math.abs(entry - stop);
    if (risk <= 0) continue;

    // ── TP1: RR 2:1 기본 ──────────────────────────────
    const tp1Raw =
      direction === "bullish" ? entry + risk * MIN_RR : entry - risk * MIN_RR;

    // ── TP2: 가장 가까운 반대방향 OB 레벨 or RR 3:1 ──
    // 방향 반대 OB 중 현재가에서 타겟 방향으로 가장 가까운 OB의 zone 경계
    const oppositeObs = activeObs.filter(
      (o) => o.direction !== direction
    );

    let tp2Raw: number;
    if (direction === "bullish") {
      // 현재가 위쪽 bearish OB의 zoneLow (매물대 직전 익절)
      const nearBearish = oppositeObs
        .filter((o) => o.zoneLow > entry)
        .sort((a, b) => a.zoneLow - b.zoneLow);
      tp2Raw =
        nearBearish.length > 0
          ? nearBearish[0].zoneLow * 0.999 // 매물대 직전
          : entry + risk * 3; // fallback: RR 3:1
    } else {
      // 현재가 아래쪽 bullish OB의 zoneHigh (지지대 직전 익절)
      const nearBullish = oppositeObs
        .filter((o) => o.zoneHigh < entry)
        .sort((a, b) => b.zoneHigh - a.zoneHigh);
      tp2Raw =
        nearBullish.length > 0
          ? nearBullish[0].zoneHigh * 1.001 // 지지대 직전
          : entry - risk * 3;
    }

    // TP2가 TP1보다 좋지 않으면 RR 3:1로 대체
    const tp1 = tp1Raw;
    const tp2 =
      direction === "bullish"
        ? Math.max(tp2Raw, entry + risk * 3)
        : Math.min(tp2Raw, entry - risk * 3);

    const rr1 = Math.abs(tp1 - entry) / risk;
    const rr2 = Math.abs(tp2 - entry) / risk;

    setups.push({
      direction,
      ob,
      isNearEntry: isNear,
      entrySignalType,
      entry,
      stop,
      tp1,
      tp2,
      rr1,
      rr2,
    });
  }

  // 근접 시그널 우선 정렬, 그 다음 confidence 내림차순
  return setups.sort((a, b) => {
    if (a.isNearEntry !== b.isNearEntry) return a.isNearEntry ? -1 : 1;
    return b.ob.confidenceScore - a.ob.confidenceScore;
  });
}
