/**
 * 워크포워드 백테스트 엔진 v2 (개선판)
 *
 * 개선사항:
 *  1. ATR trailing: 4H ATR → 1H ATR × 1.5 (더 타이트)
 *  2. TP1 도달 시 50% 부분 청산 + 나머지 trailing
 *  3. OB 쿨다운: 동일 OB(createdAt 기준) 재진입 4H 3캔들 방지
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
import type { BacktestPosition, SymbolResult, ExitReason } from "./types";
import { RSI_PERIOD } from "../config";

const LOOKBACK       = 220;  // 4H 윈도우 크기
const TRAIL_MULT     = 1.5;  // 1H ATR 트레일링 배수
const ATR_PERIOD     = 14;
const OB_COOLDOWN    = 3;    // 동일 OB 재진입 방지 (4H 캔들 수)
const KELLY_WINDOW   = 20;   // Kelly 계산용 롤링 윈도우
const KELLY_MIN_TRADES = 10; // Kelly 적용 최소 트레이드 수

// ── ML 피처 필터 헬퍼 ────────────────────────────────────

/**
 * Liquidity Sweep: OB 진입 전 swing 고/저점을 wick으로 돌파 후 복귀했는가
 * 롱 → 최근 swing low 하단 wick 후 close above / 숏 → 반대
 *
 * [수정] lookback 15→8, ATR×0.3 최소 wick 크기 요구
 *  - lookback=15는 너무 넓어 false sweep 과다 → 8로 타이트하게
 *  - sweep 깊이가 ATR의 30% 미만이면 노이즈로 간주 무시
 */
function hasLiquiditySweep(
  window4h: Candle[],
  direction: "bullish" | "bearish",
  lookback = 8,
  minWickATRMult = 0.3
): boolean {
  const atrArr = calcATR(window4h.slice(-ATR_PERIOD - 1), ATR_PERIOD);
  const minWick = (atrArr.at(-1) ?? 0) * minWickATRMult;

  const recent = window4h.slice(-lookback - 1, -1); // 현재 캔들 제외
  for (let i = 2; i < recent.length; i++) {
    const c = recent[i];
    if (direction === "bullish") {
      const swingLow = Math.min(...recent.slice(0, i).map(x => x.low));
      const wickSize = swingLow - c.low;
      if (c.low < swingLow && c.close > swingLow && wickSize >= minWick) return true;
    } else {
      const swingHigh = Math.max(...recent.slice(0, i).map(x => x.high));
      const wickSize = c.high - swingHigh;
      if (c.high > swingHigh && c.close < swingHigh && wickSize >= minWick) return true;
    }
  }
  return false;
}

/**
 * Fair Value Gap: 현재가가 최근 30캔들 내 FVG 구간에 있거나 3% 이내인가
 * Bullish FVG = candle[i-2].high ~ candle[i].low (위로 갭)
 * Bearish FVG = candle[i].high ~ candle[i-2].low (아래로 갭)
 */
function hasFVGNear(
  window4h: Candle[],
  direction: "bullish" | "bearish",
  currentPrice: number,
  proximity = 0.03
): boolean {
  const candles = window4h.slice(-31, -1); // 최근 30캔들, 현재 제외
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

/**
 * Daily HTF Regime: 4H SMA100 기반 일봉 바이어스 (≈16일)
 * close > SMA100 × 1.002 → bullish / close < SMA100 × 0.998 → bearish
 *
 * [수정] SMA30 → SMA100
 *  - SMA30(≈5일)은 너무 짧아 RSI≤40 진입 조건(단기 pullback)과 충돌
 *  - SMA100(≈16일)은 단기 pullback에도 가격이 SMA 위에 위치 가능 → 호환
 */
function getDailyBias(window4h: Candle[]): "bullish" | "bearish" | "neutral" {
  if (window4h.length < 100) return "neutral";
  const sma = window4h.slice(-100).reduce((s, c) => s + c.close, 0) / 100;
  const close = window4h.at(-1)!.close;
  if (close > sma * 1.002) return "bullish";
  if (close < sma * 0.998) return "bearish";
  return "neutral";
}

/**
 * Volume Surge: 최근 3캔들 중 하나라도 20기간 평균 거래량의 1.5배 초과
 * OB 구간에 기관 참여 흔적이 있는지 확인
 */
function hasVolumeSurge(window4h: Candle[], threshold = 1.5, lookback = 20): boolean {
  const n = window4h.length;
  if (n < lookback + 1) return false;
  const avgVol = window4h.slice(n - lookback - 1, n - 1)
    .reduce((s, c) => s + c.volume, 0) / lookback;
  return window4h.slice(-4, -1).some(c => c.volume > avgVol * threshold);
}

/** 연속 손실 수 → 포지션 사이징 배수 */
function getSizeMult(consecutiveLosses: number): number {
  if (consecutiveLosses <= 2) return 1.00;
  if (consecutiveLosses <= 4) return 0.75;
  if (consecutiveLosses <= 6) return 0.50;
  return 0.25;
}

/** Kelly Criterion 기반 포지션 사이징 (Half-Kelly)
 *  halfKelly = (W - (1-W)/R) / 2
 *  conditionalMinWR > 0: 롤링 WR < minWR이면 1.0× 유지 (사이징 감소 없음)
 *  sizeMult ∈ [0.25, 2.0], kelly=0 → 1.0×, kelly=±0.1 → ±0.5× 조정
 */
function getKellyMult(recentTrades: BacktestPosition[], conditionalMinWR = 0): number {
  if (recentTrades.length < KELLY_MIN_TRADES) return 1.0;
  const recent = recentTrades.slice(-KELLY_WINDOW);
  const wins   = recent.filter(t => (t.pnlR ?? 0) > 0);
  const losses = recent.filter(t => (t.pnlR ?? 0) <= 0);
  if (losses.length === 0) return 2.0;
  const W      = wins.length / recent.length;
  // 조건부 Kelly: WR < 임계값이면 사이징 변경 없이 1.0× 반환
  if (conditionalMinWR > 0 && W < conditionalMinWR) return 1.0;
  const avgWin = wins.length > 0
    ? wins.reduce((s, t) => s + (t.pnlR ?? 0), 0) / wins.length : 0;
  const avgLoss = Math.abs(
    losses.reduce((s, t) => s + (t.pnlR ?? 0), 0) / losses.length
  );
  if (avgLoss === 0) return 2.0;
  const R         = avgWin / avgLoss;
  const kellyFrac = W - (1 - W) / R;
  const halfKelly = kellyFrac / 2;
  // half-kelly 0% → 1.0×, +10% → 1.5×, -10% → 0.5×
  return Math.max(0.25, Math.min(2.0, 1.0 + halfKelly * 5));
}

// ── 포지션 업데이트 (15m 캔들 1개) ──────────────────────
function updatePosition(pos: BacktestPosition, c: Candle, atr1h: number): void {
  if (pos.status !== "open") return;
  const { direction, risk, entryPrice } = pos;

  function close(price: number, reason: ExitReason) {
    pos.status = "closed";
    pos.exitPrice = price;
    pos.exitTime = c.timestamp;
    pos.exitReason = reason;
    const remainPnlR =
      direction === "bullish"
        ? (price - entryPrice) / risk
        : (entryPrice - price) / risk;
    // blended: 50% locked at TP1 + 50% remaining, scaled by sizeMult
    const rawPnlR = pos.tp1Hit
      ? pos.tp1LockedR + remainPnlR * 0.5
      : remainPnlR;
    pos.pnlR = rawPnlR * pos.sizeMult;
  }

  const effectiveStop = pos.trailingActive ? (pos.trailStop ?? pos.stop) : pos.stop;

  if (direction === "bullish") {
    if (c.low <= effectiveStop) {
      close(effectiveStop, pos.trailingActive ? "tp1-partial+trailing" : "sl");
      return;
    }
    if (c.high >= pos.tp2) {
      close(pos.tp2, pos.tp1Hit ? "tp1-partial+tp2" : "tp2");
      return;
    }
    // TP1 도달 → 50% 확정 + trailing 활성화
    if (!pos.tp1Hit && c.high >= pos.tp1) {
      pos.tp1Hit = true;
      pos.tp1LockedR = (pos.tp1 - entryPrice) / risk * 0.5; // 50% 기준
      pos.stop = entryPrice; // 나머지 50%는 본전 이상 보장
      pos.trailingActive = true;
      pos.trailingExtreme = c.high;
      pos.trailStop = c.high - atr1h * TRAIL_MULT;
    }
    if (pos.trailingActive) {
      pos.trailingExtreme = Math.max(pos.trailingExtreme, c.high);
      pos.trailStop = Math.max(
        pos.trailStop ?? pos.stop,
        pos.trailingExtreme - atr1h * TRAIL_MULT
      );
    }
  } else {
    if (c.high >= effectiveStop) {
      close(effectiveStop, pos.trailingActive ? "tp1-partial+trailing" : "sl");
      return;
    }
    if (c.low <= pos.tp2) {
      close(pos.tp2, pos.tp1Hit ? "tp1-partial+tp2" : "tp2");
      return;
    }
    if (!pos.tp1Hit && c.low <= pos.tp1) {
      pos.tp1Hit = true;
      pos.tp1LockedR = (entryPrice - pos.tp1) / risk * 0.5;
      pos.stop = entryPrice;
      pos.trailingActive = true;
      pos.trailingExtreme = c.low;
      pos.trailStop = c.low + atr1h * TRAIL_MULT;
    }
    if (pos.trailingActive) {
      pos.trailingExtreme = Math.min(pos.trailingExtreme, c.low);
      pos.trailStop = Math.min(
        pos.trailStop ?? pos.stop,
        pos.trailingExtreme + atr1h * TRAIL_MULT
      );
    }
  }
}

// ── 심볼 백테스트 ──────────────────────────────────────
export function runSymbolBacktest(
  symbol: string,
  candles4h: Candle[],
  candles1h: Candle[],
  candles15m: Candle[],
  startTimestamp: number,
  requireChoCH = false,  // LLM 필터 시뮬레이션: CHoCH 확인 필수 여부
  useSizing    = false,  // 연속손실 기반 포지션 사이징 적용 여부
  useFilters          = false,  // 추가 품질 필터: score≥9 + 진입 시 RSI 조건
  useKelly            = false,  // Kelly Criterion 동적 사이징 (항상 적용)
  useKellyConditional = false,  // Kelly: 롤링 WR ≥ 45% 일 때만 사이징 UP
  useCircuitBreaker   = false,  // 3연패 후 메인TF×4캔들 진입 중단
  useDrawdownSizing   = false,  // 낙폭 기반 사이징: DD>4R→0.5×, DD>7R→0.25×
  mainTF: "4h" | "1h" = "4h",  // 메인 탐지 타임프레임
  // ── ML 피처 필터 (MLTrader 차용) ──────────────────────
  useLiqSweep  = false,  // Liquidity Sweep 확인
  useFVG       = false,  // Fair Value Gap 근접 확인
  useHTFRegime = false,  // 일봉 바이어스 정렬 (4H SMA30)
  useVolSurge  = false   // 거래량 서지 확인 (기관 참여)
): SymbolResult {
  const closed: BacktestPosition[] = [];
  const open: BacktestPosition[] = [];
  let posCounter = 0;
  let consecutiveLosses = 0; // 연속 손실 카운터
  let pauseUntilIdx     = -1; // 서킷브레이커: 이 4H 인덱스까지 진입 중단
  let cumPnL  = 0;  // 낙폭 사이징용 실현 누적 PnL
  let peakPnL = 0;  // 낙폭 사이징용 고수위

  // OB 쿨다운: key=`createdAt:direction`, value=마지막 메인TF 인덱스
  const obCooldown = new Map<string, number>();

  // TF 파라미터화: 메인 캔들, ATR 캔들, 쿨다운 배율
  const mainCandles   = mainTF === "1h" ? candles1h : candles4h;
  const atrCandles    = mainTF === "1h" ? candles15m : candles1h;
  const cooldownScale = mainTF === "1h" ? 4 : 1; // 동일 벽시계 시간 기준

  const startIdx = mainCandles.findIndex((c) => c.timestamp >= startTimestamp);
  if (startIdx < LOOKBACK) {
    console.warn(`[Engine] ${symbol}(${mainTF}): lookback 부족 (startIdx=${startIdx})`);
    return calcResult(symbol, []);
  }

  for (let i = startIdx; i < mainCandles.length; i++) {
    const c4h     = mainCandles[i];
    const prevC4h = mainCandles[i - 1];

    // 이번 메인TF 구간의 15m 캔들 범위 (포지션 관리용)
    const m15Start = candles15m.findIndex((c) => c.timestamp > prevC4h.timestamp);
    const m15End = candles15m.findLastIndex((c) => c.timestamp <= c4h.timestamp);

    // ATR (trailing용) — atrCandles 기준 14개
    const iAtrCur    = atrCandles.findLastIndex((c) => c.timestamp <= c4h.timestamp);
    const windowAtr  = atrCandles.slice(Math.max(0, iAtrCur - ATR_PERIOD - 1), iAtrCur + 1);
    const atr1hArr   = calcATR(windowAtr, ATR_PERIOD);
    const atr1h      = atr1hArr.at(-1) ?? 0;

    // 열린 포지션 15m 업데이트
    if (m15Start !== -1 && m15End >= m15Start) {
      for (const pos of open) {
        for (let k = m15Start; k <= m15End; k++) {
          if (pos.status !== "open") break;
          updatePosition(pos, candles15m[k], atr1h);
        }
      }
    }

    // 마감 포지션 이동 + 연속손실 카운터 갱신
    const justClosed = open.filter((p) => p.status === "closed");
    // 청산 시간순으로 정렬해 순서대로 카운터 갱신
    justClosed.sort((a, b) => (a.exitTime ?? 0) - (b.exitTime ?? 0));
    for (const p of justClosed) {
      if ((p.pnlR ?? 0) > 0) consecutiveLosses = 0;
      else consecutiveLosses++;
      // 낙폭 사이징용 실현 누적 PnL 추적
      cumPnL += p.pnlR ?? 0;
      if (cumPnL > peakPnL) peakPnL = cumPnL;
    }
    // 서킷브레이커: 3연패 달성 시 메인TF×4캔들 진입 중단
    if (useCircuitBreaker && consecutiveLosses >= 3) {
      pauseUntilIdx = i + 4 * cooldownScale;
    }
    closed.push(...justClosed);
    const stillOpen = open.filter((p) => p.status === "open");
    open.length = 0;
    open.push(...stillOpen);

    // ── OB 탐지 ──────────────────────────────────────
    // 메인TF 윈도우로 OB 탐지
    const window4h  = mainCandles.slice(i - LOOKBACK, i + 1);
    const rsi4h     = calculateRSI(window4h.map((c) => c.close), RSI_PERIOD);
    const div4h     = detectDivergences(window4h, rsi4h);

    const obsMain = detectOrderBlocks({
      candles: window4h,
      symbol,
      timeframe: mainTF,
      rsiValues: rsi4h,
      divergences: div4h,
    });

    // 4H 모드: 보조 1H reversal-point OB + 구조 이탈 계산
    let obsSecondary: ReturnType<typeof applyRsiFilter>[] = [];
    let window1hForBreaks: Candle[] = [];
    if (mainTF === "4h") {
      const i1h      = candles1h.findLastIndex((c) => c.timestamp <= c4h.timestamp);
      window1hForBreaks = candles1h.slice(Math.max(0, i1h - 200), i1h + 1);
      const rsi1h    = calculateRSI(window1hForBreaks.map((c) => c.close), RSI_PERIOD);
      const div1h    = detectDivergences(window1hForBreaks, rsi1h);
      obsSecondary   = detectReversalPointOBs(window1hForBreaks, symbol, "1h").map((ob) =>
        applyRsiFilter(
          { ...ob, rsiAtFormation: 50, inRsiExtreme: false, hasDivergence: false, confidenceScore: 3 } as OrderBlock,
          rsi1h, div1h
        )
      );
    }

    const allObs = [...obsMain, ...obsSecondary].filter(
      (ob) => ob.status === "active" || ob.status === "touched"
    );

    const i15m      = candles15m.findLastIndex((c) => c.timestamp <= c4h.timestamp);
    const window15m = candles15m.slice(Math.max(0, i15m - 200), i15m + 1);
    const breaks15m = detectStructureBreaks(window15m, 3, 80);
    // 구조 이탈: 4H 모드는 1H 창, 1H 모드는 메인(1H) 창 사용
    const breaksMain = detectStructureBreaks(
      mainTF === "4h" ? window1hForBreaks : window4h.slice(-100),
      3, 60
    );

    const currentPrice  = c4h.close;
    const currentRsi4h  = rsi4h.at(-1) ?? 50;
    const graded = gradeOBs(allObs, currentPrice, breaks15m, breaksMain);
    const sGrade = graded.filter((g) => {
      if (g.grade !== "S") return false;
      // LLM 필터: CHoCH 확인이 필수일 경우 latestBreak.type === 'CHoCH' 요구
      if (requireChoCH && g.latestBreak?.type !== "CHoCH") return false;
      // 추가 품질 필터: score≥9 + 진입 시 RSI 극한 조건
      if (useFilters) {
        if (g.score < 9) return false;
        const rsiOk = g.ob.direction === "bullish"
          ? currentRsi4h <= 40   // 과매도권 진입 (롱)
          : currentRsi4h >= 60;  // 과매수권 진입 (숏)
        if (!rsiOk) return false;
      }
      return true;
    });

    // ── 포지션 진입 ──────────────────────────────────
    // 서킷브레이커: 쿨다운 중이면 진입 전체 스킵
    if (useCircuitBreaker && i < pauseUntilIdx) continue;

    const openDirs = new Set(open.map((p) => p.direction));
    const atr4hArr = calcATR(window4h, ATR_PERIOD);
    const atr4h = atr4hArr.at(-1) ?? 0;

    // 낙폭 기반 사이징 배수 계산
    const currentDD = peakPnL - cumPnL;
    const ddSizeMult = !useDrawdownSizing ? 1.0
      : currentDD >= 7 ? 0.25
      : currentDD >= 4 ? 0.5
      : 1.0;

    for (const g of sGrade) {
      const { ob } = g;
      if (openDirs.has(ob.direction)) continue;

      // 쿨다운 체크
      const coolKey = `${ob.createdAt}:${ob.direction}`;
      const lastEntryIdx = obCooldown.get(coolKey);
      if (lastEntryIdx !== undefined && i - lastEntryIdx < OB_COOLDOWN * cooldownScale) continue;

      const { zoneHigh, zoneLow, direction } = ob;

      // ── ML 피처 필터 ───────────────────────────────────
      if (useLiqSweep && !hasLiquiditySweep(window4h, direction)) continue;
      if (useFVG       && !hasFVGNear(window4h, direction, currentPrice)) continue;
      if (useHTFRegime) {
        const bias = getDailyBias(window4h);
        if (bias !== "neutral" && bias !== direction) continue;
      }
      if (useVolSurge  && !hasVolumeSurge(window4h)) continue;
      const entry = currentPrice;
      const stop =
        direction === "bullish"
          ? zoneLow - atr4h * 0.2
          : zoneHigh + atr4h * 0.2;
      const risk = Math.abs(entry - stop);
      if (risk <= 0) continue;
      if (direction === "bullish" && stop >= entry) continue;
      if (direction === "bearish" && stop <= entry) continue;
      // micro-risk 제외: risk < ATR×0.5 → OB zone이 비현실적으로 좁음
      if (risk < atr4h * 0.5) continue;

      const tp1 =
        direction === "bullish" ? entry + risk * 2 : entry - risk * 2;

      const oppositeHTF = allObs.filter(
        (o) => o.direction !== direction && o.timeframe === "4h" &&
          (o.status === "active" || o.status === "touched")
      );
      let tp2: number;
      if (direction === "bullish") {
        const candidates = oppositeHTF
          .filter((o) => o.zoneLow > entry)
          .sort((a, b) => a.zoneLow - b.zoneLow);
        tp2 = candidates.length > 0 ? candidates[0].zoneLow * 0.999 : entry + risk * 3;
        tp2 = Math.max(tp2, entry + risk * 3);
      } else {
        const candidates = oppositeHTF
          .filter((o) => o.zoneHigh < entry)
          .sort((a, b) => b.zoneHigh - a.zoneHigh);
        tp2 = candidates.length > 0 ? candidates[0].zoneHigh * 1.001 : entry - risk * 3;
        tp2 = Math.min(tp2, entry - risk * 3);
      }

      const baseMult = useKellyConditional ? getKellyMult(closed, 0.45)
                     : useKelly            ? getKellyMult(closed)
                     : useSizing           ? getSizeMult(consecutiveLosses)
                     : 1.0;
      const sizeMult = Math.max(0.25, baseMult * ddSizeMult);

      const pos: BacktestPosition = {
        id: `${symbol}-${posCounter++}`,
        symbol,
        direction,
        obType: ob.type,
        obCreatedAt: ob.createdAt,
        entryPrice: entry,
        entryTime: c4h.timestamp,
        stop,
        tp1,
        tp2,
        risk,
        sizeMult,
        status: "open",
        tp1Hit: false,
        tp1LockedR: 0,
        trailingActive: false,
        trailingExtreme: entry,
      };

      open.push(pos);
      openDirs.add(direction);
      obCooldown.set(coolKey, i);
    }
  }

  // 미청산 포지션 강제 종료
  const lastClose = mainCandles.at(-1)!.close;
  const lastTime  = mainCandles.at(-1)!.timestamp;
  for (const pos of open) {
    pos.status = "closed";
    pos.exitPrice = lastClose;
    pos.exitTime = lastTime;
    pos.exitReason = "end-of-data";
    const remainPnlR =
      pos.direction === "bullish"
        ? (lastClose - pos.entryPrice) / pos.risk
        : (pos.entryPrice - lastClose) / pos.risk;
    const rawPnlR = pos.tp1Hit ? pos.tp1LockedR + remainPnlR * 0.5 : remainPnlR;
    pos.pnlR = rawPnlR * pos.sizeMult;
    closed.push(pos);
  }

  return calcResult(symbol, closed);
}

// ── 결과 집계 ──────────────────────────────────────────
function calcResult(symbol: string, trades: BacktestPosition[]): SymbolResult {
  if (trades.length === 0) {
    return {
      symbol, trades: [],
      totalTrades: 0, wins: 0, losses: 0, winRate: 0,
      totalPnlR: 0, avgWinR: 0, avgLossR: 0, expectancy: 0,
      maxDrawdownR: 0,
      byExitReason: { sl: 0, trailing: 0, tp2: 0, "end-of-data": 0 } as any,
    };
  }

  const wins = trades.filter((t) => (t.pnlR ?? 0) > 0);
  const losses = trades.filter((t) => (t.pnlR ?? 0) <= 0);
  const totalPnlR = trades.reduce((s, t) => s + (t.pnlR ?? 0), 0);
  const avgWinR = wins.length > 0 ? wins.reduce((s, t) => s + (t.pnlR ?? 0), 0) / wins.length : 0;
  const avgLossR = losses.length > 0 ? losses.reduce((s, t) => s + (t.pnlR ?? 0), 0) / losses.length : 0;

  let peak = 0, maxDD = 0, cum = 0;
  for (const t of trades) {
    cum += t.pnlR ?? 0;
    if (cum > peak) peak = cum;
    const dd = peak - cum;
    if (dd > maxDD) maxDD = dd;
  }

  const byExitReason: Record<string, number> = {};
  for (const t of trades) {
    if (t.exitReason) byExitReason[t.exitReason] = (byExitReason[t.exitReason] ?? 0) + 1;
  }

  return {
    symbol,
    trades,
    totalTrades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: trades.length > 0 ? wins.length / trades.length : 0,
    totalPnlR,
    avgWinR,
    avgLossR,
    expectancy: trades.length > 0 ? totalPnlR / trades.length : 0,
    maxDrawdownR: maxDD,
    byExitReason: byExitReason as any,
  };
}
