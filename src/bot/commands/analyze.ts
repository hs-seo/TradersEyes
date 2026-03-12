import { ChatInputCommandInteraction, AttachmentBuilder } from "discord.js";
import { runAnalysis } from "../../analysis/analyzer";
import { formatOBResults } from "../formatter";
import { generateChart } from "../../scripts/chart-generator";
import { SYMBOLS } from "../../config";

export async function handleAnalyze(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const rawSymbol = interaction.options.getString("symbol", true).toUpperCase();

  if (!SYMBOLS.includes(rawSymbol as (typeof SYMBOLS)[number])) {
    await interaction.reply({
      content: `지원하지 않는 심볼입니다. 사용 가능: ${SYMBOLS.join(", ")}`,
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply();

  try {
    const result = await runAnalysis(rawSymbol, false);
    const embeds = formatOBResults(result);
    const imgBuffer = generateChart(
      rawSymbol,
      result.candles4h,
      result.orderBlocks,
      result.rsi4h
    );
    const attachment = new AttachmentBuilder(imgBuffer, {
      name: `${rawSymbol}-ob.png`,
    });
    await interaction.editReply({ files: [attachment], embeds });
  } catch (err) {
    console.error(`[/analyze] 오류 (${rawSymbol}):`, err);
    await interaction.editReply({
      content: `분석 중 오류 발생: ${String(err).slice(0, 200)}`,
    });
  }
}
