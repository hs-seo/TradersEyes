"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ChartUpload } from "@/components/ChartUpload";
import { MarketSelector } from "@/components/MarketSelector";
import { AnalysisResult } from "@/components/AnalysisResult";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BookOpen, Plus, Trash2, Loader2, ChevronDown, ChevronUp } from "lucide-react";
import type { JournalEntry } from "@/lib/types";
import { getJournalEntries, saveJournalEntry, deleteJournalEntry, generateId } from "@/lib/storage";
import { buildJournalReviewPrompt } from "@/lib/prompts";

function emptyEntry(): Omit<JournalEntry, "id" | "createdAt"> {
  return {
    market: "BTC/USDT",
    timeframe: "1h",
    direction: "long",
    entryPrice: "",
    exitPrice: "",
    stopLoss: "",
    takeProfit: "",
    pnl: "",
    pnlPercent: "",
    notes: "",
    tags: [],
  };
}

export default function JournalPage() {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyEntry());
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [imageMimeType, setImageMimeType] = useState<string | null>(null);
  const [loadingReview, setLoadingReview] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    setEntries(getJournalEntries());
  }, []);

  function handleSave() {
    if (!form.entryPrice || !form.exitPrice) return;
    const entry: JournalEntry = {
      ...form,
      id: generateId(),
      createdAt: new Date().toISOString(),
      imageBase64: imageBase64 ?? undefined,
    };
    saveJournalEntry(entry);
    setEntries(getJournalEntries());
    setForm(emptyEntry());
    setImageBase64(null);
    setImageMimeType(null);
    setShowForm(false);
  }

  async function requestReview(entry: JournalEntry) {
    setLoadingReview(entry.id);
    try {
      const prompt = buildJournalReviewPrompt(
        entry.market,
        entry.timeframe,
        entry.entryPrice,
        entry.exitPrice,
        entry.direction,
        entry.pnl,
        entry.notes
      );

      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageBase64: entry.imageBase64,
          imageMimeType: entry.imageBase64 ? "image/png" : undefined,
          market: entry.market,
          timeframe: entry.timeframe,
          additionalContext: prompt,
          mode: "journal",
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      const updated = { ...entry, aiReview: data.analysis };
      saveJournalEntry(updated);
      setEntries(getJournalEntries());
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingReview(null);
    }
  }

  function handleDelete(id: string) {
    deleteJournalEntry(id);
    setEntries(getJournalEntries());
  }

  const pnlColor = (pnl: string) => {
    const n = parseFloat(pnl);
    if (isNaN(n)) return "";
    return n >= 0 ? "text-green-500" : "text-red-500";
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <BookOpen className="w-6 h-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">트레이딩 저널</h1>
            <p className="text-muted-foreground text-sm">
              거래를 기록하고 ICT/Elliott 관점의 AI 복기를 받으세요
            </p>
          </div>
        </div>
        <Button onClick={() => setShowForm(!showForm)}>
          <Plus className="w-4 h-4 mr-2" />
          거래 추가
        </Button>
      </div>

      {/* New Entry Form */}
      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">새 거래 기록</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <MarketSelector
              market={form.market}
              timeframe={form.timeframe}
              onMarketChange={(v) => setForm({ ...form, market: v })}
              onTimeframeChange={(v) => setForm({ ...form, timeframe: v })}
            />

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">방향</label>
                <Select
                  value={form.direction}
                  onValueChange={(v) => setForm({ ...form, direction: v as "long" | "short" })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="long">롱 (매수)</SelectItem>
                    <SelectItem value="short">숏 (매도)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">손익 ($)</label>
                <Input
                  placeholder="예: +250 또는 -80"
                  value={form.pnl}
                  onChange={(e) => setForm({ ...form, pnl: e.target.value })}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">진입가</label>
                <Input
                  placeholder="진입 가격"
                  value={form.entryPrice}
                  onChange={(e) => setForm({ ...form, entryPrice: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">청산가</label>
                <Input
                  placeholder="청산 가격"
                  value={form.exitPrice}
                  onChange={(e) => setForm({ ...form, exitPrice: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Stop Loss</label>
                <Input
                  placeholder="SL 가격"
                  value={form.stopLoss}
                  onChange={(e) => setForm({ ...form, stopLoss: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Take Profit</label>
                <Input
                  placeholder="TP 가격"
                  value={form.takeProfit}
                  onChange={(e) => setForm({ ...form, takeProfit: e.target.value })}
                />
              </div>
            </div>

            <div>
              <label className="text-xs text-muted-foreground mb-1 block">차트 스크린샷</label>
              <ChartUpload
                onImageChange={(b64, mime) => {
                  setImageBase64(b64);
                  setImageMimeType(mime);
                }}
              />
            </div>

            <div>
              <label className="text-xs text-muted-foreground mb-1 block">메모</label>
              <Textarea
                placeholder="진입 근거, 실수, 감정 등을 기록하세요..."
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                rows={3}
                className="resize-none"
              />
            </div>

            <div className="flex gap-2">
              <Button onClick={handleSave} disabled={!form.entryPrice || !form.exitPrice}>
                저장
              </Button>
              <Button variant="outline" onClick={() => setShowForm(false)}>
                취소
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Entry List */}
      {entries.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <BookOpen className="w-12 h-12 mx-auto opacity-20 mb-3" />
            <p>아직 기록된 거래가 없습니다</p>
            <p className="text-xs mt-1">첫 번째 거래를 기록해보세요</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {entries.map((entry) => (
            <Card key={entry.id}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant={entry.direction === "long" ? "default" : "destructive"}>
                      {entry.direction === "long" ? "롱" : "숏"}
                    </Badge>
                    <span className="font-semibold">{entry.market}</span>
                    <Badge variant="outline">{entry.timeframe}</Badge>
                    <span className={`font-mono font-bold ${pnlColor(entry.pnl)}`}>
                      {entry.pnl ? (parseFloat(entry.pnl) >= 0 ? "+" : "") + entry.pnl : "-"}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(entry.createdAt).toLocaleDateString("ko-KR")}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
                    >
                      {expandedId === entry.id ? (
                        <ChevronUp className="w-4 h-4" />
                      ) : (
                        <ChevronDown className="w-4 h-4" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(entry.id)}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
                <div className="flex gap-4 text-xs text-muted-foreground">
                  <span>진입: {entry.entryPrice}</span>
                  <span>청산: {entry.exitPrice}</span>
                  {entry.stopLoss && <span>SL: {entry.stopLoss}</span>}
                </div>
              </CardHeader>

              {expandedId === entry.id && (
                <CardContent className="space-y-4">
                  {entry.imageBase64 && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`data:image/png;base64,${entry.imageBase64}`}
                      alt="차트"
                      className="w-full rounded-lg border border-border max-h-64 object-contain"
                    />
                  )}
                  {entry.notes && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">메모</p>
                      <p className="text-sm">{entry.notes}</p>
                    </div>
                  )}

                  {entry.aiReview ? (
                    <div>
                      <p className="text-xs text-muted-foreground mb-2">AI 복기</p>
                      <AnalysisResult analysis={entry.aiReview} />
                    </div>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => requestReview(entry)}
                      disabled={loadingReview === entry.id}
                    >
                      {loadingReview === entry.id ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          복기 분석 중...
                        </>
                      ) : (
                        "ICT/Elliott 복기 분석 요청"
                      )}
                    </Button>
                  )}
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
