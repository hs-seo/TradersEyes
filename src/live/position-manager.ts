/**
 * 포지션 관리 (1H cron)
 * - TP1 도달 체크 → 50% 부분청산 + 트레일링 전환
 * - 트레일링 스탑 업데이트
 * - SL/TP 체결 감지 (포지션 종료 처리)
 */
import { fetchHistoricalOHLCV } from "../backtest/fetcher";
import { calcATR } from "../engine/utils";
import { getOpenPositions } from "./state-store";
import { handleTP1, updateTrailStop, handlePositionClose } from "./trader";
import type { LivePosition } from "./types";

const ATR_PERIOD = 14;
const ONE_H_MS = 200 * 60 * 60 * 1000;

export async function runPositionManager(): Promise<void> {
  const positions = getOpenPositions();
  if (positions.length === 0) return;

  console.log(`[PositionMgr] ${positions.length}개 포지션 점검`);

  const now = Date.now();

  for (const pos of positions) {
    try {
      await checkPosition(pos, now);
    } catch (err) {
      console.error(`[PositionMgr] ${pos.symbol} 점검 오류:`, err);
    }
  }
}

async function checkPosition(pos: LivePosition, now: number): Promise<void> {
  const since1h = now - ONE_H_MS;

  const candles1h = await fetchHistoricalOHLCV(pos.symbol, "1h", since1h, now);
  if (candles1h.length < ATR_PERIOD + 1) return;

  const atr1hArr = calcATR(candles1h, ATR_PERIOD);
  const atr1h = atr1hArr.at(-1) ?? 0;
  const currentPrice = candles1h.at(-1)!.close;

  // SL 체결 감지
  if (pos.direction === "bullish" && currentPrice <= pos.stop) {
    console.log(`[PositionMgr] ${pos.symbol} SL 체결 감지 → 종료`);
    await handlePositionClose(pos, currentPrice, "sl");
    return;
  }
  if (pos.direction === "bearish" && currentPrice >= pos.stop) {
    console.log(`[PositionMgr] ${pos.symbol} SL 체결 감지 → 종료`);
    await handlePositionClose(pos, currentPrice, "sl");
    return;
  }

  // TP2 체결 감지 (트레일링 미전환 상태에서)
  if (!pos.tp1Hit) {
    const tp2Hit = pos.direction === "bullish"
      ? currentPrice >= pos.tp2
      : currentPrice <= pos.tp2;

    if (tp2Hit) {
      console.log(`[PositionMgr] ${pos.symbol} TP2 도달 → 종료`);
      await handlePositionClose(pos, currentPrice, "tp2");
      return;
    }
  }

  // TP1 도달 체크 (미처리 상태일 때만)
  if (!pos.tp1Hit) {
    const tp1Hit = pos.direction === "bullish"
      ? currentPrice >= pos.tp1
      : currentPrice <= pos.tp1;

    if (tp1Hit) {
      console.log(`[PositionMgr] ${pos.symbol} TP1 도달 → 50% 청산 + 트레일링`);
      await handleTP1(pos, currentPrice, atr1h);
      return;
    }
  }

  // 트레일링 스탑 업데이트
  if (pos.trailingActive) {
    // 트레일링 스탑 체결 감지
    const trailHit = pos.trailStop !== undefined && (
      pos.direction === "bullish"
        ? currentPrice <= pos.trailStop
        : currentPrice >= pos.trailStop
    );

    if (trailHit) {
      console.log(`[PositionMgr] ${pos.symbol} 트레일링 스탑 체결 → 종료`);
      await handlePositionClose(pos, currentPrice, "tp1-partial+trailing");
      return;
    }

    await updateTrailStop(pos, currentPrice, atr1h);
  }
}
