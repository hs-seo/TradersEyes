"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { useState } from "react";

const MARKETS = [
  { group: "Crypto", items: ["BTC/USDT", "ETH/USDT", "SOL/USDT", "BNB/USDT", "XRP/USDT"] },
  { group: "Futures", items: ["NQ (나스닥)", "ES (S&P500)", "CL (원유)", "GC (금)", "6E (유로FX)"] },
  { group: "Forex", items: ["EUR/USD", "GBP/USD", "USD/JPY", "AUD/USD", "USD/CAD"] },
];

const TIMEFRAMES = [
  { label: "1분", value: "1m" },
  { label: "3분", value: "3m" },
  { label: "5분", value: "5m" },
  { label: "15분", value: "15m" },
  { label: "30분", value: "30m" },
  { label: "1시간", value: "1h" },
  { label: "4시간", value: "4h" },
  { label: "일봉", value: "1D" },
  { label: "주봉", value: "1W" },
];

interface MarketSelectorProps {
  market: string;
  timeframe: string;
  onMarketChange: (v: string) => void;
  onTimeframeChange: (v: string) => void;
}

export function MarketSelector({
  market,
  timeframe,
  onMarketChange,
  onTimeframeChange,
}: MarketSelectorProps) {
  const [customMarket, setCustomMarket] = useState("");

  const isCustom = market === "custom";

  return (
    <div className="flex gap-2 flex-wrap">
      <div className="flex-1 min-w-40">
        <Select
          value={isCustom ? "custom" : market}
          onValueChange={(v: string | null) => {
            if (!v) return;
            if (v === "custom") {
              onMarketChange("custom");
            } else {
              onMarketChange(v);
            }
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder="시장 선택" />
          </SelectTrigger>
          <SelectContent>
            {MARKETS.map((group) => (
              <div key={group.group}>
                <div className="px-2 py-1 text-xs font-semibold text-muted-foreground">
                  {group.group}
                </div>
                {group.items.map((item) => (
                  <SelectItem key={item} value={item}>
                    {item}
                  </SelectItem>
                ))}
              </div>
            ))}
            <SelectItem value="custom">직접 입력...</SelectItem>
          </SelectContent>
        </Select>
        {isCustom && (
          <Input
            className="mt-1"
            placeholder="예: AAPL, KOSPI200..."
            value={customMarket}
            onChange={(e) => {
              setCustomMarket(e.target.value);
              onMarketChange(e.target.value);
            }}
          />
        )}
      </div>

      <div className="w-32">
        <Select value={timeframe} onValueChange={(v: string | null) => { if (v) onTimeframeChange(v); }}>
          <SelectTrigger>
            <SelectValue placeholder="타임프레임" />
          </SelectTrigger>
          <SelectContent>
            {TIMEFRAMES.map((tf) => (
              <SelectItem key={tf.value} value={tf.value}>
                {tf.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
