"use client";

import { CircleAlert, CircleCheck, CircleDashed, Loader2, OctagonX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GENERATION_STEP_LABEL, GENERATION_STEPS, type GenerationItem } from "@/lib/resume-writer/types";
import { cn } from "@/lib/utils";

/** The steps of a resume being made with their state, so waiting never looks like nothing is happening. */
export function ResumeProgress({
  generation,
  title,
  stopping,
  onStop,
}: {
  generation: GenerationItem;
  title: string;
  stopping: boolean;
  onStop: () => void;
}) {
  const queued = generation.status === "queued" || generation.status === "writing_queued";
  return (
    <div role="status" aria-label={title} className="space-y-3 rounded-xl border bg-card p-4 text-sm animate-in fade-in duration-200 motion-reduce:animate-none">
      <h3 className="font-medium">{title}</h3>
      <ul className="space-y-1.5">
        {GENERATION_STEPS.map((name) => {
          const s = generation.steps[name];
          const Icon = !s ? CircleDashed : s.status === "running" ? Loader2 : s.status === "done" ? CircleCheck : s.status === "failed" ? CircleAlert : CircleDashed;
          return (
            <li key={name} className={cn("flex items-center gap-2 transition-opacity duration-200", !s && "opacity-50")}>
              <Icon
                aria-hidden
                className={cn(
                  "size-4 shrink-0 transition-colors",
                  s?.status === "running" && "animate-spin text-primary motion-reduce:animate-none",
                  s?.status === "done" && "text-green-600",
                  s?.status === "failed" && "text-destructive",
                  (!s || s.status === "skipped") && "text-muted-foreground",
                )}
              />
              <span className={s?.status === "skipped" ? "text-muted-foreground" : undefined}>{GENERATION_STEP_LABEL[name]}</span>
              {s?.detail && <span className="text-xs text-muted-foreground">{s.detail}</span>}
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {queued ? "Waiting for a free worker. " : ""}You can leave this page. It keeps running and you will be told when it is ready.
        </p>
        <Button variant="outline" size="sm" loading={stopping} onClick={onStop}>
          <OctagonX aria-hidden />
          Stop
        </Button>
      </div>
    </div>
  );
}
