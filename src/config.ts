import "dotenv/config";

export const SYMBOLS = [
  "BTCUSDT",
  "ETHUSDT",
  "SOLUSDT",
  "XRPUSDT",
  "TRXUSDT",
  "DOGEUSDT",
  "ADAUSDT",
] as const;

export type SymbolName = (typeof SYMBOLS)[number];

/** "BTCUSDT" → "BTC/USDT" */
export function toCcxtSymbol(symbol: string): string {
  if (symbol.endsWith("USDT")) {
    return `${symbol.slice(0, -4)}/USDT`;
  }
  return symbol;
}

export const TIMEFRAMES = {
  primary: "4h",
  entry: "15m",
} as const;

export const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN ?? "";
export const DISCORD_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID ?? "";
export const DISCORD_APPLICATION_ID = process.env.DISCORD_APPLICATION_ID ?? "";
export const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID ?? "";

export const CODEX_BIN = "/opt/homebrew/bin/codex";
export const OB_STORE_PATH = "./data/ob-store.json";

export const RSI_PERIOD = 14;
export const RSI_EXTREME_HIGH = 75;
export const RSI_EXTREME_LOW = 25;

export const FETCH_LIMIT = 300;
