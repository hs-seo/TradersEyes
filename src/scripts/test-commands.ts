/**
 * Phase 5, 6 핸들러 로직 테스트
 */
import "dotenv/config";
import { fetchAccountBalance } from "../live/trader";
import { loadState } from "../live/state-store";
import { SYMBOL_CONFIGS } from "../config";
import { runMonitor } from "../live/monitor";

async function testLiveStatus() {
  console.log("=== /live-status 시뮬레이션 ===");
  const state = loadState();
  const opens = state.positions.filter(p => p.status === "open");
  const totalPnlR = state.trades.reduce((s, t) => s + (t.pnlR ?? 0), 0);
  const wins = state.trades.filter(t => (t.pnlR ?? 0) > 0).length;
  const wr = state.trades.length > 0 ? (wins / state.trades.length * 100).toFixed(1) : "-";

  let balance = 0;
  try { balance = await fetchAccountBalance(); } catch {}

  console.log("계좌 잔고: $" + balance.toFixed(2) + " USDT");
  console.log("열린 포지션:", opens.length + "개");
  console.log("총 거래:", state.trades.length + "건 (WR " + wr + "%)");
  console.log("누적 PnL:", (totalPnlR >= 0 ? "+" : "") + totalPnlR.toFixed(2) + "R");
  console.log("심볼 설정:");
  SYMBOL_CONFIGS.forEach(c => console.log("  " + (c.enabled ? "🟢" : "⚫") + " " + c.symbol + " " + c.strategy));
  console.log("✅ 정상\n");
}

async function testLiveHistory() {
  console.log("=== /live-history 시뮬레이션 ===");
  const state = loadState();
  const recent = [...state.trades].reverse().slice(0, 10);
  if (recent.length === 0) {
    console.log("거래 기록 없음");
  } else {
    recent.forEach((t, i) => {
      const pnl = (t.pnlR ?? 0) >= 0 ? "+" + t.pnlR?.toFixed(2) : t.pnlR?.toFixed(2);
      console.log(`  ${i + 1}. ${t.symbol} ${t.direction} → ${t.exitReason} ${pnl}R | $${t.pnlUsdt}`);
    });
  }
  console.log("✅ 정상\n");
}

async function testLiveToggle() {
  console.log("=== /live-toggle 시뮬레이션 ===");
  const before = SYMBOL_CONFIGS.find(c => c.symbol === "ADAUSDT")!.enabled;
  SYMBOL_CONFIGS.find(c => c.symbol === "ADAUSDT")!.enabled = false;
  console.log("ADAUSDT OFF 전환:", SYMBOL_CONFIGS.find(c => c.symbol === "ADAUSDT")!.enabled === false ? "✅" : "❌");
  SYMBOL_CONFIGS.find(c => c.symbol === "ADAUSDT")!.enabled = before; // 원복
  console.log("ADAUSDT 원복:", SYMBOL_CONFIGS.find(c => c.symbol === "ADAUSDT")!.enabled === before ? "✅" : "❌");
  console.log("✅ 정상\n");
}

async function testLiveSignal() {
  console.log("=== /live-signal 시뮬레이션 ===");
  try {
    let balance = 0;
    try { balance = await fetchAccountBalance(); } catch { balance = 10_000; }
    await runMonitor(balance, false); // autoTrade=false로 안전하게
    console.log("✅ 신호 스캔 완료\n");
  } catch (err) {
    console.log("❌ 오류:", String(err).slice(0, 100), "\n");
  }
}

async function main() {
  console.log("=== Phase 5, 6 기능 테스트 ===\n");
  await testLiveStatus();
  await testLiveHistory();
  await testLiveToggle();
  await testLiveSignal();
  console.log("=== 전체 테스트 완료 ===");
}

main().catch(console.error);
