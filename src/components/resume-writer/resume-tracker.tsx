"use client";

import { ClipboardCheck, FileText, Loader2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Collapse } from "@/components/ui/collapse";
import { generationProgress, GENERATION_STEP_LABEL, GENERATION_STEPS, isGenerationOpen, type ActiveGeneration } from "@/lib/resume-writer/types";
import { useActiveGenerations } from "./use-active-generations";

/** The step to show on one line: the one running, else where it is waiting. */
function stepText(g: ActiveGeneration): string {
  if (g.status === "review") return "Ready for your review";
  const running = GENERATION_STEPS.find((n) => g.steps[n]?.status === "running");
  if (running) return GENERATION_STEP_LABEL[running];
  return g.status === "queued" || g.status === "writing_queued" ? "Waiting to start" : "Finishing up";
}

/** Sidebar card for resumes being written. It slides away when none is open. */
export function ResumeTracker() {
  const { generations, isSuccess } = useActiveGenerations();
  const open = generations.filter(isGenerationOpen);
  const visible = isSuccess && open.length > 0;

  // Keep showing the last summary while the card slides away, so it does not collapse to empty text.
  const [shown, setShown] = useState<ActiveGeneration[]>([]);
  if (visible && JSON.stringify(shown) !== JSON.stringify(open)) setShown(open);
  const list = visible ? open : shown;
  const first = list[0];
  const waiting = list.filter((g) => g.status === "review").length;
  const progress = list.length ? list.reduce((n, g) => n + generationProgress(g.steps), 0) / list.length : 0;

  return (
    <Collapse open={visible}>
      {first && (
        <Link
          href={list.length === 1 ? `/jobs/${first.jobId}/resume` : "/jobs"}
          className="mx-1 mb-1 block rounded-lg border bg-sidebar-accent/40 p-2.5 text-xs transition-colors duration-200 hover:bg-sidebar-accent group-data-[collapsible=icon]:hidden"
          aria-live="polite"
        >
          <div className="flex items-center gap-2 font-medium">
            {waiting === list.length ? (
              <ClipboardCheck className="size-3.5 text-amber-700 dark:text-amber-300" aria-hidden />
            ) : (
              <Loader2 className="size-3.5 animate-spin text-primary motion-reduce:animate-none" aria-hidden />
            )}
            <span>{list.length === 1 ? (first.status === "review" ? "Resume match ready" : "Writing a resume") : `Writing ${list.length} resumes`}</span>
          </div>
          <div className="flex items-center gap-1.5 pt-1.5 text-muted-foreground">
            <FileText className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">{list.length === 1 ? first.jobLabel : stepText(first)}</span>
          </div>
          <div className="pt-2">
            <div className="h-1 overflow-hidden rounded-full bg-border">
              <div className="h-full rounded-full bg-primary transition-[width] duration-700 ease-out motion-reduce:transition-none" style={{ width: `${Math.max(progress * 100, 8)}%` }} />
            </div>
            {list.length === 1 && <div className="mt-1 text-muted-foreground">{stepText(first)}</div>}
          </div>
        </Link>
      )}
    </Collapse>
  );
}
