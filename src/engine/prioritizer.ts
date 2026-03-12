import type { OrderBlock } from "./types";

const TYPE_SCORE: Record<string, number> = {
  "trend-continuation": 3,
  "range-breakout": 2,
  "reversal-point": 2,
};

/**
 * OB 우선순위 정렬
 *
 * 1. RSI 과열 + 다이버전스 조합 최우선
 * 2. trend-continuation (조건1)
 * 3. range-breakout / reversal-point
 * 4. confidenceScore 내림차순
 */
export function prioritize(obs: OrderBlock[]): OrderBlock[] {
  return [...obs].sort((a, b) => {
    // RSI 극한 + 다이버전스 우선
    const aTop = a.inRsiExtreme && a.hasDivergence ? 1 : 0;
    const bTop = b.inRsiExtreme && b.hasDivergence ? 1 : 0;
    if (bTop !== aTop) return bTop - aTop;

    // type 점수
    const aType = TYPE_SCORE[a.type] ?? 0;
    const bType = TYPE_SCORE[b.type] ?? 0;
    if (bType !== aType) return bType - aType;

    // confidence
    return b.confidenceScore - a.confidenceScore;
  });
}
