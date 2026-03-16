/**
 * 인메모리 스캔 로그 + POI 캐시 (봇 재시작 시 초기화)
 */
import type { GradedOB } from "../analysis/grader";

export type ScanResult = "signal" | "skip_position" | "skip_cb" | "no_signal";

export interface ConditionDiagnosis {
  sGradeCount: number;
  chochFound: boolean;
  bestScore: number;
  rsiValue: number;
  rsiOk: boolean;
  fvgFound: boolean;
  failedAt: string | null; // 첫 탈락 조건명, null = 신호 발생
}

export interface ScanEntry {
  symbol: string;
  scannedAt: number; // ms
  result: ScanResult;
  diagnosis: ConditionDiagnosis | null;
}

export interface POIEntry {
  symbol: string;
  direction: "bullish" | "bearish";
  grade: string;
  score: number;
  zoneHigh: number;
  zoneLow: number;
  distancePct: number;
  type: string;
  reasons: string[];
  updatedAt: number; // ms
}

// ── 링버퍼 (최근 50건) ────────────────────────────────────────
const MAX_LOG = 50;
const scanLog: ScanEntry[] = [];

let lastScanTime = 0;
let nextScanTime = 0;

// ── POI 캐시 (심볼별 최신 S/A급 목록) ────────────────────────
const poiCache = new Map<string, POIEntry[]>();

// ── 스캔 로그 ────────────────────────────────────────────────
export function pushScanEntry(entry: ScanEntry): void {
  scanLog.push(entry);
  if (scanLog.length > MAX_LOG) scanLog.shift();
  if (entry.result !== "skip_position") {
    lastScanTime = entry.scannedAt;
  }
}

export function getScanLog(): ScanEntry[] {
  return [...scanLog].reverse();
}

export function getLastScanTime(): number {
  return lastScanTime;
}

export function setNextScanTime(ts: number): void {
  nextScanTime = ts;
}

export function getNextScanTime(): number {
  return nextScanTime;
}

// ── POI 캐시 ─────────────────────────────────────────────────
export function updatePOI(symbol: string, graded: GradedOB[], currentPrice: number): void {
  const entries: POIEntry[] = graded
    .filter(g => g.grade !== "B")
    .map(g => ({
      symbol,
      direction: g.ob.direction,
      grade: g.grade,
      score: g.score,
      zoneHigh: g.ob.zoneHigh,
      zoneLow: g.ob.zoneLow,
      distancePct: g.distancePct,
      type: g.ob.type,
      reasons: g.reasons,
      updatedAt: Date.now(),
    }))
    .sort((a, b) => a.distancePct - b.distancePct);

  poiCache.set(symbol, entries);
}

export function getPOI(symbol?: string): POIEntry[] {
  if (symbol) return poiCache.get(symbol) ?? [];
  const all: POIEntry[] = [];
  for (const entries of poiCache.values()) all.push(...entries);
  return all.sort((a, b) => a.distancePct - b.distancePct);
}
