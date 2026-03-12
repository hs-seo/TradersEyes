import { spawnSync } from "child_process";
import * as fs from "fs";
import type { OrderBlock } from "../engine/types";
import type { Candle } from "../data/types";
import { CODEX_BIN } from "../config";

/**
 * Codex CLI를 사용한 OB 보조 평가
 * hourly-analysis.ts의 패턴 재사용 (spawnSync + stdout 파싱)
 */
export function evaluateWithLLM(
  symbol: string,
  obs: OrderBlock[],
  recentCandles: Candle[]
): string {
  if (!fs.existsSync(CODEX_BIN)) {
    console.warn(`[LLM] Codex CLI 없음: ${CODEX_BIN}`);
    return "";
  }

  const obSummary = obs
    .slice(0, 5)
    .map(
      (ob, i) =>
        `${i + 1}. [${ob.direction.toUpperCase()} ${ob.type}] ` +
        `zone: ${ob.zoneLow.toFixed(2)}~${ob.zoneHigh.toFixed(2)}, ` +
        `confidence: ${ob.confidenceScore}, ` +
        `RSI: ${ob.rsiAtFormation.toFixed(1)}` +
        (ob.inRsiExtreme ? " (extreme)" : "") +
        (ob.hasDivergence ? " +divergence" : "")
    )
    .join("\n");

  const candleSummary = recentCandles
    .slice(-10)
    .map(
      (c) =>
        `  [${new Date(c.timestamp).toISOString().slice(0, 16)}] ` +
        `O:${c.open.toFixed(2)} H:${c.high.toFixed(2)} L:${c.low.toFixed(2)} C:${c.close.toFixed(2)} V:${c.volume.toFixed(0)}`
    )
    .join("\n");

  const prompt = `다음은 ${symbol} 4H 차트에서 탐지된 OB(Order Block) 목록입니다:

${obSummary || "탐지된 OB 없음"}

최근 OHLCV (4H, 최근 10개):
${candleSummary}

위 데이터를 기반으로 다음을 한국어로 간략히 평가해주세요:
1. 가장 주목할 OB와 그 이유
2. 현재 시장 상황과 OB 유효성
3. 진입 시 주의사항

5줄 이내로 핵심만 답해줘.`;

  try {
    const result = spawnSync(CODEX_BIN, ["exec"], {
      input: prompt,
      encoding: "utf-8",
      timeout: 120_000,
    });

    if (result.status !== 0 || !result.stdout) {
      console.warn("[LLM] Codex 실행 실패:", result.stderr?.slice(0, 200));
      return "";
    }

    const raw = result.stdout as string;
    const lines = raw.split("\n");
    const codexIdx = lines.lastIndexOf("codex");
    const tokensIdx = lines.findIndex(
      (l, i) => i > codexIdx && l.startsWith("tokens used")
    );

    if (codexIdx !== -1) {
      const end = tokensIdx !== -1 ? tokensIdx : lines.length;
      return lines.slice(codexIdx + 1, end).join("\n").trim();
    }

    return raw.trim();
  } catch (err) {
    console.warn("[LLM] 오류:", err);
    return "";
  }
}
