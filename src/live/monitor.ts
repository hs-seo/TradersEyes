/**
 * 라이브 신호 모니터
 * 4H 캔들 마감마다 SHARP-GF 조건 체크 → 신호 발생 시 Discord 알람 + 자동매매
 */
import { fetchHistoricalOHLCV } from "../backtest/fetcher";
import { detectSignalWithDiagnosis } from "./strategy";
import { getOpenPositions, getOpenPosition, getCBState } from "./state-store";
import { SYMBOL_CONFIGS, MAX_TOTAL_POSITIONS } from "../config";
import { sendSignalAlert, sendErrorAlert } from "./discord-alert";
import { openPosition } from "./trader";
import { pushScanEntry } from "./scan-log";
import type { LiveSignal } from "./types";

const DATA_WARMUP_MS = 220 * 4 * 60 * 60 * 1000; // 220 × 4H

export async function runMonitor(accountUsdt: number, autoTrade = false): Promise<void> {
  const enabledConfigs = SYMBOL_CONFIGS.filter(c => c.enabled);
  if (enabledConfigs.length === 0) {
    console.log("[Monitor] 활성화된 심볼 없음");
    return;
  }

  const openPositions = getOpenPositions();
  const openCount = openPositions.length;

  console.log(`[Monitor] 신호 스캔 시작 (활성심볼:${enabledConfigs.length}개, 열린포지션:${openCount}/${MAX_TOTAL_POSITIONS})`);

  const now = Date.now();
  const dataFrom = now - DATA_WARMUP_MS;

  const signals: LiveSignal[] = [];

  for (const cfg of enabledConfigs) {
    try {
      // 이미 해당 심볼 포지션 있으면 스킵
      if (getOpenPosition(cfg.symbol)) {
        console.log(`  [${cfg.symbol}] 포지션 보유 중 → 스킵`);
        pushScanEntry({ symbol: cfg.symbol, scannedAt: now, result: "skip_position", diagnosis: null });
        continue;
      }

      // 서킷브레이커 체크
      const cb = getCBState(cfg.symbol);
      if ((cfg.strategy === "SHARP-G" || cfg.strategy === "SHARP-GF") && Date.now() < cb.pauseUntil) {
        console.log(`  [${cfg.symbol}] 서킷브레이커 → 스킵`);
        pushScanEntry({ symbol: cfg.symbol, scannedAt: now, result: "skip_cb", diagnosis: null });
        continue;
      }

      // 데이터 로드
      const [c4h, c1h, c15m] = await Promise.all([
        fetchHistoricalOHLCV(cfg.symbol, "4h",  dataFrom, now),
        fetchHistoricalOHLCV(cfg.symbol, "1h",  dataFrom, now),
        fetchHistoricalOHLCV(cfg.symbol, "15m", dataFrom, now),
      ]);

      const { signal, diagnosis } = detectSignalWithDiagnosis(c4h, c1h, c15m, cfg, accountUsdt, cb.pauseUntil);

      if (signal) {
        console.log(`  [${cfg.symbol}] ✅ 신호 감지! ${signal.direction} score:${signal.score} RSI:${signal.rsi.toFixed(1)}`);
        pushScanEntry({ symbol: cfg.symbol, scannedAt: now, result: "signal", diagnosis });
        signals.push(signal);
      } else {
        console.log(`  [${cfg.symbol}] 신호 없음 (탈락: ${diagnosis.failedAt ?? "-"})`);
        pushScanEntry({ symbol: cfg.symbol, scannedAt: now, result: "no_signal", diagnosis });
      }
    } catch (err) {
      console.error(`  [${cfg.symbol}] 오류:`, err);
      await sendErrorAlert(`[Monitor] ${cfg.symbol} 오류: ${String(err)}`);
    }
  }

  // 최대 포지션 수 제한 적용
  const availableSlots = MAX_TOTAL_POSITIONS - openCount;
  const toProcess = signals.slice(0, availableSlots);

  for (const signal of toProcess) {
    // Discord 알람
    await sendSignalAlert(signal);

    // 자동매매 (활성화된 경우)
    if (autoTrade) {
      await openPosition(signal);
    }
  }

  if (signals.length > availableSlots) {
    console.log(`[Monitor] 포지션 한도(${MAX_TOTAL_POSITIONS}) 도달 → ${signals.length - availableSlots}개 신호 스킵`);
  }

  console.log(`[Monitor] 스캔 완료 (신호:${signals.length}개, 처리:${toProcess.length}개)`);
}
