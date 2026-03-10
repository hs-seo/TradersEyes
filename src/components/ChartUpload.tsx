"use client";

import { useRef, useState } from "react";
import { Upload, X, Image as ImageIcon } from "lucide-react";

interface ChartUploadProps {
  onImageChange: (base64: string | null, mimeType: string | null) => void;
}

export function ChartUpload({ onImageChange }: ChartUploadProps) {
  const [preview, setPreview] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function processFile(file: File) {
    if (!file.type.startsWith("image/")) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      // result is "data:image/png;base64,XXXX"
      const base64 = result.split(",")[1];
      setPreview(result);
      onImageChange(base64, file.type);
    };
    reader.readAsDataURL(file);
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  }

  function handlePaste(e: React.ClipboardEvent) {
    const item = Array.from(e.clipboardData.items).find((i) =>
      i.type.startsWith("image/")
    );
    if (item) {
      const file = item.getAsFile();
      if (file) processFile(file);
    }
  }

  function clearImage() {
    setPreview(null);
    onImageChange(null, null);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div onPaste={handlePaste}>
      {preview ? (
        <div className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={preview}
            alt="차트 미리보기"
            className="w-full rounded-lg border border-border object-contain max-h-96"
          />
          <button
            onClick={clearImage}
            className="absolute top-2 right-2 bg-destructive text-destructive-foreground rounded-full p-1 hover:opacity-80"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <div
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
            isDragging
              ? "border-primary bg-primary/5"
              : "border-border hover:border-primary/50 hover:bg-muted/30"
          }`}
        >
          <div className="flex flex-col items-center gap-3 text-muted-foreground">
            <div className="flex gap-2">
              <Upload className="w-8 h-8" />
              <ImageIcon className="w-8 h-8" />
            </div>
            <div>
              <p className="font-medium text-foreground">차트 스크린샷 업로드</p>
              <p className="text-sm mt-1">
                드래그 앤 드롭, 클릭하여 선택, 또는 <kbd className="px-1 py-0.5 bg-muted rounded text-xs">Ctrl+V</kbd> 붙여넣기
              </p>
              <p className="text-xs mt-1">PNG, JPG, WEBP 지원</p>
            </div>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileInput}
          />
        </div>
      )}
    </div>
  );
}
