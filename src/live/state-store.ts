/**
 * 라이브 상태 영속화
 * data/live-state.json 에 저장/로드
 */
import fs from "fs";
import type { LiveState, LivePosition, TradeRecord } from "./types";

const STATE_PATH = "./data/live-state.json";

const EMPTY: LiveState = {
  positions: [],
  trades: [],
  circuitBreaker: {},
  updatedAt: 0,
};

export function loadState(): LiveState {
  try {
    if (!fs.existsSync(STATE_PATH)) return structuredClone(EMPTY);
    return JSON.parse(fs.readFileSync(STATE_PATH, "utf-8")) as LiveState;
  } catch {
    return structuredClone(EMPTY);
  }
}

export function saveState(state: LiveState): void {
  fs.mkdirSync("./data", { recursive: true });
  state.updatedAt = Date.now();
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

export function getOpenPositions(): LivePosition[] {
  return loadState().positions.filter(p => p.status === "open");
}

export function getOpenPosition(symbol: string): LivePosition | undefined {
  return getOpenPositions().find(p => p.symbol === symbol);
}

export function upsertPosition(pos: LivePosition): void {
  const state = loadState();
  const idx = state.positions.findIndex(p => p.id === pos.id);
  if (idx >= 0) state.positions[idx] = pos;
  else state.positions.push(pos);
  saveState(state);
}

export function closePosition(pos: LivePosition, record: TradeRecord): void {
  const state = loadState();
  const idx = state.positions.findIndex(p => p.id === pos.id);
  if (idx >= 0) state.positions[idx] = { ...pos, status: "closed" };
  state.trades.push(record);
  saveState(state);
}

export function getCBState(symbol: string) {
  const s = loadState();
  return s.circuitBreaker[symbol] ?? { consecLosses: 0, pauseUntil: 0 };
}

export function updateCBState(symbol: string, consecLosses: number, pauseUntil: number): void {
  const state = loadState();
  state.circuitBreaker[symbol] = { consecLosses, pauseUntil };
  saveState(state);
}
