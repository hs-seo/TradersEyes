import { createCanvas } from "@napi-rs/canvas";
import type { Candle } from "../data/types";
import type { OrderBlock } from "../engine/types";

// ── 레이아웃 ──────────────────────────────────────────
const W = 1400;
const CHART_H = 580;
const RSI_H = 140;
const GAP = 10;
const TOTAL_H = CHART_H + GAP + RSI_H;

const M = { top: 30, right: 90, bottom: 30, left: 10 };

const DISPLAY = 100; // 최근 N캔들 표시

// ── 색상 ─────────────────────────────────────────────
const BG = "#131722";
const GRID = "#1e2535";
const BULL = "#26a69a";
const BEAR = "#ef5350";
const OB_BULL_FILL = "rgba(0, 204, 102, 0.20)";
const OB_BULL_LINE = "rgba(0, 204, 102, 0.80)";
const OB_BEAR_FILL = "rgba(255, 68, 68, 0.20)";
const OB_BEAR_LINE = "rgba(255, 68, 68, 0.80)";
const TEXT_COLOR = "#9598a1";
const RSI_LINE = "#f0a500";
const RSI_OB = "rgba(239, 83, 80, 0.25)";
const RSI_OS = "rgba(38, 166, 154, 0.25)";

const TYPE_SHORT: Record<string, string> = {
  "trend-continuation": "TC",
  "range-breakout": "RB",
  "reversal-point": "RP",
};

export function generateChart(
  symbol: string,
  candles: Candle[],
  obs: OrderBlock[],
  rsi: number[]
): Buffer {
  const display = candles.slice(-DISPLAY);
  const rsiDisplay = rsi.slice(-DISPLAY);
  const n = display.length;

  const canvas = createCanvas(W, TOTAL_H);
  const ctx = canvas.getContext("2d");

  const cw = W - M.left - M.right; // 차트 유효 폭
  const slotW = cw / n;
  const candleW = Math.max(2, Math.floor(slotW * 0.7));

  // ── 가격 범위 (active OB 존 포함, 캔들 range 이내만) ─
  const maxP = Math.max(...display.map((c) => c.high));
  const minP = Math.min(...display.map((c) => c.low));
  const candleRange = maxP - minP;

  const visibleObs = obs.filter(
    (ob) => ob.status === "active" || ob.status === "touched"
  );
  // 현재 캔들 범위에서 1배 이내 거리 OB만 Y축에 포함
  const obPrices = visibleObs
    .flatMap((ob) => [ob.zoneHigh, ob.zoneLow])
    .filter((p) => p >= minP - candleRange && p <= maxP + candleRange);
  const allHi = obPrices.length ? Math.max(maxP, ...obPrices) : maxP;
  const allLo = obPrices.length ? Math.min(minP, ...obPrices) : minP;

  const pad = (allHi - allLo) * 0.06;
  const hi = allHi + pad;
  const lo = allLo - pad;

  const chartTop = M.top;
  const chartBot = CHART_H - M.bottom;

  function xOf(i: number) {
    return M.left + i * slotW + slotW / 2;
  }
  function yOf(price: number) {
    return chartTop + ((hi - price) / (hi - lo)) * (chartBot - chartTop);
  }

  // ── RSI 범위 ─────────────────────────────────────
  const rsiTop = CHART_H + GAP + 10;
  const rsiBot = CHART_H + GAP + RSI_H - 20;

  function yRsi(v: number) {
    return rsiTop + ((100 - v) / 100) * (rsiBot - rsiTop);
  }

  // ──────────────────────────────────────────────────
  //  1. 배경
  // ──────────────────────────────────────────────────
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, TOTAL_H);

  // ── 구분선 ────────────────────────────────────────
  ctx.strokeStyle = GRID;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(M.left, CHART_H + GAP / 2);
  ctx.lineTo(W - M.right, CHART_H + GAP / 2);
  ctx.stroke();

  // ──────────────────────────────────────────────────
  //  2. 가격 그리드 + 라벨
  // ──────────────────────────────────────────────────
  const gridLevels = 6;
  ctx.font = "11px monospace";
  ctx.fillStyle = TEXT_COLOR;
  ctx.textAlign = "left";

  for (let g = 0; g <= gridLevels; g++) {
    const price = lo + ((hi - lo) * g) / gridLevels;
    const y = yOf(price);
    ctx.strokeStyle = GRID;
    ctx.lineWidth = 0.5;
    ctx.setLineDash([3, 5]);
    ctx.beginPath();
    ctx.moveTo(M.left, y);
    ctx.lineTo(W - M.right, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillText(formatPrice(price), W - M.right + 4, y + 4);
  }

  // ──────────────────────────────────────────────────
  //  3. OB 존 — 형성 캔들 시작점부터 우측 끝까지
  // ──────────────────────────────────────────────────
  const activeObs = visibleObs;

  for (const ob of activeObs) {
    const y1 = yOf(ob.zoneHigh);
    const y2 = yOf(ob.zoneLow);
    const h = Math.max(2, y2 - y1);

    // 형성 타임스탬프로 display 내 위치 찾기
    // 표시 범위 이전에 형성된 OB → 왼쪽 끝부터 표시 (수직선 없이)
    let dispIdx = display.findIndex((c) => c.timestamp >= ob.createdAt);
    if (dispIdx < 0) dispIdx = 0;

    const startX = xOf(dispIdx);
    const rectW = W - M.right - startX;
    if (rectW <= 0) continue;

    // 채우기
    ctx.fillStyle =
      ob.direction === "bullish" ? OB_BULL_FILL : OB_BEAR_FILL;
    ctx.fillRect(startX, y1, rectW, h);

    // 위/아래 선 (형성 캔들부터)
    ctx.strokeStyle =
      ob.direction === "bullish" ? OB_BULL_LINE : OB_BEAR_LINE;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(startX, y1);
    ctx.lineTo(W - M.right, y1);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(startX, y2);
    ctx.lineTo(W - M.right, y2);
    ctx.stroke();
    ctx.setLineDash([]);

    // 형성 캔들 시작 수직선 (실선)
    if (dispIdx > 0) {
      ctx.strokeStyle =
        ob.direction === "bullish" ? OB_BULL_LINE : OB_BEAR_LINE;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(startX, y1);
      ctx.lineTo(startX, y2);
      ctx.stroke();
    }

    // 오른쪽 라벨
    const label =
      `${ob.direction === "bullish" ? "▲" : "▼"}${TYPE_SHORT[ob.type] ?? ob.type}` +
      ` ${formatPrice(ob.zoneHigh)}` +
      (ob.inRsiExtreme ? "⚡" : "") +
      (ob.hasDivergence ? "D" : "") +
      (ob.status === "touched" ? " ✓" : "");

    ctx.font = "10px monospace";
    ctx.fillStyle =
      ob.direction === "bullish" ? OB_BULL_LINE : OB_BEAR_LINE;
    ctx.textAlign = "left";
    ctx.fillText(label, W - M.right + 4, y1 - 2);
  }

  // ──────────────────────────────────────────────────
  //  4. 캔들스틱
  // ──────────────────────────────────────────────────
  for (let i = 0; i < n; i++) {
    const c = display[i];
    const x = xOf(i);
    const bull = c.close >= c.open;
    const color = bull ? BULL : BEAR;

    // 심지
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, yOf(c.high));
    ctx.lineTo(x, yOf(c.low));
    ctx.stroke();

    // 몸통
    const bTop = yOf(Math.max(c.open, c.close));
    const bBot = yOf(Math.min(c.open, c.close));
    const bH = Math.max(1, bBot - bTop);
    ctx.fillStyle = color;
    ctx.fillRect(x - candleW / 2, bTop, candleW, bH);
  }

  // ──────────────────────────────────────────────────
  //  5. 현재 시각 수직선
  // ──────────────────────────────────────────────────
  const nowX = xOf(n - 1) + slotW / 2; // 마지막 캔들 오른쪽 끝
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 4]);
  ctx.beginPath();
  ctx.moveTo(nowX, chartTop);
  ctx.lineTo(nowX, chartBot);
  ctx.stroke();
  ctx.setLineDash([]);

  // "현재" 레이블
  const KST = 9 * 60 * 60 * 1000;
  const nowKst = new Date(Date.now() + KST);
  const nowLabel =
    `${String(nowKst.getUTCMonth() + 1).padStart(2, "0")}/` +
    `${String(nowKst.getUTCDate()).padStart(2, "0")} ` +
    `${String(nowKst.getUTCHours()).padStart(2, "0")}:` +
    `${String(nowKst.getUTCMinutes()).padStart(2, "0")} KST`;
  ctx.font = "10px monospace";
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  ctx.textAlign = "right";
  ctx.fillText(`▶ ${nowLabel}`, nowX - 4, chartTop + 14);

  // ──────────────────────────────────────────────────
  //  6. 시간축 라벨
  // ──────────────────────────────────────────────────
  ctx.font = "10px monospace";
  ctx.fillStyle = TEXT_COLOR;
  ctx.textAlign = "center";
  const labelStep = Math.floor(n / 8);
  for (let i = 0; i < n; i += labelStep) {
    const d = new Date(display[i].timestamp + KST); // UTC → KST
    const label =
      `${String(d.getUTCMonth() + 1).padStart(2, "0")}/` +
      `${String(d.getUTCDate()).padStart(2, "0")} ` +
      `${String(d.getUTCHours()).padStart(2, "0")}:00`;
    ctx.fillText(label, xOf(i), CHART_H - 5);
  }

  // ──────────────────────────────────────────────────
  //  6. RSI 패널
  // ──────────────────────────────────────────────────

  // 과열/과매도 배경
  ctx.fillStyle = RSI_OB;
  ctx.fillRect(M.left, yRsi(100), cw, yRsi(75) - yRsi(100));
  ctx.fillStyle = RSI_OS;
  ctx.fillRect(M.left, yRsi(25), cw, yRsi(0) - yRsi(25));

  // 기준선 (75, 50, 25)
  for (const lvl of [75, 50, 25]) {
    ctx.strokeStyle = GRID;
    ctx.lineWidth = 0.8;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(M.left, yRsi(lvl));
    ctx.lineTo(W - M.right, yRsi(lvl));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = "10px monospace";
    ctx.fillStyle = TEXT_COLOR;
    ctx.textAlign = "left";
    ctx.fillText(String(lvl), W - M.right + 4, yRsi(lvl) + 4);
  }

  // RSI 선
  ctx.strokeStyle = RSI_LINE;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  let first = true;
  for (let i = 0; i < n; i++) {
    const v = rsiDisplay[i];
    if (isNaN(v)) continue;
    const x = xOf(i);
    const y = yRsi(v);
    if (first) {
      ctx.moveTo(x, y);
      first = false;
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.stroke();

  // RSI 라벨
  ctx.font = "11px monospace";
  ctx.fillStyle = TEXT_COLOR;
  ctx.textAlign = "left";
  ctx.fillText("RSI(14)", M.left + 4, rsiTop + 14);

  // ──────────────────────────────────────────────────
  //  7. 타이틀
  // ──────────────────────────────────────────────────
  const kst = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date());

  ctx.font = "bold 15px monospace";
  ctx.fillStyle = "#d1d4dc";
  ctx.textAlign = "left";
  ctx.fillText(
    `${symbol} · 4H  |  OB ${activeObs.length}개  |  ${kst} KST`,
    M.left + 8,
    18
  );

  return canvas.toBuffer("image/png");
}

function formatPrice(p: number): string {
  return p >= 1000 ? p.toFixed(1) : p >= 1 ? p.toFixed(3) : p.toFixed(5);
}
