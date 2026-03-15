/**
 * 포지션 진입 → 종료 테스트 (데모)
 */
import "dotenv/config";
import { fetchAccountBalance, openPosition, handlePositionClose } from "../live/trader";
import { getOpenPositions } from "../live/state-store";
import type { LiveSignal } from "../live/types";

async function main() {
  console.log("=== TradersEyes 거래 테스트 (데모) ===\n");

  // 1. 잔고 조회
  console.log("[1] 계좌 잔고 조회...");
  const balance = await fetchAccountBalance();
  console.log(`    잔고: $${balance.toFixed(2)} USDT\n`);

  if (balance < 10) {
    console.error("잔고 부족. 데모 계좌를 확인하세요.");
    process.exit(1);
  }

  // 2. BTC 현재가 조회 (공개 API — 인증 불필요)
  console.log("[2] BTC 현재가 조회...");
  const res = await fetch("https://fapi.binance.com/fapi/v1/ticker/price?symbol=BTCUSDT");
  const { price } = await res.json() as { price: string };
  const currentPrice = parseFloat(price);
  console.log(`    BTC 현재가: $${currentPrice.toFixed(2)}`);

  const stop = currentPrice * 0.99;
  const tp1  = currentPrice * 1.02;
  const tp2  = currentPrice * 1.03;
  const risk = currentPrice - stop;

  const signal: LiveSignal = {
    symbol:            "BTCUSDT",
    strategy:          "SHARP-GF",
    direction:         "bullish",
    entryPrice:        currentPrice,
    stop,
    tp1,
    tp2,
    risk,
    riskPct:           1,
    leverage:          10,
    positionSizeUsdt:  Math.floor(balance * 0.01 * 10 * 100) / 100,
    obType:            "reversal-point",
    score:             10,
    rsi:               35,
    detectedAt:        Date.now(),
  };

  console.log(`    신호: LONG | 진입 $${currentPrice.toFixed(2)} | SL $${stop.toFixed(2)} | TP1 $${tp1.toFixed(2)}`);
  console.log(`    포지션 크기: $${signal.positionSizeUsdt.toFixed(2)}\n`);

  // 3. 포지션 진입
  console.log("[3] 포지션 진입 중...");
  await openPosition(signal);
  console.log("    ✅ 진입 완료\n");

  // 4. 상태 확인
  await new Promise(r => setTimeout(r, 2000));
  const positions = getOpenPositions();
  const pos = positions.find(p => p.symbol === "BTCUSDT" && p.status === "open");
  if (!pos) {
    console.error("    ❌ state-store에서 포지션 찾기 실패");
    process.exit(1);
  }
  console.log(`[4] 포지션 확인: ID=${pos.id.slice(0, 8)}... SL=${pos.slOrderId?.slice(0,8)} TP2=${pos.tp2OrderId?.slice(0,8)}\n`);

  // 5. 3초 후 수동 종료
  console.log("[5] 3초 후 수동 종료...");
  await new Promise(r => setTimeout(r, 3000));

  const res2 = await fetch("https://fapi.binance.com/fapi/v1/ticker/price?symbol=BTCUSDT");
  const { price: price2 } = await res2.json() as { price: string };
  const exitPrice = parseFloat(price2);

  await handlePositionClose(pos, exitPrice, "manual");
  console.log(`    ✅ 종료 완료 | 청산가: $${exitPrice.toFixed(2)}\n`);

  // 6. 결과
  const pnlR = (exitPrice - pos.entryPrice) / pos.risk;
  console.log(`[6] 결과:`);
  console.log(`    진입: $${pos.entryPrice.toFixed(2)} → 청산: $${exitPrice.toFixed(2)}`);
  console.log(`    PnL: ${pnlR >= 0 ? "+" : ""}${pnlR.toFixed(3)}R`);
  console.log("\n=== 테스트 완료 ===");
}

main().catch(err => {
  console.error("\n❌ 테스트 실패:", err.message ?? err);
  process.exit(1);
});
