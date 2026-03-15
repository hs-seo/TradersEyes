/**
 * Binance Futures 자동거래 클라이언트
 * BINANCE_DEMO=true  → testnet.binancefuture.com (demo.binance.com 키)
 * BINANCE_DEMO=false → fapi.binance.com (실계좌)
 */
import crypto from "crypto";
import https from "https";
import { v4 as uuidv4 } from "uuid";
import type { LiveSignal, LivePosition, TradeRecord } from "./types";
import { upsertPosition, closePosition, getCBState, updateCBState } from "./state-store";
import { sendPositionOpenAlert, sendPositionCloseAlert, sendErrorAlert } from "./discord-alert";

const IS_DEMO  = process.env.BINANCE_DEMO !== "false";
const BASE_URL = IS_DEMO
  ? "https://testnet.binancefuture.com"
  : "https://fapi.binance.com";

const API_KEY = process.env.BINANCE_API_KEY ?? "";
const SECRET  = process.env.BINANCE_SECRET  ?? "";

// ── 서명 헬퍼 ───────────────────────────────────────────────
function sign(query: string): string {
  return crypto.createHmac("sha256", SECRET).update(query).digest("hex");
}

function buildQuery(params: Record<string, string | number>): string {
  const ts = Date.now();
  const base = Object.entries({ ...params, timestamp: ts })
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  return `${base}&signature=${sign(base)}`;
}

// ── HTTP 요청 ────────────────────────────────────────────────
async function request<T>(
  method: "GET" | "POST" | "DELETE",
  path: string,
  params: Record<string, string | number> = {},
  auth = true
): Promise<T> {
  const query = auth ? buildQuery(params) : new URLSearchParams(params as any).toString();
  const url   = method === "GET" || method === "DELETE"
    ? `${BASE_URL}${path}?${query}`
    : `${BASE_URL}${path}`;
  const body  = method === "POST" ? query : undefined;

  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
  if (auth) headers["X-MBX-APIKEY"] = API_KEY;

  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path:     urlObj.pathname + urlObj.search,
      method,
      headers,
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          if (json?.code && json.code < 0) {
            reject(new Error(`Binance ${json.code}: ${json.msg}`));
          } else {
            resolve(json as T);
          }
        } catch {
          reject(new Error(`JSON 파싱 실패: ${data.slice(0, 100)}`));
        }
      });
    });

    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

// ── 심볼 정밀도 캐시 ─────────────────────────────────────────
const precisionCache: Record<string, { qty: number; price: number }> = {};

async function getPrecision(symbol: string): Promise<{ qty: number; price: number }> {
  if (precisionCache[symbol]) return precisionCache[symbol];

  const info = await request<any>("GET", "/fapi/v1/exchangeInfo", {}, false);
  for (const s of info.symbols ?? []) {
    const qtyFilter   = s.filters?.find((f: any) => f.filterType === "LOT_SIZE");
    const priceFilter = s.filters?.find((f: any) => f.filterType === "PRICE_FILTER");
    const qtyStep     = qtyFilter?.stepSize   ?? "0.001";
    const priceStep   = priceFilter?.tickSize ?? "0.1";
    precisionCache[s.symbol] = {
      qty:   Math.max(0, -Math.floor(Math.log10(parseFloat(qtyStep)))),
      price: Math.max(0, -Math.floor(Math.log10(parseFloat(priceStep)))),
    };
  }
  return precisionCache[symbol] ?? { qty: 3, price: 2 };
}

function round(value: number, decimals: number): number {
  return Math.floor(value * 10 ** decimals) / 10 ** decimals;
}

// ── 공개 API ─────────────────────────────────────────────────

/** 계좌 USDT 잔고 조회 */
export async function fetchAccountBalance(): Promise<number> {
  const res = await request<any[]>("GET", "/fapi/v2/balance");
  const usdt = res.find((a: any) => a.asset === "USDT");
  return parseFloat(usdt?.availableBalance ?? "0");
}

// ── 거래 API ─────────────────────────────────────────────────

/** 포지션 진입 */
export async function openPosition(signal: LiveSignal): Promise<void> {
  try {
    const side    = signal.direction === "bullish" ? "BUY" : "SELL";
    const slSide  = side === "BUY" ? "SELL" : "BUY";
    const { qty: qtyDec, price: priceDec } = await getPrecision(signal.symbol);

    const qty = round(signal.positionSizeUsdt / signal.entryPrice, qtyDec);
    if (qty <= 0) throw new Error(`수량 계산 오류: qty=${qty}`);

    // 레버리지 설정
    await request("POST", "/fapi/v1/leverage", {
      symbol:   signal.symbol,
      leverage: signal.leverage,
    });

    // 진입 주문 (Market)
    const entryOrder = await request<any>("POST", "/fapi/v1/order", {
      symbol:   signal.symbol,
      side,
      type:     "MARKET",
      quantity: qty,
    });

    // SL 주문 (실패 시 position-manager 가격 모니터링으로 대체)
    let slOrderId: string | undefined;
    try {
      const slOrder = await request<any>("POST", "/fapi/v1/order", {
        symbol:      signal.symbol,
        side:        slSide,
        type:        "STOP_MARKET",
        stopPrice:   round(signal.stop, priceDec),
        quantity:    qty,
        reduceOnly:  "true",
        workingType: "CONTRACT_PRICE",
      });
      slOrderId = String(slOrder.orderId);
    } catch (e) {
      console.warn(`[Trader] ${signal.symbol} SL 주문 실패 (position-manager로 대체): ${String(e)}`);
    }

    // TP2 주문
    let tp2OrderId: string | undefined;
    try {
      const tpOrder = await request<any>("POST", "/fapi/v1/order", {
        symbol:      signal.symbol,
        side:        slSide,
        type:        "TAKE_PROFIT_MARKET",
        stopPrice:   round(signal.tp2, priceDec),
        quantity:    qty,
        reduceOnly:  "true",
        workingType: "CONTRACT_PRICE",
      });
      tp2OrderId = String(tpOrder.orderId);
    } catch (e) {
      console.warn(`[Trader] ${signal.symbol} TP2 주문 실패 (position-manager로 대체): ${String(e)}`);
    }

    const pos: LivePosition = {
      id:               uuidv4(),
      symbol:           signal.symbol,
      strategy:         signal.strategy,
      direction:        signal.direction,
      entryPrice:       signal.entryPrice,
      stop:             signal.stop,
      tp1:              signal.tp1,
      tp2:              signal.tp2,
      risk:             signal.risk,
      riskPct:          signal.riskPct,
      leverage:         signal.leverage,
      positionSizeUsdt: signal.positionSizeUsdt,
      sizeMult:         1,
      openedAt:         Date.now(),
      entryOrderId:     String(entryOrder.orderId),
      slOrderId:        slOrderId,
      tp2OrderId:       tp2OrderId,
      tp1Hit:           false,
      trailingActive:   false,
      status:           "open",
    };

    upsertPosition(pos);
    await sendPositionOpenAlert(pos);
    console.log(`[Trader] ${signal.symbol} 진입 완료 qty=${qty} SL=${slOrderId ?? "미등록"} TP2=${tp2OrderId ?? "미등록"}`);
  } catch (err) {
    await sendErrorAlert(`[Trader] ${signal.symbol} 진입 실패: ${String(err)}`);
    throw err;
  }
}

async function cancelOrder(symbol: string, orderId: string): Promise<void> {
  await request("DELETE", "/fapi/v1/order", { symbol, orderId }).catch(() => {});
}

/** TP1 도달 → 50% 부분 청산 + 트레일링 전환 */
export async function handleTP1(pos: LivePosition, currentPrice: number, atr1h: number): Promise<void> {
  try {
    const side = pos.direction === "bullish" ? "SELL" : "BUY";
    const { qty: qtyDec, price: priceDec } = await getPrecision(pos.symbol);

    if (pos.slOrderId)  await cancelOrder(pos.symbol, pos.slOrderId);
    if (pos.tp2OrderId) await cancelOrder(pos.symbol, pos.tp2OrderId);

    const halfQty = round((pos.positionSizeUsdt / pos.entryPrice) * 0.5, qtyDec);

    await request("POST", "/fapi/v1/order", {
      symbol:     pos.symbol,
      side,
      type:       "MARKET",
      quantity:   halfQty,
      reduceOnly: "true",
    });

    const trailStop = pos.direction === "bullish"
      ? currentPrice - atr1h * 1.5
      : currentPrice + atr1h * 1.5;

    const newSlOrder = await request<any>("POST", "/fapi/v1/order", {
      symbol:      pos.symbol,
      side,
      type:        "STOP_MARKET",
      stopPrice:   round(trailStop, priceDec),
      quantity:    halfQty,
      reduceOnly:  "true",
    });

    upsertPosition({
      ...pos,
      tp1Hit:          true,
      trailingActive:  true,
      trailStop,
      trailingExtreme: currentPrice,
      slOrderId:       String(newSlOrder.orderId),
      tp2OrderId:      undefined,
    });

    console.log(`[Trader] ${pos.symbol} TP1 → 50% 청산, 트레일링 활성`);
  } catch (err) {
    await sendErrorAlert(`[Trader] ${pos.symbol} TP1 처리 실패: ${String(err)}`);
  }
}

/** 트레일링 스탑 업데이트 */
export async function updateTrailStop(pos: LivePosition, currentPrice: number, atr1h: number): Promise<void> {
  if (!pos.trailingActive) return;

  const newExtreme = pos.direction === "bullish"
    ? Math.max(pos.trailingExtreme ?? currentPrice, currentPrice)
    : Math.min(pos.trailingExtreme ?? currentPrice, currentPrice);

  const newTrailStop = pos.direction === "bullish"
    ? Math.max(pos.trailStop ?? pos.stop, newExtreme - atr1h * 1.5)
    : Math.min(pos.trailStop ?? pos.stop, newExtreme + atr1h * 1.5);

  if (newTrailStop === pos.trailStop) return;

  try {
    const side = pos.direction === "bullish" ? "SELL" : "BUY";
    const { qty: qtyDec, price: priceDec } = await getPrecision(pos.symbol);

    if (pos.slOrderId) await cancelOrder(pos.symbol, pos.slOrderId);

    const halfQty = round((pos.positionSizeUsdt / pos.entryPrice) * 0.5, qtyDec);

    const newSl = await request<any>("POST", "/fapi/v1/order", {
      symbol:      pos.symbol,
      side,
      type:        "STOP_MARKET",
      stopPrice:   round(newTrailStop, priceDec),
      quantity:    halfQty,
      reduceOnly:  "true",
    });

    upsertPosition({ ...pos, trailStop: newTrailStop, trailingExtreme: newExtreme, slOrderId: String(newSl.orderId) });
  } catch (err) {
    console.error(`[Trader] ${pos.symbol} 트레일링 업데이트 실패:`, err);
  }
}

/** 포지션 종료 처리 */
export async function handlePositionClose(
  pos: LivePosition,
  exitPrice: number,
  exitReason: TradeRecord["exitReason"]
): Promise<void> {
  const remainRatio = pos.tp1Hit ? 0.5 : 1.0;
  const pnlPerUnit  = pos.direction === "bullish"
    ? exitPrice - pos.entryPrice
    : pos.entryPrice - exitPrice;

  const tp1LockedR = pos.tp1Hit ? ((pos.tp1 - pos.entryPrice) / pos.risk * 0.5) : 0;
  const remainR    = (pnlPerUnit / pos.risk) * remainRatio;
  const pnlR       = tp1LockedR + remainR;
  const pnlUsdt    = pnlR * (pos.positionSizeUsdt / pos.leverage) * (pos.riskPct ?? 1) / 100;

  const record: TradeRecord = {
    id:               pos.id,
    symbol:           pos.symbol,
    strategy:         pos.strategy,
    direction:        pos.direction,
    entryPrice:       pos.entryPrice,
    exitPrice,
    stop:             pos.stop,
    tp1:              pos.tp1,
    tp2:              pos.tp2,
    risk:             pos.risk,
    leverage:         pos.leverage,
    positionSizeUsdt: pos.positionSizeUsdt,
    openedAt:         pos.openedAt,
    closedAt:         Date.now(),
    exitReason,
    pnlUsdt:          Math.round(pnlUsdt * 100) / 100,
    pnlR:             Math.round(pnlR * 100) / 100,
  };

  closePosition({ ...pos, status: "closed", exitPrice, exitReason, closedAt: record.closedAt }, record);

  const cb = getCBState(pos.symbol);
  const newConsec = pnlR <= 0 ? cb.consecLosses + 1 : 0;
  const pause = (pos.strategy === "SHARP-GF" || pos.strategy === "SHARP-G") && newConsec >= 3
    ? Date.now() + 4 * 4 * 60 * 60 * 1000
    : cb.pauseUntil;
  updateCBState(pos.symbol, newConsec >= 3 ? 0 : newConsec, pause);

  await sendPositionCloseAlert(record);
  console.log(`[Trader] ${pos.symbol} 종료: ${exitReason} PnL:${record.pnlR}R ($${record.pnlUsdt})`);
}
