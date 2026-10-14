"use client";

import { useQueryClient } from "@tanstack/react-query";
import { CircleAlert, Loader2, RotateCcw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { retryIndexAction } from "@/app/(app)/library/actions";
import { isIndexActive, indexLabel } from "@/lib/resume/types";
import { cn } from "@/lib/utils";
import { RESUME_INDEXES_KEY, useResumeIndexes } from "./use-resume-indexes";

/**
 * Shows a library resume while it is being read into sections (waiting or working), or when that failed (with a
 * retry). A resume that is read, or never needed reading, shows nothing. Reads the shared polling query, so every
 * badge on the page updates together.
 */
export function IndexBadge({ documentId, className }: { documentId: string; className?: string }) {
  const { byDocument } = useResumeIndexes();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  const info = byDocument.get(documentId);
  const label = indexLabel(info);
  const active = isIndexActive(info?.status);

  async function retry() {
    setBusy(true);
    const res = await retryIndexAction(documentId);
    setBusy(false);
    if (!res.ok) return void toast.error(res.error);
    void queryClient.invalidateQueries({ queryKey: RESUME_INDEXES_KEY });
  }

  if (!label) return null;
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 text-xs animate-in fade-in duration-200 motion-reduce:animate-none", info?.status === "failed" ? "text-destructive" : "text-muted-foreground", className)}
      title={info?.error ?? info?.note ?? undefined}
    >
      {active || busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <CircleAlert className="size-3.5" aria-hidden />}
      <span aria-live="polite">{label}</span>
      {info?.status === "failed" && (
        <button
          type="button"
          onClick={retry}
          disabled={busy}
          className="inline-flex items-center gap-1 rounded px-1 font-medium text-foreground underline-offset-4 outline-none transition-[background-color,scale] hover:bg-muted hover:underline focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.96] disabled:opacity-60"
        >
          <RotateCcw className="size-3" aria-hidden /> Retry
        </button>
      )}
    </span>
  );
}
