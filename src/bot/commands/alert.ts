import { ChatInputCommandInteraction } from "discord.js";
import { runAnalysis } from "../../analysis/analyzer";
import { formatAlertList } from "../formatter";
import { SYMBOLS } from "../../config";

export async function handleAlert(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  await interaction.deferReply();

  try {
    const results = await Promise.all(
      SYMBOLS.map((s) => runAnalysis(s, false))
    );
    const embed = formatAlertList(results);
    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    console.error("[/alert] 오류:", err);
    await interaction.editReply({ content: `오류 발생: ${String(err).slice(0, 200)}` });
  }
}
