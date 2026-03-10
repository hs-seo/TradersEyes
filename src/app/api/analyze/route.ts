import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { buildAnalysisPrompt } from "@/lib/prompts";
import type { AnalysisRequest } from "@/lib/types";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export async function POST(req: NextRequest) {
  try {
    const body: AnalysisRequest = await req.json();
    const { imageBase64, imageMimeType, market, timeframe, additionalContext, mode } = body;

    if (!market || !timeframe) {
      return NextResponse.json({ error: "시장과 타임프레임을 입력해주세요." }, { status: 400 });
    }

    const prompt = buildAnalysisPrompt({ market, timeframe, additionalContext, mode });

    type MessageParam = Anthropic.Messages.MessageParam;
    const messages: MessageParam[] = [];

    if (imageBase64 && imageMimeType) {
      const validMimeTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
      type ImageMediaType = typeof validMimeTypes[number];

      if (!validMimeTypes.includes(imageMimeType as ImageMediaType)) {
        return NextResponse.json({ error: "지원하지 않는 이미지 형식입니다. (JPEG, PNG, GIF, WEBP 지원)" }, { status: 400 });
      }

      messages.push({
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: imageMimeType as ImageMediaType,
              data: imageBase64,
            },
          },
          {
            type: "text",
            text: prompt,
          },
        ],
      });
    } else {
      messages.push({
        role: "user",
        content: prompt + "\n\n(차트 이미지가 제공되지 않았습니다. 텍스트 정보만으로 분석합니다.)",
      });
    }

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      messages,
    });

    const analysisText = response.content
      .filter((block) => block.type === "text")
      .map((block) => (block as { type: "text"; text: string }).text)
      .join("\n");

    return NextResponse.json({ analysis: analysisText });
  } catch (error) {
    console.error("Analysis error:", error);
    const message = error instanceof Error ? error.message : "분석 중 오류가 발생했습니다.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
