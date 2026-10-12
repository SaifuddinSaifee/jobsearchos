"use client";

import { useQueryClient } from "@tanstack/react-query";
import { CircleAlert, CircleCheck, Loader2, RotateCcw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { indexResumeAction } from "@/app/(app)/profile/actions";
import { isIndexActive, indexLabel } from "@/lib/resume/types";
import { cn } from "@/lib/utils";
import { RESUME_INDEXES_KEY, useResumeIndexes } from "./use-resume-indexes";

/**
 * Whether a resume is searchable yet: waiting, working, ready (with how many sections), or failed (with a retry).
 * Reads the shared polling query, so every badge on the page updates together.
 */
export function IndexBadge({ fileId, className }: { fileId: string; className?: string }) {
  const { byId, isSuccess } = useResumeIndexes();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  if (!isSuccess) return <span className={cn("inline-block h-4 w-24 animate-pulse rounded bg-muted", className)} aria-hidden />;

  const info = byId.get(fileId);
  const active = isIndexActive(info?.status);

  async function start() {
    setBusy(true);
    const res = await indexResumeAction(fileId);
    setBusy(false);
    if (!res.ok) return void toast.error(res.error);
    void queryClient.invalidateQueries({ queryKey: RESUME_INDEXES_KEY });
  }

  const canStart = !info || info.status === "failed";
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs", info?.status === "failed" ? "text-destructive" : "text-muted-foreground", className)} title={info?.error ?? info?.note ?? undefined}>
      {active || busy ? (
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
      ) : info?.status === "ready" ? (
        <CircleCheck className="size-3.5 text-green-600 dark:text-green-400" aria-hidden />
      ) : info?.status === "failed" ? (
        <CircleAlert className="size-3.5" aria-hidden />
      ) : null}
      <span aria-live="polite">{indexLabel(info)}</span>
      {canStart && (
        <button
          type="button"
          onClick={start}
          disabled={busy}
          className="inline-flex items-center gap-1 rounded px-1 font-medium text-foreground underline-offset-4 outline-none transition-[background-color,scale] hover:bg-muted hover:underline focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.96] disabled:opacity-60"
        >
          <RotateCcw className="size-3" aria-hidden /> {info ? "Retry" : "Index now"}
        </button>
      )}
    </span>
  );
}
