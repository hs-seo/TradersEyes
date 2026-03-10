"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ChartUpload } from "@/components/ChartUpload";
import { MarketSelector } from "@/components/MarketSelector";
import { AnalysisResult } from "@/components/AnalysisResult";
import { Loader2, TrendingUp, Zap } from "lucide-react";

export default function RealtimeAnalysisPage() {
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [imageMimeType, setImageMimeType] = useState<string | null>(null);
  const [market, setMarket] = useState("BTC/USDT");
  const [timeframe, setTimeframe] = useState("1h");
  const [context, setContext] = useState("");
  const [analysis, setAnalysis] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function runAnalysis() {
    setLoading(true);
    setError("");
    setAnalysis("");

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageBase64: imageBase64 ?? undefined,
          imageMimeType: imageMimeType ?? undefined,
          market,
          timeframe,
          additionalContext: context,
          mode: "realtime",
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "분석 실패");
      setAnalysis(data.analysis);
    } catch (e) {
      setError(e instanceof Error ? e.message : "오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <TrendingUp className="w-6 h-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">실시간 차트 분석</h1>
          <p className="text-muted-foreground text-sm">
            ICT SMC + Elliott Wave 관점에서 현재 시장 구조를 분석합니다
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Input Section */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">차트 설정</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <MarketSelector
                market={market}
                timeframe={timeframe}
                onMarketChange={setMarket}
                onTimeframeChange={setTimeframe}
              />

              <div className="flex flex-wrap gap-2">
                <p className="text-xs text-muted-foreground w-full">빠른 타임프레임 선택:</p>
                {["5m", "15m", "1h", "4h", "1D"].map((tf) => (
                  <Badge
                    key={tf}
                    variant={timeframe === tf ? "default" : "outline"}
                    className="cursor-pointer"
                    onClick={() => setTimeframe(tf)}
                  >
                    {tf}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">차트 이미지</CardTitle>
              <CardDescription>
                TradingView 스크린샷을 업로드하면 시각적 분석이 추가됩니다
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ChartUpload
                onImageChange={(base64, mime) => {
                  setImageBase64(base64);
                  setImageMimeType(mime);
                }}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">추가 컨텍스트 (선택)</CardTitle>
              <CardDescription>
                현재 관찰 중인 사항, 의문점, 또는 특별히 분석받고 싶은 부분을 입력하세요
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Textarea
                placeholder="예: 4시간봉에서 BOS가 발생한 것 같은데, 현재 15분봉에서 진입 타이밍을 찾고 있습니다. Wave 3가 진행 중인지 조정인지 판단이 어렵습니다..."
                value={context}
                onChange={(e) => setContext(e.target.value)}
                rows={4}
                className="resize-none"
              />
            </CardContent>
          </Card>

          <Button
            onClick={runAnalysis}
            disabled={loading}
            className="w-full"
            size="lg"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                분석 중...
              </>
            ) : (
              <>
                <Zap className="w-4 h-4 mr-2" />
                ICT + Elliott 분석 시작
              </>
            )}
          </Button>

          {error && (
            <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-sm text-destructive">
              {error}
            </div>
          )}
        </div>

        {/* Result Section */}
        <div>
          {analysis ? (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  분석 결과
                  <Badge variant="secondary">{market} · {timeframe}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <AnalysisResult analysis={analysis} />
              </CardContent>
            </Card>
          ) : (
            <Card className="h-full min-h-80">
              <CardContent className="h-full flex items-center justify-center text-muted-foreground">
                <div className="text-center space-y-2">
                  <TrendingUp className="w-12 h-12 mx-auto opacity-20" />
                  <p>분석 결과가 여기에 표시됩니다</p>
                  <p className="text-xs">차트 이미지를 업로드하고 분석을 시작하세요</p>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
