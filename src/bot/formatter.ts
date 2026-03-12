import { EmbedBuilder, APIEmbed } from "discord.js";
import type { AnalysisResult } from "../analysis/analyzer";
import type { OrderBlock } from "../engine/types";
import type { GradedOB } from "../analysis/grader";
import type { TradeSetup } from "../analysis/multi-timeframe";

// ── 공통 ──────────────────────────────────────────────
const TYPE_LABEL: Record<string, string> = {
  "trend-continuation": "추세횡보",
  "range-breakout":     "횡보돌파",
  "reversal-point":     "변곡점",
};

function fp(p: number): string {
  return p >= 100 ? p.toFixed(2) : p.toFixed(4);
}

function gradeEmoji(grade: string): string {
  return grade === "S" ? "🚨" : grade === "A" ? "📌" : "⬜";
}

function dirEmoji(dir: string): string {
  return dir === "bullish" ? "🟢 롱" : "🔴 숏";
}

// ── S급 자동 알림 ─────────────────────────────────────
/**
 * S급 OB 발생 시 Discord 자동 알림 embed
 * 간결하게 — 진입 자리 + SL + TP1/TP2 핵심만
 */
export function formatSAlert(
  symbol: string,
  sGrades: GradedOB[],
  result: AnalysisResult
): APIEmbed[] {
  const kst = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  }).format(new Date(result.analyzedAt));

  return sGrades.map((g) => {
    const { ob, score, reasons, latestBreak, distancePct } = g;
    const dir = ob.direction;
    const color = dir === "bullish" ? 0x00e676 : 0xff1744;

    // 해당 OB의 TradeSetup 찾기
    const setup = result.mtfSignals.find((s) => s.ob.id === ob.id);

    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(`🚨 S급 진입 자리 — ${symbol} ${dirEmoji(dir)}`)
      .setDescription(
        `**${TYPE_LABEL[ob.type] ?? ob.type}** [${ob.timeframe.toUpperCase()}] | Score: **${score}pts**\n` +
        reasons.map((r) => `• ${r}`).join("\n")
      )
      .addFields(
        {
          name: "📍 OB Zone",
          value: `\`${fp(ob.zoneLow)} ~ ${fp(ob.zoneHigh)}\`  (현재가에서 **${distancePct.toFixed(2)}%**)`,
          inline: false,
        },
        ...(latestBreak ? [{
          name: `📐 ${latestBreak.type} 확인`,
          value: `${latestBreak.direction === "bullish" ? "상승" : "하락"} 전환 | Level: \`${fp(latestBreak.level)}\``,
          inline: false,
        }] : []),
        ...(setup ? [{
          name: "💰 진입 설계",
          value:
            `진입: \`${fp(setup.entry)}\`  |  SL: \`${fp(setup.stop)}\`\n` +
            `TP1: \`${fp(setup.tp1)}\` (RR ${setup.rr1.toFixed(1)}:1)  |  TP2: \`${fp(setup.tp2)}\` (RR ${setup.rr2.toFixed(1)}:1)`,
          inline: false,
        }] : [])
      )
      .setFooter({ text: `TradersEyes #check_ob | ${kst} KST` });

    return embed.toJSON();
  });
}

// ── /analyze 응답 ─────────────────────────────────────
/**
 * /analyze 슬래시 커맨드 응답
 * 등급별로 분류: S/A/B + 진입 설계 포함
 */
export function formatOBResults(result: AnalysisResult): APIEmbed[] {
  const { symbol, gradedOBs, mtfSignals, analyzedAt } = result;

  const kst = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  }).format(new Date(analyzedAt));

  const sGrade = gradedOBs.filter((g) => g.grade === "S");
  const aGrade = gradedOBs.filter((g) => g.grade === "A");

  const hasBull = gradedOBs.some((g) => g.ob.direction === "bullish");
  const hasBear = gradedOBs.some((g) => g.ob.direction === "bearish");
  const color = hasBull && !hasBear ? 0x00cc66 : !hasBull && hasBear ? 0xff4444 : 0xf0a500;

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`📊 ${symbol} OB 분석 | ${fp(result.currentPrice)}`)
    .setFooter({ text: `TradersEyes #check_ob | ${kst} KST` });

  // S급
  if (sGrade.length > 0) {
    embed.addFields({ name: "🚨 S급 — 즉시 대응", value: "\u200b", inline: false });
    sGrade.forEach((g) => embed.addFields(obField(g, mtfSignals)));
  }

  // A급 (POI)
  if (aGrade.length > 0) {
    embed.addFields({ name: "📌 A급 — POI 대기", value: "\u200b", inline: false });
    aGrade.slice(0, 4).forEach((g) => embed.addFields(obField(g, mtfSignals)));
  }

  // 진입 근접 설계 (isNearEntry)
  const nearSetups = mtfSignals.filter((s) => s.isNearEntry).slice(0, 2);
  if (nearSetups.length > 0) {
    embed.addFields({ name: "🔔 근접 진입 설계", value: "\u200b", inline: false });
    nearSetups.forEach((s) => embed.addFields(setupField(s)));
  }

  return [embed.toJSON()];
}

function obField(g: GradedOB, setups: TradeSetup[]): { name: string; value: string; inline: boolean } {
  const { ob, grade, score, distancePct, reasons, latestBreak } = g;
  const setup = setups.find((s) => s.ob.id === ob.id);
  const statusTag = ob.status === "touched" ? "🎯 터치" : "✅ 활성";
  const breakTag = latestBreak ? ` | **${latestBreak.type}** ` : "";
  const setupLine = setup
    ? `\n진입 \`${fp(setup.entry)}\` SL \`${fp(setup.stop)}\` TP1 \`${fp(setup.tp1)}\``
    : "";

  return {
    name: `${gradeEmoji(grade)} ${dirEmoji(ob.direction)} [${ob.timeframe.toUpperCase()}] ${TYPE_LABEL[ob.type] ?? ob.type}  ${statusTag}`,
    value:
      `Zone: \`${fp(ob.zoneLow)} ~ ${fp(ob.zoneHigh)}\`  (${distancePct.toFixed(1)}%)  Score: **${score}**${breakTag}\n` +
      reasons.join(" · ") + setupLine,
    inline: false,
  };
}

function setupField(s: TradeSetup): { name: string; value: string; inline: boolean } {
  const sigLabel = s.entrySignalType
    ? ({ engulfing: "장악형", pinbar: "핀바", "break-of-structure": "BOS" })[s.entrySignalType] ?? ""
    : "시그널 대기";
  return {
    name: `${dirEmoji(s.direction)} [${s.ob.timeframe.toUpperCase()}] ${sigLabel}`,
    value:
      `진입 \`${fp(s.entry)}\`  SL \`${fp(s.stop)}\`\n` +
      `TP1 \`${fp(s.tp1)}\` (RR ${s.rr1.toFixed(1)}:1)  TP2 \`${fp(s.tp2)}\` (RR ${s.rr2.toFixed(1)}:1)`,
    inline: false,
  };
}

// ── /poi 응답 ─────────────────────────────────────────
/**
 * /poi — 전체 심볼 POI 현황 (A급 이상만, 거리순 정렬)
 */
export function formatPOI(results: AnalysisResult[]): APIEmbed {
  const lines: string[] = [];

  for (const r of results) {
    const aUp = r.gradedOBs.filter((g) => g.grade !== "B").slice(0, 2);
    if (aUp.length === 0) continue;
    lines.push(`**${r.symbol}** (현재가: ${fp(r.currentPrice)})`);
    aUp.forEach((g) => {
      const icon = g.grade === "S" ? "🚨" : "📌";
      const dir = g.ob.direction === "bullish" ? "롱" : "숏";
      lines.push(
        `  ${icon} ${dir} \`${fp(g.ob.zoneLow)}~${fp(g.ob.zoneHigh)}\`  ${g.distancePct.toFixed(1)}%  [${g.ob.timeframe.toUpperCase()}]`
      );
    });
  }

  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("📌 전체 심볼 POI 현황 (A급 이상)")
    .setDescription(lines.join("\n") || "현재 A급 이상 POI 없음")
    .setTimestamp()
    .setFooter({ text: "TradersEyes #check_ob — /analyze <symbol> 로 상세 조회" })
    .toJSON();
}

// ── /alert 응답 ─────────────────────────────────────
/**
 * /alert — 현재 S급 자리 목록
 */
export function formatAlertList(results: AnalysisResult[]): APIEmbed {
  const lines: string[] = [];

  for (const r of results) {
    const sGrades = r.gradedOBs.filter((g) => g.grade === "S");
    sGrades.forEach((g) => {
      const dir = g.ob.direction === "bullish" ? "🟢 롱" : "🔴 숏";
      const bk = g.latestBreak ? ` **${g.latestBreak.type}**` : "";
      lines.push(
        `**${r.symbol}** ${dir} \`${fp(g.ob.zoneLow)}~${fp(g.ob.zoneHigh)}\`  ${g.distancePct.toFixed(1)}% ${bk}`
      );
    });
  }

  return new EmbedBuilder()
    .setColor(0xff1744)
    .setTitle("🚨 현재 S급 진입 자리")
    .setDescription(lines.join("\n") || "현재 S급 자리 없음")
    .setTimestamp()
    .setFooter({ text: "TradersEyes #check_ob" })
    .toJSON();
}

// ── /status 응답 (기존 유지) ─────────────────────────
export function formatStatusSummary(
  results: Array<{ symbol: string; activeCount: number; nearCount: number }>
): APIEmbed {
  const lines = results.map(
    (r) =>
      `\`${r.symbol.padEnd(8)}\` 활성 OB: **${r.activeCount}** | 근접: **${r.nearCount}**`
  );
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("📋 전체 심볼 OB 현황")
    .setDescription(lines.join("\n") || "데이터 없음")
    .setTimestamp()
    .setFooter({ text: "TradersEyes #check_ob" })
    .toJSON();
}
