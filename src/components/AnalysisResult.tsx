"use client";

import { Copy, Check } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

interface AnalysisResultProps {
  analysis: string;
}

export function AnalysisResult({ analysis }: AnalysisResultProps) {
  const [copied, setCopied] = useState(false);

  async function copyToClipboard() {
    await navigator.clipboard.writeText(analysis);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // Simple markdown-like renderer
  const renderLine = (line: string, idx: number) => {
    if (line.startsWith("## ")) {
      return (
        <h2 key={idx} className="text-lg font-bold text-foreground mt-6 mb-2 border-b border-border pb-1">
          {line.replace("## ", "")}
        </h2>
      );
    }
    if (line.startsWith("### ")) {
      return (
        <h3 key={idx} className="text-base font-semibold text-foreground mt-4 mb-1">
          {line.replace("### ", "")}
        </h3>
      );
    }
    if (line.startsWith("**") && line.endsWith("**")) {
      return (
        <p key={idx} className="font-semibold text-foreground">
          {line.replace(/\*\*/g, "")}
        </p>
      );
    }
    if (line.startsWith("- ") || line.startsWith("* ")) {
      const content = line.replace(/^[-*] /, "");
      return (
        <li key={idx} className="text-muted-foreground ml-4 list-disc">
          {renderInline(content)}
        </li>
      );
    }
    if (line.match(/^\d+\. /)) {
      return (
        <li key={idx} className="text-muted-foreground ml-4 list-decimal">
          {renderInline(line.replace(/^\d+\. /, ""))}
        </li>
      );
    }
    if (line.trim() === "") {
      return <div key={idx} className="h-2" />;
    }
    return (
      <p key={idx} className="text-muted-foreground">
        {renderInline(line)}
      </p>
    );
  };

  function renderInline(text: string) {
    // Bold: **text**
    const parts = text.split(/(\*\*[^*]+\*\*)/g);
    return parts.map((part, i) => {
      if (part.startsWith("**") && part.endsWith("**")) {
        return <strong key={i} className="font-semibold text-foreground">{part.slice(2, -2)}</strong>;
      }
      return part;
    });
  }

  const lines = analysis.split("\n");

  return (
    <div className="relative">
      <div className="absolute top-2 right-2">
        <Button variant="ghost" size="sm" onClick={copyToClipboard}>
          {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
        </Button>
      </div>
      <div className="bg-muted/30 rounded-lg p-4 pr-12 space-y-1 text-sm leading-relaxed">
        {lines.map((line, idx) => renderLine(line, idx))}
      </div>
    </div>
  );
}
