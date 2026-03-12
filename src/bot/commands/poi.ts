import { ChatInputCommandInteraction } from "discord.js";
import { runAnalysis } from "../../analysis/analyzer";
import { formatPOI } from "../formatter";
import { SYMBOLS } from "../../config";

export async function handlePoi(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  await interaction.deferReply();

  try {
    const results = await Promise.all(
      SYMBOLS.map((s) => runAnalysis(s, false))
    );
    const embed = formatPOI(results);
    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    console.error("[/poi] 오류:", err);
    await interaction.editReply({ content: `오류 발생: ${String(err).slice(0, 200)}` });
  }
}
