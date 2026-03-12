import { describe, it, expect } from "vitest";
import { calculateRSI } from "../indicators/rsi";

describe("calculateRSI", () => {
  it("데이터가 부족하면 전부 NaN 반환", () => {
    const rsi = calculateRSI([100, 101, 102], 14);
    expect(rsi).toHaveLength(3);
    expect(rsi.every(isNaN)).toBe(true);
  });

  it("배열 길이 = closes 길이", () => {
    const closes = Array.from({ length: 30 }, (_, i) => 100 + i);
    const rsi = calculateRSI(closes, 14);
    expect(rsi).toHaveLength(30);
  });

  it("처음 14개는 NaN, 15번째부터 유효", () => {
    const closes = Array.from({ length: 30 }, (_, i) => 100 + i);
    const rsi = calculateRSI(closes, 14);
    for (let i = 0; i < 14; i++) expect(isNaN(rsi[i])).toBe(true);
    for (let i = 14; i < 30; i++) {
      expect(isNaN(rsi[i])).toBe(false);
      expect(rsi[i]).toBeGreaterThanOrEqual(0);
      expect(rsi[i]).toBeLessThanOrEqual(100);
    }
  });

  it("지속 상승 시 RSI가 높음", () => {
    const closes = Array.from({ length: 30 }, (_, i) => 100 + i * 2);
    const rsi = calculateRSI(closes, 14);
    const lastRsi = rsi[rsi.length - 1];
    expect(lastRsi).toBeGreaterThan(70);
  });

  it("지속 하락 시 RSI가 낮음", () => {
    const closes = Array.from({ length: 30 }, (_, i) => 200 - i * 2);
    const rsi = calculateRSI(closes, 14);
    const lastRsi = rsi[rsi.length - 1];
    expect(lastRsi).toBeLessThan(30);
  });

  it("보합 시 RSI가 50 근처", () => {
    // 상승/하락 교대
    const closes = Array.from({ length: 30 }, (_, i) =>
      i % 2 === 0 ? 100 : 101
    );
    const rsi = calculateRSI(closes, 14);
    const lastRsi = rsi[rsi.length - 1];
    expect(lastRsi).toBeGreaterThan(40);
    expect(lastRsi).toBeLessThan(60);
  });
});
