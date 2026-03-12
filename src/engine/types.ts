export type OBType = "trend-continuation" | "range-breakout" | "reversal-point";
export type OBStatus = "forming" | "active" | "touched" | "invalidated";

export interface OrderBlock {
  id: string;
  symbol: string;
  timeframe: string;
  type: OBType;
  direction: "bullish" | "bearish";
  zoneHigh: number;
  zoneLow: number;
  status: OBStatus;
  rsiAtFormation: number;
  inRsiExtreme: boolean;
  hasDivergence: boolean;
  confidenceScore: number;
  createdAt: number;           // 형성 캔들 타임스탬프 (Unix ms)
  formationCandleIndex: number; // 탐지 배열 내 인덱스
}
