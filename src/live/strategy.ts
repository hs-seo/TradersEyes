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
import type { ConditionDiagnosis } from "./scan-log";
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
 * SHARP-GF 신호 감지 (진단 포함)
 * @param candles4h  최근 220+ 4H 캔들 (오래된 순)
 * @param candles1h  최근 200+ 1H 캔들
 * @param candles15m 최근 200+ 15m 캔들
 * @param config     심볼 설정 (riskPct, leverage, strategy)
 * @param accountUsdt 현재 계좌 잔고 (USDT)
 * @param cbPauseUntil 서킷브레이커 해제 시간 (ms), 0이면 비활성
 */
export function detectSignalWithDiagnosis(
  candles4h: Candle[],
  candles1h: Candle[],
  candles15m: Candle[],
  config: SymbolConfig,
  accountUsdt: number,
  cbPauseUntil = 0
): { signal: LiveSignal | null; diagnosis: ConditionDiagnosis } {
  const emptyDiag = (): ConditionDiagnosis => ({
    sGradeCount: 0, chochFound: false, bestScore: 0,
    rsiValue: 50, rsiOk: false, fvgFound: false, failedAt: null,
  });

  if (candles4h.length < LOOKBACK) {
    return { signal: null, diagnosis: { ...emptyDiag(), failedAt: "데이터 부족" } };
  }

  const useCircuitBreaker = config.strategy === "SHARP-G" || config.strategy === "SHARP-GF";
  if (useCircuitBreaker && Date.now() < cbPauseUntil) {
    return { signal: null, diagnosis: { ...emptyDiag(), failedAt: "서킷브레이커" } };
  }

  // 최근 220봉 윈도우 — 형성 중인 4H 봉 제거 (구조 분석 오염 방지)
  const FOUR_H_MS = 4 * 60 * 60 * 1000;
  const current4hOpen = Math.floor(Date.now() / FOUR_H_MS) * FOUR_H_MS;
  const raw4h = candles4h.slice(-LOOKBACK);
  const window4h = raw4h.at(-1)!.timestamp >= current4hOpen ? raw4h.slice(0, -1) : raw4h;
  if (window4h.length < LOOKBACK - 1) return { signal: null, diagnosis: { ...emptyDiag(), failedAt: "데이터 부족" } };

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

  // currentPrice: 최신 1H 종가 (4H 봉 마감 대기 없이 현재 시장가 반영)
  const currentPrice = window1h.at(-1)!.close;
  const currentRsi   = rsi4h.at(-1) ?? 50;

  const graded = gradeOBs(allObs, currentPrice, breaks15m, breaksMain);

  // 진단 기초 데이터
  const sGrades  = graded.filter(g => g.grade === "S");
  const bestScore = graded.reduce((max, g) => Math.max(max, g.score), 0);
  const chochFound = graded.some(g => g.latestBreak?.type === "CHoCH");
  const useFVG = config.strategy === "SHARP-F" || config.strategy === "SHARP-GF";

  // SHARP 필터
  if (sGrades.length === 0) {
    return {
      signal: null,
      diagnosis: {
        sGradeCount: 0, chochFound, bestScore, rsiValue: currentRsi,
        rsiOk: false, fvgFound: false, failedAt: "S급 OB 없음",
      },
    };
  }

  const hasCHoCH = sGrades.some(g => g.latestBreak?.type === "CHoCH");
  if (!hasCHoCH) {
    return {
      signal: null,
      diagnosis: {
        sGradeCount: sGrades.length, chochFound: false, bestScore, rsiValue: currentRsi,
        rsiOk: false, fvgFound: false, failedAt: "CHoCH 없음",
      },
    };
  }

  const highScore = sGrades.filter(g => g.latestBreak?.type === "CHoCH" && g.score >= 9);
  if (highScore.length === 0) {
    return {
      signal: null,
      diagnosis: {
        sGradeCount: sGrades.length, chochFound: true, bestScore, rsiValue: currentRsi,
        rsiOk: false, fvgFound: false, failedAt: "점수 부족",
      },
    };
  }

  // RSI 극한 체크 (첫 번째 후보 기준)
  const firstDir = highScore[0].ob.direction;
  const rsiOk = firstDir === "bullish" ? currentRsi <= 40 : currentRsi >= 60;
  if (!rsiOk) {
    return {
      signal: null,
      diagnosis: {
        sGradeCount: sGrades.length, chochFound: true, bestScore, rsiValue: currentRsi,
        rsiOk: false, fvgFound: false, failedAt: "RSI 미충족",
      },
    };
  }

  // FVG 체크
  const fvgFound = !useFVG || hasFVGNear(window4h, firstDir, currentPrice);
  if (!fvgFound) {
    return {
      signal: null,
      diagnosis: {
        sGradeCount: sGrades.length, chochFound: true, bestScore, rsiValue: currentRsi,
        rsiOk: true, fvgFound: false, failedAt: "FVG 없음",
      },
    };
  }

  // 진입 시도
  for (const g of highScore) {
    const { ob } = g;
    const direction = ob.direction;

    if (useFVG && !hasFVGNear(window4h, direction, currentPrice)) continue;

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
      signal: {
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
      },
      diagnosis: {
        sGradeCount: sGrades.length, chochFound: true, bestScore, rsiValue: currentRsi,
        rsiOk: true, fvgFound: true, failedAt: null,
      },
    };
  }

  return {
    signal: null,
    diagnosis: {
      sGradeCount: sGrades.length, chochFound: true, bestScore, rsiValue: currentRsi,
      rsiOk: true, fvgFound: true, failedAt: "진입 조건 미달",
    },
  };
}

/** 하위호환 래퍼 */
export function detectSignal(
  candles4h: Candle[],
  candles1h: Candle[],
  candles15m: Candle[],
  config: SymbolConfig,
  accountUsdt: number,
  cbPauseUntil = 0
): LiveSignal | null {
  return detectSignalWithDiagnosis(candles4h, candles1h, candles15m, config, accountUsdt, cbPauseUntil).signal;
}
