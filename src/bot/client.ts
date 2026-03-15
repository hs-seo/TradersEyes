import {
  Client,
  GatewayIntentBits,
  Interaction,
  TextChannel,
  APIEmbed,
  AttachmentBuilder,
} from "discord.js";
import { handleAnalyze } from "./commands/analyze";
import { handleStatus } from "./commands/status";
import { handlePoi } from "./commands/poi";
import { handleAlert } from "./commands/alert";
import { handleHelp } from "./commands/help";
import { handleLiveStatus, handleLiveHistory, handleLiveToggle, handleLiveSignal } from "./commands/live";
import { DISCORD_BOT_TOKEN, DISCORD_CHANNEL_ID } from "../config";

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once("clientReady", () => {
  console.log(`[Bot] 로그인 완료: ${client.user?.tag}`);
});

client.on("interactionCreate", async (interaction: Interaction) => {
  if (!interaction.isChatInputCommand()) return;

  switch (interaction.commandName) {
    case "analyze":
      await handleAnalyze(interaction);
      break;
    case "status":
      await handleStatus(interaction);
      break;
    case "poi":
      await handlePoi(interaction);
      break;
    case "alert":
      await handleAlert(interaction);
      break;
    case "help":
      await handleHelp(interaction);
      break;
    case "live-status":
      await handleLiveStatus(interaction);
      break;
    case "live-history":
      await handleLiveHistory(interaction);
      break;
    case "live-toggle":
      await handleLiveToggle(interaction);
      break;
    case "live-signal":
      await handleLiveSignal(interaction);
      break;
    default:
      console.warn(`[Bot] 알 수 없는 커맨드: ${interaction.commandName}`);
  }
});

export async function startBot(): Promise<void> {
  if (!DISCORD_BOT_TOKEN) {
    throw new Error("DISCORD_BOT_TOKEN이 설정되지 않았습니다.");
  }
  await client.login(DISCORD_BOT_TOKEN);
}

/** 자동 분석 결과를 지정 채널에 전송 (이미지 버퍼 있으면 함께 전송) */
export async function sendToChannel(
  embeds: APIEmbed[],
  imageBuffer?: Buffer,
  symbol?: string
): Promise<void> {
  if (!DISCORD_CHANNEL_ID) {
    console.warn("[Bot] DISCORD_CHANNEL_ID 미설정 — 채널 전송 건너뜀");
    return;
  }

  const channel = await client.channels.fetch(DISCORD_CHANNEL_ID).catch(() => null);
  if (!channel || !(channel instanceof TextChannel)) {
    console.warn("[Bot] 채널을 찾을 수 없거나 텍스트 채널이 아님");
    return;
  }

  if (imageBuffer) {
    const attachment = new AttachmentBuilder(imageBuffer, {
      name: `${symbol ?? "chart"}-ob.png`,
    });
    await channel.send({ files: [attachment], embeds });
  } else {
    await channel.send({ embeds });
  }
}

export { client };
