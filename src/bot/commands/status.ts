import { ChatInputCommandInteraction } from "discord.js";
import { getActiveOBs } from "../../store/ob-store";
import { SYMBOLS } from "../../config";
import { formatStatusSummary } from "../formatter";
import { analyzeMultiTimeframe } from "../../analysis/multi-timeframe";
import { fetchOHLCV } from "../../data/fetcher";
import { TIMEFRAMES } from "../../config";

export async function handleStatus(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  await interaction.deferReply();

  try {
    const summaries: Array<{
      symbol: string;
      activeCount: number;
      nearCount: number;
    }> = [];

    for (const symbol of SYMBOLS) {
      const obs = getActiveOBs(symbol);
      let nearCount = 0;

      if (obs.length > 0) {
        try {
          const candles15m = await fetchOHLCV(symbol, TIMEFRAMES.entry, 50);
          const signals = analyzeMultiTimeframe(obs, candles15m);
          nearCount = signals.filter((s) => s.isNearEntry).length;
        } catch {
          // 15m 데이터 오류는 무시
        }
      }

      summaries.push({ symbol, activeCount: obs.length, nearCount });
    }

    const embed = formatStatusSummary(summaries);
    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    console.error("[/status] 오류:", err);
    await interaction.editReply({
      content: `오류 발생: ${String(err).slice(0, 200)}`,
    });
  }
}
