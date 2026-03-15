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
export type StrategyName = "SHARP-F" | "SHARP-G" | "SHARP-GF";

/** 심볼별 라이브 운용 설정 */
export interface SymbolConfig {
  symbol: SymbolName;
  enabled: boolean;       // 라이브 신호 활성화
  strategy: StrategyName;
  riskPct: number;        // 1R = 계좌 자본의 N% (기본 1)
  leverage: number;       // 선물 레버리지 (기본 10)
}

/**
 * 심볼별 기본 설정
 * SHARP-GF 성과 기준:
 *   BTC +15.16R ✅  ADA +3.38R ✅  XRP +1.02R ✅  → GF 우선
 *   ETH +0.51R 🛡   DOGE +8.67R 🛡 → G 사용 (FVG 역방향)
 *   SOL -3.00R ❌   TRX -0.46R ⚠  → 비활성화 기본
 */
export const SYMBOL_CONFIGS: SymbolConfig[] = [
  { symbol: "BTCUSDT",  enabled: true,  strategy: "SHARP-GF", riskPct: 1, leverage: 10 },
  { symbol: "ADAUSDT",  enabled: true,  strategy: "SHARP-GF", riskPct: 1, leverage: 10 },
  { symbol: "XRPUSDT",  enabled: true,  strategy: "SHARP-GF", riskPct: 1, leverage: 10 },
  { symbol: "ETHUSDT",  enabled: false, strategy: "SHARP-G",  riskPct: 1, leverage: 10 },
  { symbol: "DOGEUSDT", enabled: false, strategy: "SHARP-G",  riskPct: 1, leverage: 10 },
  { symbol: "TRXUSDT",  enabled: false, strategy: "SHARP-GF", riskPct: 1, leverage: 10 },
  { symbol: "SOLUSDT",  enabled: false, strategy: "SHARP-G",  riskPct: 1, leverage: 10 },
];

export function getSymbolConfig(symbol: string): SymbolConfig | undefined {
  return SYMBOL_CONFIGS.find(c => c.symbol === symbol);
}

/** 전체 동시 최대 포지션 수 (= 최대 riskPct×N% 노출) */
export const MAX_TOTAL_POSITIONS = 3;

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
