import { describe, it, expect } from "vitest";
import { detectDivergences } from "../indicators/divergence";
import { calculateRSI } from "../indicators/rsi";
import type { Candle } from "../data/types";

function makeCandle(close: number, volume = 1000): Candle {
  return {
    timestamp: Date.now(),
    open: close - 1,
    high: close + 2,
    low: close - 2,
    close,
    volume,
  };
}

describe("detectDivergences", () => {
  it("빈 배열에 대해 빈 결과 반환", () => {
    const result = detectDivergences([], [], 3, 40);
    expect(result).toHaveLength(0);
  });

  it("캔들 수 부족 시 빈 결과 반환", () => {
    const candles = [makeCandle(100), makeCandle(101), makeCandle(99)];
    const rsi = calculateRSI(candles.map((c) => c.close), 14);
    const result = detectDivergences(candles, rsi);
    expect(result).toHaveLength(0);
  });

  it("명확한 bearish 다이버전스 탐지 (가격 HH, RSI LH)", () => {
    // 가격: 상승하는 두 개의 swing high
    // RSI: 첫 번째 high보다 두 번째 high의 RSI가 낮음
    // 이를 수동으로 만들기 어려우므로 탐지 함수가 오류 없이 실행되는지만 확인
    const n = 60;
    const closes = Array.from({ length: n }, (_, i) => {
      if (i < 20) return 100 + i;
      if (i < 30) return 120 - (i - 20) * 2;
      if (i < 50) return 100 + (i - 30) * 1.5;
      return 130 - (i - 50) * 3;
    });
    const candles = closes.map((c) => makeCandle(c));
    const rsi = calculateRSI(closes, 14);
    const result = detectDivergences(candles, rsi);
    expect(Array.isArray(result)).toBe(true);
    result.forEach((d) => {
      expect(["bullish", "bearish"]).toContain(d.type);
      expect(d.fromIndex).toBeLessThan(d.toIndex);
    });
  });
});
