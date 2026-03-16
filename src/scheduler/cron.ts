import cron from "node-cron";
import { runAnalysis } from "../analysis/analyzer";
import { sendToChannel } from "../bot/client";
import { formatSAlert, formatStatusSummary } from "../bot/formatter";
import { generateChart } from "../scripts/chart-generator";
import { SYMBOLS } from "../config";
import { runMonitor } from "../live/monitor";
import { runPositionManager } from "../live/position-manager";
import { fetchAccountBalance } from "../live/trader";
import { updatePOI, setNextScanTime } from "../live/scan-log";

// S급 알림 중복 방지: "심볼:OB-id" 저장
const alertedIds = new Set<string>();

// 1시간마다 전체 심볼 분석
const CRON_EXPRESSION = "5 * * * *"; // 매시 5분 (Binance 캔들 마감 후 여유)

export function startCron(): void {
  cron.schedule(CRON_EXPRESSION, async () => {
    const ts = new Date().toISOString();
    console.log(`[Cron] ${ts} 전체 심볼 분석 시작`);

    for (const symbol of SYMBOLS) {
      try {
        const result = await runAnalysis(symbol, false);

        // POI 캐시 갱신 (S/A급만)
        const currentPrice = result.candles4h.at(-1)?.close ?? 0;
        updatePOI(symbol, result.gradedOBs, currentPrice);

        // S급 OB 필터 — 아직 알림 안 보낸 것만
        const newSGrade = result.gradedOBs.filter(
          (g) => g.grade === "S" && !alertedIds.has(`${symbol}:${g.ob.id}`)
        );

        if (newSGrade.length > 0) {
          console.log(`[Cron] ${symbol} S급 ${newSGrade.length}개 발견 → 알림 전송`);

          const imgBuffer = generateChart(
            symbol,
            result.candles4h,
            result.orderBlocks,
            result.rsi4h
          );
          const embeds = formatSAlert(symbol, newSGrade, result);
          await sendToChannel(embeds, imgBuffer, symbol);
          console.log(`[Cron] ${symbol} 알림 전송 완료`);

          // 알림 보낸 ID 기록 (재알림 방지)
          newSGrade.forEach((g) => alertedIds.add(`${symbol}:${g.ob.id}`));
        } else {
          console.log(`[Cron] ${symbol} — S급 없음 (조용히 패스)`);
        }

        // Rate limit 방지: 심볼 간 1초 대기
        await new Promise((r) => setTimeout(r, 1000));
      } catch (err) {
        console.error(`[Cron] ${symbol} 분석 오류:`, err);
      }
    }

    console.log(`[Cron] 전체 심볼 분석 완료`);
  });

  console.log(`[Cron] 전체 심볼 1H 자동 분석 등록 (${CRON_EXPRESSION})`);

  // SHARP-GF 신호 스캔 — 매 1H (1H 캔들 마감 2분 후)
  cron.schedule("2 * * * *", async () => {
    console.log("[Cron] 1H 신호 스캔 시작");
    // 다음 스캔 시간: 다음 정시 + 2분
    const next = new Date();
    next.setHours(next.getHours() + 1, 2, 0, 0);
    setNextScanTime(next.getTime());
    try {
      const autoTrade = process.env.AUTO_TRADE === "true";
      let balance = 10_000;
      try { balance = await fetchAccountBalance(); } catch { /* ignore */ }
      await runMonitor(balance, autoTrade);
    } catch (err) {
      console.error("[Cron] 신호 스캔 오류:", err);
    }
  });
  console.log("[Cron] SHARP-GF 신호 스캔 등록 (매시 2분)");

  // 1H 포지션 관리 (매시 3분 — 1H 캔들 마감 후)
  cron.schedule("3 * * * *", async () => {
    try {
      await runPositionManager();
    } catch (err) {
      console.error("[Cron] 포지션 관리 오류:", err);
    }
  });
  console.log("[Cron] 1H 포지션 관리 등록 (매시 3분)");
}
