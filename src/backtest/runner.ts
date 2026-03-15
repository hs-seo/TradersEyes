/**
 * 백테스트 비교 실행
 *
 * ── 확정 전략: SHARP ──────────────────────────────────────
 *  SHARP = Structure(CHoCH) · High-score(≥9) · ATR-adaptive · RSI extreme · Precision
 *
 *  SHARP-D  : 수익 극대화  (CHoCH + score≥9 + RSI필터, 서킷브레이커 없음)
 *  SHARP-G  : MDD 방어    (SHARP-D + 3연패→16H 진입 중단)
 *  SHARP-F  : SHARP-D + FVG Confluence (FVG 통합)
 *  SHARP-GF : SHARP-G + FVG Confluence (CB + FVG 통합)
 *
 * ── ML 피처 수정판 ────────────────────────────────────────
 *  L2: LiqSweep 수정 (lookback 15→8, ATR×0.3 최소 wick)
 *  R2: HTF Regime 수정 (SMA30→SMA100, RSI필터 충돌 해소)
 */
import { fetchHistoricalOHLCV } from "./fetcher";
import { runSymbolBacktest } from "./engine";
import { SYMBOLS } from "../config";
import type { BacktestPosition, SymbolResult } from "./types";

const DATA_FROM  = new Date("2025-02-01T00:00:00Z").getTime();
const TEST_FROM  = new Date("2025-03-14T00:00:00Z").getTime();
const TEST_UNTIL = Date.now();

// ── SHARP 전략 파라미터 ──────────────────────────────────
// run(choch, sizing, filters, kelly, kellyConditional, circuitBreaker, drawdownSizing, mainTF,
//     liqSweep, fvg, htfRegime, volSurge)
const SHARP_D  = [true, false, true, false, false, false, false, "4h", false, false, false, false] as const;
const SHARP_G  = [true, false, true, false, false, true,  false, "4h", false, false, false, false] as const;
const SHARP_F  = [true, false, true, false, false, false, false, "4h", false, true,  false, false] as const; // D + FVG
const SHARP_GF = [true, false, true, false, false, true,  false, "4h", false, true,  false, false] as const; // G + FVG

// ── 헬퍼 ───────────────────────────────────────────────
const pct = (n: number) => (n * 100).toFixed(1) + "%";
const r   = (n: number) => (n >= 0 ? "+" : "") + n.toFixed(2) + "R";
const bar = (c = "─", n = 64) => c.repeat(n);

// ── 심볼 트레이드 상세 출력 ─────────────────────────────
function printTradeDetail(symbol: string, label: string, trades: BacktestPosition[]) {
  const totalPnl = trades.reduce((s, t) => s + (t.pnlR ?? 0), 0);
  console.log(`\n${"─".repeat(72)}`);
  console.log(`  ${symbol} 트레이드 상세 — ${label}`);
  console.log(`  총 ${trades.length}건 | 총 PnL: ${r(totalPnl)}`);
  console.log(`${"─".repeat(72)}`);
  console.log(`  ${"날짜".padEnd(11)} ${"방향".padEnd(5)} ${"진입".padEnd(10)} ${"청산".padEnd(10)} ${"PnL".padStart(7)}  사유`);
  console.log(`  ${"─".repeat(66)}`);
  let cum = 0;
  for (const t of trades) {
    const date  = new Date(t.entryTime).toISOString().slice(0, 10);
    const dir   = t.direction === "bullish" ? "🟢롱" : "🔴숏";
    const entry = t.entryPrice.toFixed(2).padStart(9);
    const exit  = (t.exitPrice ?? 0).toFixed(2).padStart(9);
    const pnlR  = t.pnlR ?? 0;
    const size  = t.sizeMult < 1 ? ` [${(t.sizeMult*100).toFixed(0)}%]` : "";
    cum += pnlR;
    console.log(`  ${date} ${dir} ${entry} ${exit} ${r(pnlR).padStart(7)}  ${t.exitReason}${size} (누적:${r(cum)})`);
  }
}

// ── BTC 심층 분석 ────────────────────────────────────────
function printBtcDeepAnalysis(
  versions: Array<{ label: string; trades: BacktestPosition[] }>
) {
  console.log(`\n${"═".repeat(72)}`);
  console.log(`  BTCUSDT 심층 분석`);
  console.log(`${"═".repeat(72)}`);

  // ① 전략별 비교
  console.log(`\n  [1] 전략별 성과 비교`);
  console.log(`  ${"전략".padEnd(14)} ${"건수".padStart(4)} ${"승률".padStart(6)} ${"총PnL".padStart(9)} ${"기댓값".padStart(8)} ${"MDD".padStart(6)} ${"평균승R".padStart(7)} ${"평균패R".padStart(7)}`);
  console.log(`  ${"─".repeat(68)}`);
  for (const { label, trades } of versions) {
    if (trades.length === 0) { console.log(`  ${label.padEnd(14)} 거래 없음`); continue; }
    const wins   = trades.filter(t => (t.pnlR ?? 0) > 0);
    const losses = trades.filter(t => (t.pnlR ?? 0) <= 0);
    const pnl    = trades.reduce((s, t) => s + (t.pnlR ?? 0), 0);
    const avgW   = wins.length > 0 ? wins.reduce((s,t)=>s+(t.pnlR??0),0)/wins.length : 0;
    const avgL   = losses.length > 0 ? losses.reduce((s,t)=>s+(t.pnlR??0),0)/losses.length : 0;
    let peak = 0, cum = 0, mdd = 0;
    for (const t of trades) { cum += t.pnlR??0; if(cum>peak)peak=cum; if(peak-cum>mdd)mdd=peak-cum; }
    console.log(
      `  ${label.padEnd(14)} ${String(trades.length).padStart(4)}건 ` +
      `${pct(wins.length/trades.length).padStart(6)} ` +
      `${r(pnl).padStart(9)} ${r(pnl/trades.length).padStart(8)} ` +
      `${mdd.toFixed(1).padStart(5)}R ` +
      `${r(avgW).padStart(7)} ${r(avgL).padStart(7)}`
    );
  }

  // ② GF 기준 월별 PnL
  const gfVer = versions.find(v => v.label === "SHARP-GF");
  if (gfVer && gfVer.trades.length > 0) {
    console.log(`\n  [2] SHARP-GF 월별 PnL`);
    const byMonth: Record<string, { wins: number; losses: number; pnl: number }> = {};
    for (const t of gfVer.trades) {
      const m = new Date(t.entryTime).toISOString().slice(0, 7);
      if (!byMonth[m]) byMonth[m] = { wins: 0, losses: 0, pnl: 0 };
      byMonth[m].pnl += t.pnlR ?? 0;
      (t.pnlR ?? 0) > 0 ? byMonth[m].wins++ : byMonth[m].losses++;
    }
    console.log(`  ${"월".padEnd(8)} ${"건수".padStart(4)} ${"승/패".padStart(6)} ${"PnL".padStart(9)}`);
    console.log(`  ${"─".repeat(32)}`);
    let cumM = 0;
    for (const [m, s] of Object.entries(byMonth).sort()) {
      cumM += s.pnl;
      const mark = s.pnl > 0 ? "▲" : s.pnl < 0 ? "▼" : "─";
      console.log(`  ${m}  ${String(s.wins+s.losses).padStart(3)}건 ${String(s.wins).padStart(2)}승${String(s.losses).padStart(2)}패  ${mark}${r(s.pnl).padStart(8)} (누적:${r(cumM)})`);
    }

    // ③ GF 방향별 분석
    console.log(`\n  [3] SHARP-GF 방향별 분석`);
    for (const dir of ["bullish", "bearish"] as const) {
      const dt = gfVer.trades.filter(t => t.direction === dir);
      if (dt.length === 0) continue;
      const wins = dt.filter(t => (t.pnlR??0) > 0);
      const pnl  = dt.reduce((s,t)=>s+(t.pnlR??0),0);
      const label = dir === "bullish" ? "🟢 롱" : "🔴 숏";
      console.log(`  ${label}  ${dt.length}건  승률:${pct(wins.length/dt.length)}  총PnL:${r(pnl)}  기댓값:${r(pnl/dt.length)}`);
    }

    // ④ GF 청산사유별 분석
    console.log(`\n  [4] SHARP-GF 청산사유별 분석`);
    const byExit: Record<string, { cnt: number; pnl: number }> = {};
    for (const t of gfVer.trades) {
      const k = t.exitReason ?? "?";
      if (!byExit[k]) byExit[k] = { cnt: 0, pnl: 0 };
      byExit[k].cnt++;
      byExit[k].pnl += t.pnlR ?? 0;
    }
    for (const [reason, s] of Object.entries(byExit)) {
      console.log(`  ${reason.padEnd(24)} ${String(s.cnt).padStart(3)}건  PnL:${r(s.pnl).padStart(9)}  평균:${r(s.pnl/s.cnt).padStart(8)}`);
    }

    // ⑤ GF OB 타입별 분석
    console.log(`\n  [5] SHARP-GF OB 타입별 분석`);
    const byType: Record<string, { cnt: number; wins: number; pnl: number }> = {};
    for (const t of gfVer.trades) {
      const k = t.obType ?? "?";
      if (!byType[k]) byType[k] = { cnt: 0, wins: 0, pnl: 0 };
      byType[k].cnt++;
      if ((t.pnlR??0) > 0) byType[k].wins++;
      byType[k].pnl += t.pnlR ?? 0;
    }
    for (const [type, s] of Object.entries(byType)) {
      console.log(`  ${type.padEnd(24)} ${String(s.cnt).padStart(3)}건  승률:${pct(s.wins/s.cnt).padStart(6)}  PnL:${r(s.pnl).padStart(9)}`);
    }

    // ⑥ 트레이드 상세
    console.log(`\n  [6] SHARP-GF 트레이드 전체`);
    printTradeDetail("BTCUSDT", "SHARP-GF", gfVer.trades);
  }

  console.log(`\n${"═".repeat(72)}`);
}

// ── 드로우다운 분석 ─────────────────────────────────────
function analyzeDD(trades: BacktestPosition[]) {
  let maxDD = 0, peak = 0, cum = 0;
  let maxConsec = 0, curConsec = 0;
  let streakStart = 0, worstStart = 0, worstEnd = 0, worstDD = 0;

  for (const t of trades) {
    const p = t.pnlR ?? 0;
    cum += p;
    if (cum > peak) peak = cum;
    const dd = peak - cum;
    if (dd > maxDD) maxDD = dd;

    if (p <= 0) {
      if (curConsec === 0) streakStart = t.entryTime;
      curConsec++;
      if (curConsec > maxConsec) {
        maxConsec = curConsec;
        worstStart = streakStart;
        worstEnd = t.entryTime;
        worstDD = peak - cum;
      }
    } else {
      curConsec = 0;
    }
  }
  return { maxDD, maxConsec, worstStart, worstEnd, worstDD };
}

// ── 버전 요약 출력 ──────────────────────────────────────
function printVersion(label: string, results: SymbolResult[]) {
  const allTrades = results.flatMap(r => r.trades).sort((a, b) => a.entryTime - b.entryTime);
  const totalT = results.reduce((s,r) => s+r.totalTrades, 0);
  const wins   = results.reduce((s,r) => s+r.wins, 0);
  const pnl    = results.reduce((s,r) => s+r.totalPnlR, 0);
  const dd     = analyzeDD(allTrades);

  console.log(`\n${"═".repeat(64)}`);
  console.log(`  ${label}`);
  console.log(`${"═".repeat(64)}`);
  console.log(`  총 ${totalT}건  승률:${pct(wins/Math.max(1,totalT))}  총PnL:${r(pnl)}  기댓값:${r(pnl/Math.max(1,totalT))}`);
  console.log(`  최대낙폭:${dd.maxDD.toFixed(1)}R  최장연패:${dd.maxConsec}회  최악구간낙폭:${dd.worstDD.toFixed(1)}R`);
  console.log(`  최악구간: ${new Date(dd.worstStart).toISOString().slice(0,10)} ~ ${new Date(dd.worstEnd).toISOString().slice(0,10)}`);
  console.log(bar());
  console.log(`  ${"심볼".padEnd(9)} ${"건수".padStart(4)} ${"승률".padStart(6)} ${"총PnL".padStart(9)} ${"기댓값".padStart(8)} ${"최대낙폭".padStart(8)}`);
  console.log(`  ${bar("-", 54)}`);
  for (const res of results) {
    console.log(
      `  ${res.symbol.padEnd(9)} ${String(res.totalTrades).padStart(4)}건 ` +
      `${pct(res.winRate).padStart(6)} ` +
      `${r(res.totalPnlR).padStart(9)} ` +
      `${r(res.expectancy).padStart(8)} ` +
      `${res.maxDrawdownR.toFixed(1).padStart(7)}R`
    );
  }
}

// ── 다중 버전 비교 요약 ─────────────────────────────────
function printCompareSummary(
  entries: Array<{ label: string; results: SymbolResult[] }>
) {
  const stat = (res: SymbolResult[]) => {
    const allT  = res.flatMap(r => r.trades).sort((a,b)=>a.entryTime-b.entryTime);
    const total = res.reduce((s,r)=>s+r.totalTrades,0);
    const wins  = res.reduce((s,r)=>s+r.wins,0);
    const pnl   = res.reduce((s,r)=>s+r.totalPnlR,0);
    const dd    = analyzeDD(allT);
    return { total, wr: wins/Math.max(1,total), pnl, exp: pnl/Math.max(1,total), dd };
  };

  console.log(`\n${"═".repeat(64)}`);
  console.log(`  전체 비교 요약`);
  console.log(`${"═".repeat(64)}`);
  console.log(`  ${"".padEnd(16)} ${"건수".padStart(5)} ${"승률".padStart(6)} ${"총PnL".padStart(9)} ${"기댓값".padStart(8)} ${"최대낙폭".padStart(8)} 최장연패`);
  console.log(`  ${bar("-", 62)}`);
  for (const { label, results } of entries) {
    const s = stat(results);
    const fmt = `${String(s.total).padStart(5)}건 ${pct(s.wr).padStart(6)} ${r(s.pnl).padStart(9)} ${r(s.exp).padStart(8)} ${s.dd.maxDD.toFixed(1).padStart(7)}R ${s.dd.maxConsec}연패`;
    console.log(`  ${label.padEnd(16)} ${fmt}`);
  }
  console.log(`${"═".repeat(64)}\n`);
}

// ── 심볼별 D vs G 상세 비교 ──────────────────────────────
function printSymbolComparison(
  labA: string, rA: SymbolResult[],
  labB: string, rB: SymbolResult[],
) {
  console.log(`\n${"═".repeat(80)}`);
  console.log(`  심볼별 상세 비교: ${labA}  vs  ${labB}`);
  console.log(`${"═".repeat(80)}`);

  const header =
    `  ${"심볼".padEnd(9)} ` +
    `${"건수".padStart(4)} ${"승률".padStart(6)} ${"총PnL".padStart(8)} ${"기댓값".padStart(7)} ${"MDD".padStart(6)}  ` +
    `${"건수".padStart(4)} ${"승률".padStart(6)} ${"총PnL".padStart(8)} ${"기댓값".padStart(7)} ${"MDD".padStart(6)}  ` +
    `${"PnL차".padStart(7)} ${"MDD차".padStart(7)}`;
  const divider = `  ${bar("-", 76)}`;

  console.log(`  ${"".padEnd(9)} ── ${labA} ${"─".repeat(28)} ── ${labB} ${"─".repeat(28)}`);
  console.log(header);
  console.log(divider);

  let totBuilds = 0, totWinsA = 0, totWinsB = 0;
  let totPnlA = 0, totPnlB = 0;

  for (const symA of rA) {
    const symB = rB.find(x => x.symbol === symA.symbol)!;
    const fmtA = `${String(symA.totalTrades).padStart(4)}건 ${pct(symA.winRate).padStart(6)} ${r(symA.totalPnlR).padStart(8)} ${r(symA.expectancy).padStart(7)} ${symA.maxDrawdownR.toFixed(1).padStart(5)}R`;
    const fmtB = `${String(symB.totalTrades).padStart(4)}건 ${pct(symB.winRate).padStart(6)} ${r(symB.totalPnlR).padStart(8)} ${r(symB.expectancy).padStart(7)} ${symB.maxDrawdownR.toFixed(1).padStart(5)}R`;
    const pnlDiff = symB.totalPnlR - symA.totalPnlR;
    const mddDiff = symB.maxDrawdownR - symA.maxDrawdownR;
    const pnlMark = pnlDiff >= 0 ? "▲" : "▼";
    const mddMark = mddDiff <= 0 ? "▼" : "▲"; // MDD 낮을수록 좋음
    console.log(
      `  ${symA.symbol.padEnd(9)} ${fmtA}  ${fmtB}  ` +
      `${pnlMark}${r(pnlDiff).padStart(6)} ${mddMark}${mddDiff.toFixed(1).padStart(5)}R`
    );
    totWinsA += symA.wins; totWinsB += symB.wins;
    totPnlA  += symA.totalPnlR; totPnlB  += symB.totalPnlR;
    totBuilds += symA.totalTrades;
  }

  const totA = rA.reduce((s, x) => s + x.totalTrades, 0);
  const totB = rB.reduce((s, x) => s + x.totalTrades, 0);
  console.log(divider);
  console.log(
    `  ${"합계".padEnd(9)} ` +
    `${String(totA).padStart(4)}건 ${pct(totWinsA/Math.max(1,totA)).padStart(6)} ${r(totPnlA).padStart(8)} ${r(totPnlA/Math.max(1,totA)).padStart(7)}       ` +
    `${String(totB).padStart(4)}건 ${pct(totWinsB/Math.max(1,totB)).padStart(6)} ${r(totPnlB).padStart(8)} ${r(totPnlB/Math.max(1,totB)).padStart(7)}       ` +
    `  ${r(totPnlB - totPnlA).padStart(7)}`
  );
  console.log(`${"═".repeat(80)}`);

  // 심볼별 승패 요약
  console.log(`\n  [D→G 전환 효과 요약]`);
  for (const symA of rA) {
    const symB = rB.find(x => x.symbol === symA.symbol)!;
    const pnlDiff = symB.totalPnlR - symA.totalPnlR;
    const mddDiff = symB.maxDrawdownR - symA.maxDrawdownR;
    const tradeDiff = symB.totalTrades - symA.totalTrades;
    const verdict =
      pnlDiff >= 0 && mddDiff <= 0 ? "✅ 양방향 개선" :
      pnlDiff >= 0 && mddDiff >  0 ? "⚡ PnL↑ MDD↑" :
      pnlDiff <  0 && mddDiff <= 0 ? "🛡 PnL↓ MDD↓" :
      "❌ 양방향 악화";
    console.log(
      `  ${symA.symbol.padEnd(9)} 거래수 ${String(tradeDiff).padStart(3)}건  ` +
      `PnL ${r(pnlDiff).padStart(7)}  MDD ${mddDiff.toFixed(1).padStart(5)}R  ${verdict}`
    );
  }
  console.log();
}

// ── 메인 ───────────────────────────────────────────────
async function main() {
  console.log(`[Backtest] 데이터 로드 중...`);
  const dataMap: Record<string, { c4h: any[]; c1h: any[]; c15m: any[] }> = {};
  for (const sym of SYMBOLS) {
    process.stdout.write(`  ${sym}... `);
    const [c4h, c1h, c15m] = await Promise.all([
      fetchHistoricalOHLCV(sym, "4h",  DATA_FROM, TEST_UNTIL),
      fetchHistoricalOHLCV(sym, "1h",  DATA_FROM, TEST_UNTIL),
      fetchHistoricalOHLCV(sym, "15m", DATA_FROM, TEST_UNTIL),
    ]);
    dataMap[sym] = { c4h, c1h, c15m };
    console.log(`OK (4H:${c4h.length})`);
  }

  // runSymbolBacktest(sym, 4h, 1h, 15m, from,
  //   choch, sizing, filters, kelly, kellyConditional, circuitBreaker, drawdownSizing, mainTF)
  const run = (
    choch: boolean, sizing: boolean,
    filters = false, kelly = false, kellyConditional = false,
    circuitBreaker = false, drawdownSizing = false,
    mainTF: "4h" | "1h" = "4h",
    liqSweep = false, fvg = false, htfRegime = false, volSurge = false
  ) =>
    SYMBOLS.map(sym => {
      const { c4h, c1h, c15m } = dataMap[sym];
      return runSymbolBacktest(
        sym, c4h, c1h, c15m, TEST_FROM,
        choch, sizing, filters, kelly, kellyConditional,
        circuitBreaker, drawdownSizing, mainTF,
        liqSweep, fvg, htfRegime, volSurge
      );
    });

  // ── SHARP 기준선 ────────────────────────────────────
  console.log(`\n[SHARP-D] 기준 실행...`);
  const rD = run(...SHARP_D);
  console.log(`[SHARP-G] MDD 방어 기준 실행...`);
  const rG = run(...SHARP_G);

  // ── ML 피처 수정판 ────────────────────────────────────
  // run(choch, sizing, filters, kelly, kCond, cb, ddSizing, tf, liqSweep, fvg, htfRegime, volSurge)
  console.log(`[L2] SHARP-D + LiqSweep 수정 (lookback=8, ATR×0.3 최소 wick) 실행...`);
  const rL2 = run(true, false, true, false, false, false, false, "4h", true,  false, false, false);
  console.log(`[R2] SHARP-D + HTF Regime 수정 (SMA100) 실행...`);
  const rR2 = run(true, false, true, false, false, false, false, "4h", false, false, true,  false);

  // ── SHARP + FVG 통합 ─────────────────────────────────
  console.log(`[SHARP-F]  SHARP-D + FVG 통합 실행...`);
  const rF = run(...SHARP_F);
  console.log(`[SHARP-GF] SHARP-G + FVG 통합 실행...`);
  const rGF = run(...SHARP_GF);

  // ── 버전별 상세 결과 ──────────────────────────────────
  printVersion("[ SHARP-D  ] 기준",                    rD);
  printVersion("[ SHARP-G  ] 기준+CB",                 rG);
  printVersion("[ L2 ] SHARP-D + LiqSweep(수정)",      rL2);
  printVersion("[ R2 ] SHARP-D + HTFRegime(SMA100)",   rR2);
  printVersion("[ SHARP-F  ] SHARP-D + FVG",           rF);
  printVersion("[ SHARP-GF ] SHARP-G + FVG",           rGF);

  // ── 심볼별 비교 ──────────────────────────────────────
  printSymbolComparison("SHARP-D",  rD,  "L2.LiqSweep", rL2);
  printSymbolComparison("SHARP-D",  rD,  "R2.HTFReg",   rR2);
  printSymbolComparison("SHARP-D",  rD,  "SHARP-F",     rF);
  printSymbolComparison("SHARP-G",  rG,  "SHARP-GF",    rGF);

  printCompareSummary([
    { label: "SHARP-D(기준)",      results: rD  },
    { label: "SHARP-G(CB)",        results: rG  },
    { label: "L2.LiqSweep(수정)",  results: rL2 },
    { label: "R2.HTFReg(SMA100)",  results: rR2 },
    { label: "SHARP-F(D+FVG)",     results: rF  },
    { label: "SHARP-GF(G+FVG)",    results: rGF },
  ]);

  // ── BTCUSDT 심층 분석 ──────────────────────────────────
  const getBtc = (res: SymbolResult[]) => res.find(r => r.symbol === "BTCUSDT")?.trades ?? [];
  printBtcDeepAnalysis([
    { label: "SHARP-D",  trades: getBtc(rD)  },
    { label: "SHARP-G",  trades: getBtc(rG)  },
    { label: "SHARP-F",  trades: getBtc(rF)  },
    { label: "SHARP-GF", trades: getBtc(rGF) },
  ]);
}

main().catch(err => { console.error(err); process.exit(1); });
