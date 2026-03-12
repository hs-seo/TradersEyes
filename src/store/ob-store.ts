import * as fs from "fs";
import * as path from "path";
import type { OrderBlock } from "../engine/types";
import { OB_STORE_PATH } from "../config";
import type { Candle } from "../data/types";

interface StoreData {
  updatedAt: number;
  orderBlocks: OrderBlock[];
}

function loadStore(): StoreData {
  const absPath = path.resolve(OB_STORE_PATH);
  if (!fs.existsSync(absPath)) {
    return { updatedAt: 0, orderBlocks: [] };
  }
  try {
    return JSON.parse(fs.readFileSync(absPath, "utf-8")) as StoreData;
  } catch {
    return { updatedAt: 0, orderBlocks: [] };
  }
}

function saveStore(data: StoreData): void {
  const absPath = path.resolve(OB_STORE_PATH);
  const dir = path.dirname(absPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(absPath, JSON.stringify(data, null, 2), "utf-8");
}

/**
 * detector.ts 결과로 해당 심볼 OB를 교체 저장
 *
 * detector가 매번 300캔들 전체를 재분석하므로 병합이 아닌 교체가 올바름.
 * 병합 시 cron 실행마다 중복 누적 문제 발생.
 */
export function mergeAndSave(
  newObs: OrderBlock[],
  _latestCandle: Candle,
  symbol: string
): OrderBlock[] {
  const store = loadStore();

  // 타 심볼 OB는 유지, 현재 심볼은 신규 탐지 결과로 교체
  const others = store.orderBlocks.filter((ob) => ob.symbol !== symbol);
  const merged = [...others, ...newObs];

  saveStore({ updatedAt: Date.now(), orderBlocks: merged });

  return newObs;
}

/** 심볼별 활성 OB 조회 */
export function getActiveOBs(symbol?: string): OrderBlock[] {
  const store = loadStore();
  return store.orderBlocks.filter(
    (ob) =>
      (symbol ? ob.symbol === symbol : true) &&
      (ob.status === "active" || ob.status === "touched")
  );
}
