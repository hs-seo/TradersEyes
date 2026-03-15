/**
 * 과거 OHLCV 데이터 fetch (페이지네이션)
 * Binance API: 요청당 최대 1,000캔들
 */
import ccxt from "ccxt";
import type { Candle } from "../data/types";
import { toCcxtSymbol } from "../config";

const exchange = new ccxt.binance({ enableRateLimit: true });

const PAGE = 1000; // 요청당 캔들 수

export async function fetchHistoricalOHLCV(
  symbol: string,
  timeframe: string,
  since: number, // Unix ms
  until: number  // Unix ms (exclusive)
): Promise<Candle[]> {
  const ccxtSymbol = toCcxtSymbol(symbol);
  const result: Candle[] = [];
  let cursor = since;

  while (cursor < until) {
    const raw = await exchange.fetchOHLCV(ccxtSymbol, timeframe, cursor, PAGE);
    if (!raw || raw.length === 0) break;

    for (const [ts, o, h, l, c, v] of raw) {
      if ((ts as number) >= until) break;
      result.push({
        timestamp: ts as number,
        open: o as number,
        high: h as number,
        low: l as number,
        close: c as number,
        volume: v as number,
      });
    }

    const lastTs = raw[raw.length - 1][0] as number;
    if (raw.length < PAGE || lastTs >= until) break;

    // 다음 페이지 시작점: 마지막 타임스탬프 + 1틱
    cursor = lastTs + tfMs(timeframe);
    await new Promise((r) => setTimeout(r, 200)); // rate limit 여유
  }

  return result;
}

/** 타임프레임 문자열 → ms 변환 */
function tfMs(tf: string): number {
  const map: Record<string, number> = {
    "1m": 60_000,
    "5m": 300_000,
    "15m": 900_000,
    "1h": 3_600_000,
    "4h": 14_400_000,
    "1d": 86_400_000,
  };
  return map[tf] ?? 3_600_000;
}
