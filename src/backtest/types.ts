export type ExitReason = "sl" | "trailing" | "tp1-partial+trailing" | "tp2" | "tp1-partial+tp2" | "end-of-data";

export interface BacktestPosition {
  id: string;
  symbol: string;
  direction: "bullish" | "bearish";
  obType: string;
  obCreatedAt: number; // OB 형성 타임스탬프 (쿨다운용)
  entryPrice: number;
  entryTime: number;
  stop: number;
  tp1: number;
  tp2: number;
  risk: number;

  status: "open" | "closed";
  exitPrice?: number;
  exitTime?: number;
  exitReason?: ExitReason;

  // TP1 부분 청산 (50%)
  tp1Hit: boolean;
  tp1LockedR: number; // TP1 도달 시 확정된 R (50% 기준)

  // Trailing state (TP1 이후 나머지 50%)
  trailingActive: boolean;
  trailingExtreme: number; // 롱: 이후 최고가 / 숏: 이후 최저가
  trailStop?: number;

  sizeMult: number;  // 포지션 사이징 배수 (연속손실 기반)
  pnlR?: number;     // 최종 blended PnL × sizeMult
}

export interface SymbolResult {
  symbol: string;
  trades: BacktestPosition[];
  totalTrades: number;
  wins: number;      // pnlR > 0
  losses: number;    // pnlR <= 0
  winRate: number;
  totalPnlR: number;
  avgWinR: number;
  avgLossR: number;
  expectancy: number; // 트레이드당 기댓값 (R)
  maxDrawdownR: number;
  byExitReason: Record<ExitReason, number>; // 청산 사유별 건수
}

export interface BacktestReport {
  startDate: string;
  endDate: string;
  symbols: SymbolResult[];
  overall: {
    totalTrades: number;
    wins: number;
    losses: number;
    winRate: number;
    totalPnlR: number;
    expectancy: number;
  };
}
