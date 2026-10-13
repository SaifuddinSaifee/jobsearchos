"use client";

import { Loader2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { cn } from "@/lib/utils";

export function ResumeDropzone({
  onFile,
  busy,
  label = "Drop your resume here, or click to choose a file",
  compact = false,
  busyLabel = "Reading and structuring your resume…",
  accept = ".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  hint = "PDF or DOCX, up to 10 MB",
  multiple = false,
}: {
  /** Called once per file; several times for a multi-file drop or pick when `multiple` is on. */
  onFile: (file: File) => void;
  busy?: boolean;
  label?: string;
  compact?: boolean;
  busyLabel?: string;
  /** The file input's accept list. */
  accept?: string;
  /** The small line under the label saying what is accepted. */
  hint?: string;
  multiple?: boolean;
}) {
  const take = (list: FileList | null | undefined) => {
    const picked = Array.from(list ?? []);
    for (const file of multiple ? picked : picked.slice(0, 1)) onFile(file);
  };

  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => !busy && input.current?.click()}
      aria-busy={busy || undefined}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && !busy && (e.preventDefault(), input.current?.click())}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (!busy) take(e.dataTransfer.files);
      }}
      className={cn(
        "group/drop flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed text-sm text-muted-foreground outline-none transition-[background-color,border-color,color,scale] duration-200 hover:border-foreground/25 hover:bg-muted/50 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
        compact ? "p-4" : "p-12",
        over && "scale-[1.01] border-primary bg-muted/60 text-foreground",
        busy && "cursor-wait opacity-70",
      )}
    >
      {busy ? (
        <Loader2 className="size-6 animate-spin" aria-hidden />
      ) : (
        <Upload
          aria-hidden
          className={cn("size-6 transition-transform duration-200 group-hover/drop:-translate-y-0.5", over && "-translate-y-1")}
        />
      )}
      <span>{busy ? busyLabel : label}</span>
      <span className="text-xs">{hint}</span>
      <input
        ref={input}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={(e) => {
          take(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}
