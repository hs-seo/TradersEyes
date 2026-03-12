import { ChatInputCommandInteraction, EmbedBuilder } from "discord.js";

export async function handleHelp(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("📖 TradersEyes 사용법 — #check_ob 채널 전용 봇")
    .setDescription(
      "ICT/SMC 기반 Order Block 자동 탐지 봇입니다.\n" +
      "**#check_ob 채널**에서만 사용해주세요.\n\u200b"
    )
    .addFields(
      {
        name: "🔍 `/analyze <symbol>`",
        value:
          "특정 심볼을 즉시 분석합니다.\n" +
          "차트 이미지 + S/A급 OB + 진입가/손절가/익절가(TP1·TP2) 반환\n" +
          "예) `/analyze BTCUSDT`",
        inline: false,
      },
      {
        name: "📌 `/poi`",
        value:
          "전체 7개 심볼의 **A급 이상 POI(관심 구간)** 를 한눈에 조회합니다.\n" +
          "현재가 기준 거리(%) 포함",
        inline: false,
      },
      {
        name: "🚨 `/alert`",
        value:
          "현재 **S급(골든존) 즉시 진입 자리** 목록을 조회합니다.\n" +
          "자동 알림과 동일한 기준 (CHoCH 확인 + OB 근접 + 고신뢰도)",
        inline: false,
      },
      {
        name: "📋 `/status`",
        value:
          "전체 심볼별 활성 OB 수와 근접 OB 수를 요약합니다.",
        inline: false,
      },
      {
        name: "❓ `/help`",
        value: "이 도움말을 표시합니다.",
        inline: false,
      },
      {
        name: "\u200b",
        value:
          "**🔔 자동 알림 기준**\n" +
          "매시 5분, 7개 심볼 전체 분석 후 **S급 자리 발생 시에만** 자동 전송\n" +
          "S급 조건: OB 근접(2% 이내) + CHoCH/BOS 확인 + MTF Confluence 등 7점 이상\n\u200b",
        inline: false,
      },
      {
        name: "📊 지원 심볼",
        value: "`BTCUSDT` `ETHUSDT` `SOLUSDT` `XRPUSDT` `TRXUSDT` `DOGEUSDT` `ADAUSDT`",
        inline: false,
      }
    )
    .setFooter({ text: "TradersEyes | #check_ob 채널 전용 | ICT/SMC OB 탐지 봇" })
    .setTimestamp();

  await interaction.reply({ embeds: [embed], ephemeral: false });
}
