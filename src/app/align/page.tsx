"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ChartUpload } from "@/components/ChartUpload";
import { MarketSelector } from "@/components/MarketSelector";
import { AnalysisResult } from "@/components/AnalysisResult";
import { Target, Plus, ChevronDown, ChevronUp, Trash2, Loader2 } from "lucide-react";
import type { AlignSession } from "@/lib/types";
import { getAlignSessions, saveAlignSession, deleteAlignSession, generateId } from "@/lib/storage";

export default function AlignPage() {
  const [sessions, setSessions] = useState<AlignSession[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [market, setMarket] = useState("BTC/USDT");
  const [timeframe, setTimeframe] = useState("1h");
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [imageMimeType, setImageMimeType] = useState<string | null>(null);
  const [userAnalysis, setUserAnalysis] = useState("");
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [step, setStep] = useState<"upload" | "user_analysis" | "compare">("upload");
  const [pendingSession, setPendingSession] = useState<Partial<AlignSession> | null>(null);

  useEffect(() => {
    setSessions(getAlignSessions());
  }, []);

  async function handleGetAiAnalysis() {
    if (!userAnalysis.trim()) return;
    setLoading(true);

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageBase64: imageBase64 ?? undefined,
          imageMimeType: imageMimeType ?? undefined,
          market,
          timeframe,
          additionalContext: `트레이더의 분석: ${userAnalysis}\n\n위 트레이더 분석과 비교하여, 독립적으로 차트를 분석하세요. 그 후 트레이더 분석과의 공통점과 차이점을 비교 설명하세요.`,
          mode: "align",
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      const session: AlignSession = {
        id: generateId(),
        createdAt: new Date().toISOString(),
        market,
        timeframe,
        imageBase64: imageBase64 ?? undefined,
        userAnalysis,
        aiAnalysis: data.analysis,
        discussionNotes: "",
      };

      saveAlignSession(session);
      setSessions(getAlignSessions());
      setPendingSession(session);
      setStep("compare");
      setShowForm(false);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  function resetForm() {
    setMarket("BTC/USDT");
    setTimeframe("1h");
    setImageBase64(null);
    setImageMimeType(null);
    setUserAnalysis("");
    setStep("upload");
    setPendingSession(null);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Target className="w-6 h-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Align 학습</h1>
            <p className="text-muted-foreground text-sm">
              같은 차트를 보고 나의 분석과 AI 분석을 비교하여 인식을 정렬합니다
            </p>
          </div>
        </div>
        <Button
          onClick={() => {
            resetForm();
            setShowForm(true);
          }}
        >
          <Plus className="w-4 h-4 mr-2" />새 세션
        </Button>
      </div>

      {/* How it works */}
      {!showForm && sessions.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="py-8">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-center">
              {[
                { step: "1", title: "차트 업로드", desc: "분석할 차트 스크린샷을 업로드합니다" },
                { step: "2", title: "나의 분석", desc: "ICT/Elliott 관점에서 나의 분석을 먼저 작성합니다" },
                { step: "3", title: "AI와 비교", desc: "AI 분석과 비교하며 인식 차이를 좁혀갑니다" },
              ].map(({ step, title, desc }) => (
                <div key={step} className="space-y-2">
                  <div className="w-8 h-8 bg-primary text-primary-foreground rounded-full flex items-center justify-center font-bold mx-auto">
                    {step}
                  </div>
                  <p className="font-semibold text-sm">{title}</p>
                  <p className="text-xs text-muted-foreground">{desc}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* New Session Form */}
      {showForm && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {step === "upload" ? "1단계: 차트 설정" : "2단계: 나의 분석 작성"}
              </CardTitle>
              <CardDescription>
                {step === "upload"
                  ? "분석할 차트를 업로드하고 시장 정보를 설정하세요"
                  : "AI 분석을 보기 전에 먼저 나의 분석을 작성하세요"}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {step === "upload" && (
                <>
                  <MarketSelector
                    market={market}
                    timeframe={timeframe}
                    onMarketChange={setMarket}
                    onTimeframeChange={setTimeframe}
                  />
                  <ChartUpload
                    onImageChange={(b64, mime) => {
                      setImageBase64(b64);
                      setImageMimeType(mime);
                    }}
                  />
                  <Button
                    onClick={() => setStep("user_analysis")}
                    className="w-full"
                  >
                    다음: 나의 분석 작성 →
                  </Button>
                </>
              )}

              {step === "user_analysis" && (
                <>
                  <div className="text-xs text-muted-foreground p-3 bg-muted/30 rounded-lg space-y-1">
                    <p className="font-semibold">분석 체크리스트:</p>
                    <p>□ HTF 추세 방향</p>
                    <p>□ BOS / CHoCH 여부</p>
                    <p>□ 주요 OB / FVG 레벨</p>
                    <p>□ 현재 Elliott Wave 위치</p>
                    <p>□ 예상 시나리오 (방향, 진입, SL, TP)</p>
                  </div>
                  <Textarea
                    placeholder="나의 분석을 자유롭게 작성하세요. AI 분석과 비교됩니다..."
                    value={userAnalysis}
                    onChange={(e) => setUserAnalysis(e.target.value)}
                    rows={10}
                    className="resize-none font-mono text-sm"
                  />
                  <div className="flex gap-2">
                    <Button
                      onClick={handleGetAiAnalysis}
                      disabled={loading || !userAnalysis.trim()}
                      className="flex-1"
                    >
                      {loading ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          AI 분석 중...
                        </>
                      ) : (
                        "AI 분석 요청 및 비교"
                      )}
                    </Button>
                    <Button variant="outline" onClick={() => setStep("upload")}>
                      이전
                    </Button>
                  </div>
                </>
              )}

              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  resetForm();
                  setShowForm(false);
                }}
                className="w-full text-muted-foreground"
              >
                취소
              </Button>
            </CardContent>
          </Card>

          {/* Preview */}
          <div>
            {imageBase64 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">차트 미리보기</CardTitle>
                </CardHeader>
                <CardContent>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`data:${imageMimeType};base64,${imageBase64}`}
                    alt="차트"
                    className="w-full rounded-lg border border-border max-h-64 object-contain"
                  />
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}

      {/* Session List */}
      {sessions.length > 0 && (
        <div className="space-y-3">
          <h2 className="font-semibold text-lg">과거 세션</h2>
          {sessions.map((session) => (
            <Card key={session.id}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{session.market}</span>
                    <Badge variant="outline">{session.timeframe}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {new Date(session.createdAt).toLocaleDateString("ko-KR")}
                    </span>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setExpandedId(expandedId === session.id ? null : session.id)
                      }
                    >
                      {expandedId === session.id ? (
                        <ChevronUp className="w-4 h-4" />
                      ) : (
                        <ChevronDown className="w-4 h-4" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        deleteAlignSession(session.id);
                        setSessions(getAlignSessions());
                      }}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>

              {expandedId === session.id && (
                <CardContent>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">
                        나의 분석
                      </p>
                      <div className="bg-muted/30 rounded-lg p-3 text-sm whitespace-pre-wrap">
                        {session.userAnalysis}
                      </div>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">
                        AI 분석
                      </p>
                      <AnalysisResult analysis={session.aiAnalysis} />
                    </div>
                  </div>
                  {session.imageBase64 && (
                    <div className="mt-4">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`data:image/png;base64,${session.imageBase64}`}
                        alt="차트"
                        className="w-full rounded-lg border border-border max-h-48 object-contain"
                      />
                    </div>
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
