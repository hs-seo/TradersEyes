import ccxt from "ccxt";
import type { Candle } from "./types";
import { toCcxtSymbol, FETCH_LIMIT } from "../config";

const exchange = new ccxt.binance({ enableRateLimit: true });

export async function fetchOHLCV(
  symbol: string,
  timeframe: string,
  limit = FETCH_LIMIT
): Promise<Candle[]> {
  const ccxtSymbol = toCcxtSymbol(symbol);
  const raw = await exchange.fetchOHLCV(ccxtSymbol, timeframe, undefined, limit);
  return raw.map(([ts, o, h, l, c, v]) => ({
    timestamp: ts as number,
    open: o as number,
    high: h as number,
    low: l as number,
    close: c as number,
    volume: v as number,
  }));
}
