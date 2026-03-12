import "dotenv/config";
import { Client, GatewayIntentBits, TextChannel, AttachmentBuilder } from "discord.js";
import { runAnalysis } from "../analysis/analyzer";
import { formatOBResults } from "../bot/formatter";
import { generateChart } from "./chart-generator";
import { DISCORD_BOT_TOKEN, DISCORD_CHANNEL_ID } from "../config";

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once("clientReady", async () => {
  console.log(`로그인: ${client.user?.tag}`);

  const symbol = process.argv[2]?.toUpperCase() ?? "BTCUSDT";

  try {
    console.log(`${symbol} 분석 중...`);
    const result = await runAnalysis(symbol, false);

    // 차트 이미지 생성
    console.log("차트 이미지 생성 중...");
    const imgBuffer = generateChart(symbol, result.candles4h, result.orderBlocks, result.rsi4h);

    const channel = await client.channels.fetch(DISCORD_CHANNEL_ID);
    if (!channel || !(channel instanceof TextChannel)) {
      throw new Error("채널을 찾을 수 없음");
    }

    const attachment = new AttachmentBuilder(imgBuffer, { name: `${symbol}-ob.png` });
    const embeds = formatOBResults(result);

    // 이미지 + embed 함께 전송
    await channel.send({ files: [attachment] });
    await channel.send({ embeds });

    console.log("✅ 전송 완료");
  } catch (err) {
    console.error("오류:", err);
  } finally {
    client.destroy();
  }
});

client.login(DISCORD_BOT_TOKEN);
