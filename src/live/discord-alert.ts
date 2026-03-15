/**
 * Discord 라이브 알람
 */
import { WebhookClient, EmbedBuilder } from "discord.js";
import type { LiveSignal, LivePosition, TradeRecord } from "./types";

// 봇 클라이언트 대신 webhook으로 직접 전송 (봇 미기동 시에도 동작)
const WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL ?? "";

function getWebhook(): WebhookClient | null {
  if (!WEBHOOK_URL) return null;
  return new WebhookClient({ url: WEBHOOK_URL });
}

const DIR_EMOJI = (d: "bullish" | "bearish") => d === "bullish" ? "🟢" : "🔴";
const DIR_KR    = (d: "bullish" | "bearish") => d === "bullish" ? "롱" : "숏";
const r2 = (n: number) => n.toFixed(2);
const pct = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(2)}%`;

export async function sendSignalAlert(signal: LiveSignal): Promise<void> {
  const wh = getWebhook();
  if (!wh) { console.warn("[Alert] DISCORD_WEBHOOK_URL 미설정"); return; }

  const dir = signal.direction;
  const embed = new EmbedBuilder()
    .setTitle(`${DIR_EMOJI(dir)} SHARP-GF 신호 — ${signal.symbol}`)
    .setColor(dir === "bullish" ? 0x00c853 : 0xd50000)
    .addFields(
      { name: "전략",   value: signal.strategy,                    inline: true },
      { name: "방향",   value: `${DIR_EMOJI(dir)} ${DIR_KR(dir)}`, inline: true },
      { name: "OB타입", value: signal.obType,                      inline: true },
      { name: "진입가", value: `$${r2(signal.entryPrice)}`,        inline: true },
      { name: "손절가", value: `$${r2(signal.stop)}`,              inline: true },
      { name: "Risk",   value: `$${r2(signal.risk)} (${signal.riskPct}%)`, inline: true },
      { name: "TP1",    value: `$${r2(signal.tp1)} (+2R)`,         inline: true },
      { name: "TP2",    value: `$${r2(signal.tp2)} (+3R)`,         inline: true },
      { name: "RSI",    value: r2(signal.rsi),                     inline: true },
      { name: "Score",  value: String(signal.score),               inline: true },
      { name: "레버리지", value: `${signal.leverage}x`,            inline: true },
      { name: "포지션",  value: `$${r2(signal.positionSizeUsdt)}`, inline: true },
    )
    .setTimestamp(signal.detectedAt)
    .setFooter({ text: "TradersEyes | SHARP-GF" });

  await wh.send({ embeds: [embed] });
  wh.destroy();
}

export async function sendPositionOpenAlert(pos: LivePosition): Promise<void> {
  const wh = getWebhook();
  if (!wh) return;

  const dir = pos.direction;
  const embed = new EmbedBuilder()
    .setTitle(`✅ 포지션 진입 — ${pos.symbol}`)
    .setColor(dir === "bullish" ? 0x00c853 : 0xd50000)
    .addFields(
      { name: "방향",   value: `${DIR_EMOJI(dir)} ${DIR_KR(dir)}`, inline: true },
      { name: "진입가", value: `$${r2(pos.entryPrice)}`,           inline: true },
      { name: "SL",     value: `$${r2(pos.stop)}`,                 inline: true },
      { name: "TP1",    value: `$${r2(pos.tp1)}`,                  inline: true },
      { name: "TP2",    value: `$${r2(pos.tp2)}`,                  inline: true },
      { name: "레버리지", value: `${pos.leverage}x`,               inline: true },
    )
    .setTimestamp();

  await wh.send({ embeds: [embed] });
  wh.destroy();
}

export async function sendPositionCloseAlert(record: TradeRecord): Promise<void> {
  const wh = getWebhook();
  if (!wh) return;

  const win = (record.pnlR ?? 0) > 0;
  const embed = new EmbedBuilder()
    .setTitle(`${win ? "🏆" : "💸"} 포지션 종료 — ${record.symbol}`)
    .setColor(win ? 0x00c853 : 0xd50000)
    .addFields(
      { name: "방향",   value: `${DIR_EMOJI(record.direction)} ${DIR_KR(record.direction)}`, inline: true },
      { name: "진입가", value: `$${r2(record.entryPrice)}`,  inline: true },
      { name: "청산가", value: `$${r2(record.exitPrice)}`,   inline: true },
      { name: "사유",   value: record.exitReason,             inline: true },
      { name: "PnL(R)", value: `${pct(record.pnlR ?? 0)}R`, inline: true },
      { name: "PnL($)", value: `${record.pnlUsdt >= 0 ? "+" : ""}$${r2(record.pnlUsdt)}`, inline: true },
    )
    .setTimestamp();

  await wh.send({ embeds: [embed] });
  wh.destroy();
}

export async function sendErrorAlert(message: string): Promise<void> {
  const wh = getWebhook();
  if (!wh) return;
  await wh.send({ content: `⚠️ **오류**: ${message}` });
  wh.destroy();
}
