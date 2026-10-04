"use client";

import { Loader2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { cn } from "@/lib/utils";

export function ResumeDropzone({
  onFile,
  busy,
  label = "Drop your resume here, or click to choose a file",
  compact = false,
}: {
  onFile: (file: File) => void;
  busy?: boolean;
  label?: string;
  compact?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => !busy && input.current?.click()}
      onKeyDown={(e) => e.key === "Enter" && !busy && input.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const file = e.dataTransfer.files[0];
        if (file && !busy) onFile(file);
      }}
      className={cn(
        "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed text-sm text-muted-foreground transition-colors hover:bg-muted/50",
        compact ? "p-4" : "p-12",
        over && "border-primary bg-muted/50",
        busy && "cursor-wait opacity-70",
      )}
    >
      {busy ? <Loader2 className="size-6 animate-spin" /> : <Upload className="size-6" />}
      <span>{busy ? "Reading and structuring your resume…" : label}</span>
      <span className="text-xs">PDF or DOCX, up to 10 MB</span>
      <input
        ref={input}
        type="file"
        accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}
