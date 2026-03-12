import "dotenv/config";
import { Client, GatewayIntentBits, TextChannel } from "discord.js";
import { runAnalysis } from "../analysis/analyzer";
import { formatOBResults } from "../bot/formatter";
import { DISCORD_BOT_TOKEN, DISCORD_CHANNEL_ID } from "../config";

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once("clientReady", async () => {
  console.log(`로그인: ${client.user?.tag}`);

  try {
    console.log("BTCUSDT 분석 중...");
    const result = await runAnalysis("BTCUSDT", false);
    const embeds = formatOBResults(result);

    const channel = await client.channels.fetch(DISCORD_CHANNEL_ID);
    if (!channel || !(channel instanceof TextChannel)) {
      throw new Error("채널을 찾을 수 없음");
    }

    await channel.send({ embeds });
    console.log("✅ 전송 완료");
  } catch (err) {
    console.error("오류:", err);
  } finally {
    client.destroy();
  }
});

client.login(DISCORD_BOT_TOKEN);
