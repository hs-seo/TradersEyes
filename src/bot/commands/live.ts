/**
 * 라이브 트레이딩 슬래시 커맨드
 * /live-status  : 열린 포지션 + 요약
 * /live-history : 최근 거래 10건
 * /live-toggle  : 심볼 활성화/비활성화
 * /live-signal  : 즉시 신호 스캔 (수동)
 */
import type { ChatInputCommandInteraction } from "discord.js";
import { EmbedBuilder } from "discord.js";
import { loadState } from "../../live/state-store";
import { SYMBOL_CONFIGS } from "../../config";
import { runMonitor } from "../../live/monitor";
import { fetchAccountBalance } from "../../live/trader";
import { getScanLog, getLastScanTime, getNextScanTime, getPOI } from "../../live/scan-log";

const r2 = (n: number) => n.toFixed(2);
const ts = (ms: number) => new Date(ms).toLocaleString("ko-KR");
const dir = (d: "bullish" | "bearish") => d === "bullish" ? "🟢 LONG" : "🔴 SHORT";

// ─── /live-status ────────────────────────────────────────────
export async function handleLiveStatus(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  const state = loadState();
  const opens = state.positions.filter(p => p.status === "open");

  let balance = 0;
  try { balance = await fetchAccountBalance(); } catch { /* testnet 미연결 가능 */ }

  const totalPnlR = state.trades.reduce((s, t) => s + (t.pnlR ?? 0), 0);
  const totalPnlUsdt = state.trades.reduce((s, t) => s + (t.pnlUsdt ?? 0), 0);
  const winCount = state.trades.filter(t => (t.pnlR ?? 0) > 0).length;
  const winRate = state.trades.length > 0
    ? ((winCount / state.trades.length) * 100).toFixed(1)
    : "-";

  const embed = new EmbedBuilder()
    .setTitle("📊 라이브 트레이딩 현황")
    .setColor(0x3b82f6)
    .addFields(
      { name: "계좌 잔고", value: `$${r2(balance)} USDT`, inline: true },
      { name: "열린 포지션", value: `${opens.length}개`, inline: true },
      { name: "총 거래",  value: `${state.trades.length}건 (WR ${winRate}%)`, inline: true },
      { name: "누적 PnL", value: `${totalPnlR >= 0 ? "+" : ""}${r2(totalPnlR)}R  ($${r2(totalPnlUsdt)})`, inline: false },
    )
    .setTimestamp();

  if (opens.length > 0) {
    const posText = opens.map(p =>
      `**${p.symbol}** ${dir(p.direction)} | 진입 $${r2(p.entryPrice)} | SL $${r2(p.stop)} | TP1 $${r2(p.tp1)}${p.tp1Hit ? " ✅" : ""}`
    ).join("\n");
    embed.addFields({ name: "포지션 상세", value: posText });
  }

  const cfgText = SYMBOL_CONFIGS.map(c =>
    `${c.enabled ? "🟢" : "⚫"} **${c.symbol}** ${c.strategy}`
  ).join("  ");
  embed.addFields({ name: "심볼 설정", value: cfgText });

  await interaction.editReply({ embeds: [embed] });
}

// ─── /live-history ───────────────────────────────────────────
export async function handleLiveHistory(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  const state = loadState();
  const recent = [...state.trades].reverse().slice(0, 10);

  if (recent.length === 0) {
    await interaction.editReply("거래 기록이 없습니다.");
    return;
  }

  const lines = recent.map((t, i) => {
    const pnl = (t.pnlR ?? 0) >= 0 ? `+${r2(t.pnlR ?? 0)}R` : `${r2(t.pnlR ?? 0)}R`;
    return `\`${i + 1}.\` **${t.symbol}** ${dir(t.direction)} → ${t.exitReason}  **${pnl}** | ${ts(t.closedAt)}`;
  });

  const embed = new EmbedBuilder()
    .setTitle("📜 최근 거래 내역")
    .setColor(0x6366f1)
    .setDescription(lines.join("\n"))
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

// ─── /live-toggle ────────────────────────────────────────────
export async function handleLiveToggle(interaction: ChatInputCommandInteraction): Promise<void> {
  const symbol = interaction.options.getString("symbol", true);
  const onOff  = interaction.options.getString("status", true) === "on";

  const cfg = SYMBOL_CONFIGS.find(c => c.symbol === symbol);
  if (!cfg) {
    await interaction.reply({ content: `알 수 없는 심볼: ${symbol}`, ephemeral: true });
    return;
  }

  cfg.enabled = onOff;
  await interaction.reply(`${onOff ? "🟢" : "⚫"} **${symbol}** ${onOff ? "활성화" : "비활성화"} 완료`);
}

// ─── /live-monitor ───────────────────────────────────────────
export async function handleLiveMonitor(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  const lastScan = getLastScanTime();
  const nextScan = getNextScanTime();
  const poi = getPOI().slice(0, 10);
  const log = getScanLog().slice(0, 15);

  const RESULT_LABEL: Record<string, string> = {
    signal: "✅ 신호",
    skip_position: "⏭ 포지션",
    skip_cb: "🔒 CB",
    no_signal: "— 없음",
  };

  const poiText = poi.length === 0
    ? "대기 중인 POI 없음"
    : poi.map(p =>
        `${p.grade} **${p.symbol}** ${p.direction === "bullish" ? "🟢" : "🔴"} ` +
        `점수:${p.score} | $${p.zoneLow.toFixed(2)}~${p.zoneHigh.toFixed(2)} | ${p.distancePct.toFixed(2)}% 거리`
      ).join("\n");

  const logText = log.length === 0
    ? "스캔 기록 없음"
    : log.map(e => {
        const d = e.diagnosis;
        const label = RESULT_LABEL[e.result] ?? e.result;
        const failed = d?.failedAt ? ` ← ${d.failedAt}` : "";
        const rsi = d ? ` RSI:${d.rsiValue.toFixed(1)}` : "";
        return `\`${new Date(e.scannedAt).toLocaleTimeString("ko-KR")}\` **${e.symbol}** ${label}${failed}${rsi}`;
      }).join("\n");

  const embed = new EmbedBuilder()
    .setTitle("🔍 모니터링 현황")
    .setColor(0x0ea5e9)
    .addFields(
      { name: "마지막 스캔", value: lastScan ? ts(lastScan) : "없음", inline: true },
      { name: "다음 스캔",   value: nextScan ? ts(nextScan) : "미정",  inline: true },
      { name: "활성 심볼",   value: `${SYMBOL_CONFIGS.filter(c => c.enabled).length}개`, inline: true },
      { name: `대기 POI (${poi.length}건)`, value: poiText },
      { name: `최근 스캔 로그 (${log.length}건)`, value: logText },
    )
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

// ─── /live-signal ────────────────────────────────────────────
export async function handleLiveSignal(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();
  try {
    let balance = 0;
    try { balance = await fetchAccountBalance(); } catch { balance = 10_000; }
    await runMonitor(balance, false);
    await interaction.editReply("✅ 신호 스캔 완료. Discord 알람을 확인하세요.");
  } catch (err) {
    await interaction.editReply(`❌ 스캔 오류: ${String(err)}`);
  }
}
