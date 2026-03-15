/**
 * SHARP-GF 라이브 신호 감지
 *
 * 백테스트 엔진과 동일한 로직을 실시간 데이터에 적용.
 * 4H 캔들 마감 시점마다 호출 → LiveSignal | null 반환
 */
import { calculateRSI } from "../indicators/rsi";
import { detectDivergences } from "../indicators/divergence";
import { detectOrderBlocks } from "../engine/detector";
import { detectReversalPointOBs } from "../engine/conditions/reversal-point";
import { applyRsiFilter } from "../engine/filters/rsi-filter";
import { gradeOBs } from "../analysis/grader";
import { detectStructureBreaks } from "../analysis/choch";
import { calcATR } from "../engine/utils";
import type { Candle } from "../data/types";
import type { OrderBlock } from "../engine/types";
import type { SymbolConfig } from "../config";
import type { LiveSignal } from "./types";
import { RSI_PERIOD } from "../config";

const LOOKBACK    = 220;
const ATR_PERIOD  = 14;
const TRAIL_MULT  = 1.5; // 1H ATR 배수 (트레일링용, 참고값)

// ── FVG 필터 (backtest engine과 동일) ──────────────────────────
function hasFVGNear(
  window4h: Candle[],
  direction: "bullish" | "bearish",
  currentPrice: number,
  proximity = 0.03
): boolean {
  const candles = window4h.slice(-31, -1);
  for (let i = 2; i < candles.length; i++) {
    if (direction === "bullish") {
      const lo = candles[i - 2].high, hi = candles[i].low;
      if (hi <= lo) continue;
      const mid = (lo + hi) / 2;
      if ((currentPrice >= lo && currentPrice <= hi) ||
          Math.abs(currentPrice - mid) / mid <= proximity) return true;
    } else {
      const hi = candles[i - 2].low, lo = candles[i].high;
      if (hi <= lo) continue;
      const mid = (lo + hi) / 2;
      if ((currentPrice >= lo && currentPrice <= hi) ||
          Math.abs(currentPrice - mid) / mid <= proximity) return true;
    }
  }
  return false;
}

// ── 포지션 사이즈 계산 ────────────────────────────────────────
function calcPositionSize(
  accountUsdt: number,
  riskPct: number,
  leverage: number,
  entry: number,
  stop: number
): number {
  const riskUsdt = accountUsdt * (riskPct / 100);      // 1R 금액
  const riskPerUnit = Math.abs(entry - stop);           // 1개당 위험
  const qty = riskUsdt / riskPerUnit;                   // 수량
  const notional = qty * entry;                         // 명목금액
  // 레버리지 고려: margin = notional / leverage → leverage 내에서 가능
  return Math.floor(notional * 100) / 100;              // 소수점 2자리
}

/**
 * SHARP-GF 신호 감지
 * @param candles4h  최근 220+ 4H 캔들 (오래된 순)
 * @param candles1h  최근 200+ 1H 캔들
 * @param candles15m 최근 200+ 15m 캔들
 * @param config     심볼 설정 (riskPct, leverage, strategy)
 * @param accountUsdt 현재 계좌 잔고 (USDT)
 * @param cbPauseUntil 서킷브레이커 해제 시간 (ms), 0이면 비활성
 */
export function detectSignal(
  candles4h: Candle[],
  candles1h: Candle[],
  candles15m: Candle[],
  config: SymbolConfig,
  accountUsdt: number,
  cbPauseUntil = 0
): LiveSignal | null {
  if (candles4h.length < LOOKBACK) return null;

  const useCircuitBreaker = config.strategy === "SHARP-G" || config.strategy === "SHARP-GF";
  if (useCircuitBreaker && Date.now() < cbPauseUntil) return null;

  // 최근 220봉 윈도우
  const window4h = candles4h.slice(-LOOKBACK);

  const rsi4h = calculateRSI(window4h.map(c => c.close), RSI_PERIOD);
  const div4h  = detectDivergences(window4h, rsi4h);

  // 4H OB 탐지
  const obsMain = detectOrderBlocks({
    candles: window4h,
    symbol: config.symbol,
    timeframe: "4h",
    rsiValues: rsi4h,
    divergences: div4h,
  });

  // 1H reversal-point OB (보조)
  const i1h = candles1h.length - 1;
  const window1h = candles1h.slice(Math.max(0, i1h - 200));
  const rsi1h    = calculateRSI(window1h.map(c => c.close), RSI_PERIOD);
  const div1h    = detectDivergences(window1h, rsi1h);
  const obsSecondary = detectReversalPointOBs(window1h, config.symbol, "1h").map(ob =>
    applyRsiFilter(
      { ...ob, rsiAtFormation: 50, inRsiExtreme: false, hasDivergence: false, confidenceScore: 3 } as OrderBlock,
      rsi1h, div1h
    )
  );

  const allObs = [...obsMain, ...obsSecondary].filter(
    ob => ob.status === "active" || ob.status === "touched"
  );

  // 구조 이탈
  const window15m = candles15m.slice(-200);
  const breaks15m = detectStructureBreaks(window15m, 3, 80);
  const breaksMain = detectStructureBreaks(window1h, 3, 60);

  const currentPrice = window4h.at(-1)!.close;
  const currentRsi   = rsi4h.at(-1) ?? 50;

  const graded = gradeOBs(allObs, currentPrice, breaks15m, breaksMain);

  // SHARP 필터: CHoCH + score≥9 + RSI 극한
  const candidates = graded.filter(g => {
    if (g.grade !== "S") return false;
    if (g.latestBreak?.type !== "CHoCH") return false;
    if (g.score < 9) return false;
    const rsiOk = g.ob.direction === "bullish"
      ? currentRsi <= 40
      : currentRsi >= 60;
    if (!rsiOk) return false;
    return true;
  });

  if (candidates.length === 0) return null;

  // FVG 필터 (SHARP-F / SHARP-GF)
  const useFVG = config.strategy === "SHARP-F" || config.strategy === "SHARP-GF";

  for (const g of candidates) {
    const { ob } = g;
    const direction = ob.direction;

    if (useFVG && !hasFVGNear(window4h, direction, currentPrice)) continue;

    // SL / TP 계산
    const atr4hArr = calcATR(window4h, ATR_PERIOD);
    const atr4h    = atr4hArr.at(-1) ?? 0;

    const stop = direction === "bullish"
      ? ob.zoneLow  - atr4h * 0.2
      : ob.zoneHigh + atr4h * 0.2;

    const risk = Math.abs(currentPrice - stop);
    if (risk <= 0 || risk < atr4h * 0.5) continue;
    if (direction === "bullish" && stop >= currentPrice) continue;
    if (direction === "bearish" && stop <= currentPrice) continue;

    const tp1 = direction === "bullish"
      ? currentPrice + risk * 2
      : currentPrice - risk * 2;

    // TP2: 반대 방향 OB 중 가장 가까운 것, 없으면 risk×3
    const oppositeObs = allObs.filter(
      o => o.direction !== direction &&
           o.timeframe === "4h" &&
           (o.status === "active" || o.status === "touched")
    );
    let tp2: number;
    if (direction === "bullish") {
      const cands = oppositeObs.filter(o => o.zoneLow > currentPrice).sort((a, b) => a.zoneLow - b.zoneLow);
      tp2 = cands.length > 0 ? cands[0].zoneLow * 0.999 : currentPrice + risk * 3;
      tp2 = Math.max(tp2, currentPrice + risk * 3);
    } else {
      const cands = oppositeObs.filter(o => o.zoneHigh < currentPrice).sort((a, b) => b.zoneHigh - a.zoneHigh);
      tp2 = cands.length > 0 ? cands[0].zoneHigh * 1.001 : currentPrice - risk * 3;
      tp2 = Math.min(tp2, currentPrice - risk * 3);
    }

    const positionSizeUsdt = calcPositionSize(
      accountUsdt, config.riskPct, config.leverage, currentPrice, stop
    );

    return {
      symbol:            config.symbol,
      strategy:          config.strategy,
      direction,
      entryPrice:        currentPrice,
      stop,
      tp1,
      tp2,
      risk,
      riskPct:           config.riskPct,
      leverage:          config.leverage,
      positionSizeUsdt,
      obType:            ob.type,
      score:             g.score,
      rsi:               currentRsi,
      detectedAt:        Date.now(),
    };
  }

  return null;
}
