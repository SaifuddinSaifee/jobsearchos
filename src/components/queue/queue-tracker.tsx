"use client";

import { AlertTriangle, ListChecks, Loader2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Collapse } from "@/components/ui/collapse";
import { progressOf } from "@/lib/queue/types";
import { useQueue } from "./use-queue";

const RECENT_MS = 5 * 60_000;

type Summary = { running: number; queued: number; review: number; failed: number; done: number; total: number; progress: number };

function summarize(items: ReturnType<typeof useQueue>["snapshot"]["items"], now: number): Summary {
  const running = items.filter((i) => i.status === "running");
  const queued = items.filter((i) => i.status === "queued").length;
  const recent = items.filter(
    (i) => (i.status === "saved" || i.status === "duplicate") && i.finishedAt && now - new Date(i.finishedAt).getTime() < RECENT_MS,
  ).length;
  // A batch is what is working now plus what just finished, so the bar fills as the batch completes.
  const total = running.length + queued + recent;
  const progress = total ? (recent + running.reduce((n, i) => n + progressOf(i.steps), 0)) / total : 0;
  return {
    running: running.length,
    queued,
    review: items.filter((i) => i.status === "needs_review").length,
    failed: items.filter((i) => i.status === "failed").length,
    done: recent,
    total,
    progress,
  };
}

/** Sidebar footer: what the background queue is doing. It slides away when there is nothing to show. */
export function QueueTracker() {
  const { snapshot, isSuccess } = useQueue();
  const [now, setNow] = useState(0);
  useEffect(() => {
    // Wall-clock time can only be read after mount (it would differ between server and client render).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  const live = summarize(snapshot.items, now);
  const working = live.running + live.queued > 0;
  const visible = isSuccess && now > 0 && (working || live.review > 0 || live.failed > 0);

  // Keep showing the last non-empty summary while the card slides away, so it does not collapse to empty text.
  const [shown, setShown] = useState(live);
  if (visible && JSON.stringify(shown) !== JSON.stringify(live)) setShown(live);
  const s = visible ? live : shown;

  return (
    <Collapse open={visible}>
      <Link
        href="/new"
        className="group/tracker mx-1 mb-1 block rounded-lg border bg-sidebar-accent/40 p-2.5 text-xs transition-colors duration-200 hover:bg-sidebar-accent group-data-[collapsible=icon]:hidden"
        aria-live="polite"
      >
        <div className="flex items-center gap-2 font-medium">
          {working ? (
            <Loader2 className="size-3.5 animate-spin text-primary motion-reduce:animate-none" aria-hidden />
          ) : (
            <ListChecks className="size-3.5 text-muted-foreground" aria-hidden />
          )}
          <span key={working ? "working" : "idle"} className="animate-in fade-in duration-200">
            {working ? `Adding jobs: ${s.running} running` : "Job queue"}
            {working && s.queued > 0 && `, ${s.queued} waiting`}
          </span>
        </div>

        <Collapse open={working}>
          <div className="pt-2">
            <div className="h-1 overflow-hidden rounded-full bg-border">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-700 ease-out motion-reduce:transition-none"
                style={{ width: `${Math.max(s.progress * 100, 6)}%` }}
              />
            </div>
            <div className="mt-1 text-muted-foreground tabular-nums">
              {s.done} of {s.total} finished
            </div>
          </div>
        </Collapse>

        <Collapse open={s.review > 0}>
          <div className="flex items-center gap-1.5 pt-2 text-amber-700 dark:text-amber-300">
            <AlertTriangle className="size-3.5" aria-hidden />
            <span className="tabular-nums">{s.review}</span> ready to review
          </div>
        </Collapse>
        <Collapse open={s.failed > 0}>
          <div className="flex items-center gap-1.5 pt-2 text-destructive">
            <AlertTriangle className="size-3.5" aria-hidden />
            <span className="tabular-nums">{s.failed}</span> failed
          </div>
        </Collapse>
      </Link>
    </Collapse>
  );
}
