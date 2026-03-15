import type { StrategyName } from "../config";

/** 라이브 신호 */
export interface LiveSignal {
  symbol: string;
  strategy: StrategyName;
  direction: "bullish" | "bearish";
  entryPrice: number;
  stop: number;
  tp1: number;
  tp2: number;
  risk: number;           // entry - stop (절댓값)
  riskPct: number;        // 계좌 대비 위험 %
  leverage: number;
  positionSizeUsdt: number; // 주문 명목 금액
  obType: string;
  score: number;
  rsi: number;
  detectedAt: number;     // timestamp (ms)
}

/** 라이브 포지션 (거래소 주문 완료 후) */
export interface LivePosition {
  id: string;             // 로컬 UUID
  symbol: string;
  strategy: StrategyName;
  direction: "bullish" | "bearish";
  entryPrice: number;
  stop: number;
  tp1: number;
  tp2: number;
  risk: number;
  riskPct?: number;       // 계좌 대비 위험 %
  leverage: number;
  positionSizeUsdt: number;
  sizeMult: number;       // CB 등 적용 배수
  openedAt: number;

  // Binance 주문 ID
  entryOrderId?: string;
  slOrderId?: string;
  tp1OrderId?: string;
  tp2OrderId?: string;

  tp1Hit: boolean;
  trailingActive: boolean;
  trailStop?: number;
  trailingExtreme?: number;

  status: "open" | "closed";
  exitPrice?: number;
  exitReason?: "sl" | "tp1-partial+tp2" | "tp1-partial+trailing" | "tp2" | "manual";
  closedAt?: number;
  pnlUsdt?: number;
  pnlR?: number;
}

/** 거래 내역 (종료된 포지션) */
export type TradeRecord = Required<Pick<LivePosition,
  "id" | "symbol" | "strategy" | "direction" |
  "entryPrice" | "exitPrice" | "stop" | "tp1" | "tp2" |
  "risk" | "leverage" | "positionSizeUsdt" |
  "openedAt" | "closedAt" | "exitReason" | "pnlUsdt" | "pnlR"
>>;

/** 라이브 상태 저장소 */
export interface LiveState {
  positions: LivePosition[];
  trades: TradeRecord[];
  circuitBreaker: Record<string, { consecLosses: number; pauseUntil: number }>;
  updatedAt: number;
}
