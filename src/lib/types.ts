export type Market =
  | "BTC/USDT"
  | "ETH/USDT"
  | "SOL/USDT"
  | "NQ"
  | "ES"
  | "CL"
  | "GC"
  | "EUR/USD"
  | "GBP/USD"
  | "USD/JPY"
  | "custom";

export type Timeframe =
  | "1m"
  | "3m"
  | "5m"
  | "15m"
  | "30m"
  | "1h"
  | "4h"
  | "1D"
  | "1W";

export interface AnalysisRequest {
  imageBase64?: string;
  imageMimeType?: string;
  market: string;
  timeframe: string;
  additionalContext?: string;
  mode: "realtime" | "journal" | "align";
}

export interface AnalysisResponse {
  analysis: string;
  error?: string;
}

export interface JournalEntry {
  id: string;
  createdAt: string;
  market: string;
  timeframe: string;
  direction: "long" | "short";
  entryPrice: string;
  exitPrice: string;
  stopLoss: string;
  takeProfit: string;
  pnl: string;
  pnlPercent: string;
  imageBase64?: string;
  notes: string;
  aiReview?: string;
  tags: string[];
}

export interface AlignSession {
  id: string;
  createdAt: string;
  market: string;
  timeframe: string;
  imageBase64?: string;
  userAnalysis: string;
  aiAnalysis: string;
  discussionNotes: string;
  alignScore?: number;
}
