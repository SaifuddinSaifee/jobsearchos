"use client";

import { CircleAlert, CircleCheck, CircleDashed, Loader2, OctagonX, Timer } from "lucide-react";
import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { formatDuration, GENERATION_STEP_LABEL, GENERATION_STEPS, stepMs, stepsMs, type GenerationItem } from "@/lib/resume-writer/types";
import { cn } from "@/lib/utils";

function subscribe(onChange: () => void) {
  const id = setInterval(onChange, 1000);
  return () => clearInterval(id);
}
const second = () => Math.floor(Date.now() / 1000);

/** The current time to the second, ticking while it is used; null on the server and during hydration. */
function useSecond(): number | null {
  const s = useSyncExternalStore(subscribe, second, () => null);
  return s === null ? null : s * 1000;
}

/**
 * The steps of a generation with their state and how long each took, and the total. While it works, the running step's
 * time counts up; once it has ended, a step left running (a stopped generation) counts to when it ended.
 */
export function StepList({ generation, live }: { generation: GenerationItem; live: boolean }) {
  const tick = useSecond();
  const ended = generation.finishedAt ? Date.parse(generation.finishedAt) : null;
  const now = live ? tick : (ended ?? tick);
  const timed = GENERATION_STEPS.some((name) => generation.steps[name]?.startedAt);
  const total = now === null ? null : stepsMs(generation.steps, now);
  return (
    <div className="space-y-2">
      <ul className="space-y-1.5">
        {GENERATION_STEPS.map((name) => {
          const s = generation.steps[name];
          const running = s?.status === "running" && live;
          const Icon = !s ? CircleDashed : running ? Loader2 : s.status === "done" ? CircleCheck : s.status === "failed" ? CircleAlert : CircleDashed;
          const ms = now === null ? null : stepMs(s, now);
          return (
            <li key={name} className={cn("flex items-start gap-2 transition-opacity duration-200", !s && "opacity-50")}>
              <Icon
                aria-hidden
                className={cn(
                  "mt-0.5 size-4 shrink-0 transition-colors",
                  running && "animate-spin text-primary motion-reduce:animate-none",
                  s?.status === "done" && "text-green-600",
                  s?.status === "failed" && "text-destructive",
                  (!s || s.status === "skipped" || (s.status === "running" && !live)) && "text-muted-foreground",
                )}
              />
              <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
                <span className={s?.status === "skipped" ? "text-muted-foreground" : undefined}>{GENERATION_STEP_LABEL[name]}</span>
                {s?.detail && <span className="text-xs text-muted-foreground">{s.detail}</span>}
              </span>
              {ms !== null && (
                // A time counting up is not read out every second; the step's state still is.
                <span aria-hidden={running || undefined} className={cn("shrink-0 pl-2 text-xs leading-5 whitespace-nowrap tabular-nums", running ? "text-foreground" : "text-muted-foreground")}>
                  <span className="sr-only">Took </span>
                  {formatDuration(ms)}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {timed && total !== null && (
        <p aria-hidden={live || undefined} className="flex items-start gap-2 border-t pt-2 text-xs text-muted-foreground">
          <Timer aria-hidden className="size-4 shrink-0" />
          <span className="min-w-0 flex-1">{live ? "Total so far" : "Total"}, not counting your review of the match</span>
          <span className="shrink-0 pl-2 font-medium whitespace-nowrap tabular-nums text-foreground">{formatDuration(total)}</span>
        </p>
      )}
    </div>
  );
}

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
      <StepList generation={generation} live />
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
