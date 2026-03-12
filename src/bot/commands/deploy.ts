import "dotenv/config";
import { REST, Routes, SlashCommandBuilder } from "discord.js";
import {
  DISCORD_BOT_TOKEN,
  DISCORD_APPLICATION_ID,
  DISCORD_GUILD_ID,
  SYMBOLS,
} from "../../config";

const commands = [
  new SlashCommandBuilder()
    .setName("analyze")
    .setDescription("심볼 즉시 OB 분석")
    .addStringOption((opt) =>
      opt
        .setName("symbol")
        .setDescription("분석할 심볼 (예: BTCUSDT)")
        .setRequired(true)
        .addChoices(...SYMBOLS.map((s) => ({ name: s, value: s })))
    ),
  new SlashCommandBuilder()
    .setName("status")
    .setDescription("전체 심볼 활성 OB 요약"),
  new SlashCommandBuilder()
    .setName("poi")
    .setDescription("전체 심볼 A급 이상 POI 현황 (거리순)"),
  new SlashCommandBuilder()
    .setName("alert")
    .setDescription("현재 S급 즉시 진입 자리 목록"),
  new SlashCommandBuilder()
    .setName("help")
    .setDescription("TradersEyes 사용법 및 커맨드 안내 (#check_ob 채널 전용)"),
].map((cmd) => cmd.toJSON());

async function deploy() {
  if (!DISCORD_BOT_TOKEN || !DISCORD_APPLICATION_ID) {
    console.error(
      "DISCORD_BOT_TOKEN 또는 DISCORD_APPLICATION_ID가 설정되지 않았습니다."
    );
    process.exit(1);
  }

  const rest = new REST({ version: "10" }).setToken(DISCORD_BOT_TOKEN);

  const route = DISCORD_GUILD_ID
    ? Routes.applicationGuildCommands(DISCORD_APPLICATION_ID, DISCORD_GUILD_ID)
    : Routes.applicationCommands(DISCORD_APPLICATION_ID);

  const scope = DISCORD_GUILD_ID ? `길드(${DISCORD_GUILD_ID})` : "글로벌";
  console.log(`슬래시 커맨드 등록 중 (${scope})...`);

  await rest.put(route, { body: commands });
  console.log("✅ 슬래시 커맨드 등록 완료");
}

deploy().catch((err) => {
  console.error("등록 실패:", err);
  process.exit(1);
});
