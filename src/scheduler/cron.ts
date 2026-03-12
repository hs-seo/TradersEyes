import cron from "node-cron";
import { runAnalysis } from "../analysis/analyzer";
import { sendToChannel } from "../bot/client";
import { formatSAlert, formatStatusSummary } from "../bot/formatter";
import { generateChart } from "../scripts/chart-generator";
import { SYMBOLS } from "../config";

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
}
