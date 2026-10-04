"use client";

import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, Clock, Copy, Loader2, RotateCcw, X, XCircle } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import {
  clearFinishedQueueAction,
  removeQueueItemAction,
  retryQueueItemAction,
} from "@/app/(app)/new/actions";
import { Button } from "@/components/ui/button";
import { Collapse } from "@/components/ui/collapse";
import { cn } from "@/lib/utils";
import { STEP_LABELS, currentStep, progressOf, type QueueItem, type QueueStatus } from "@/lib/queue/types";
import { useQueue } from "./use-queue";

/** How long a row takes to fold away before the server removes it. Matches the Collapse duration. */
const FOLD_MS = 280;

const ICONS: Record<QueueStatus, { Icon: typeof Clock; tone: string }> = {
  queued: { Icon: Clock, tone: "text-muted-foreground" },
  running: { Icon: Loader2, tone: "text-primary" },
  saved: { Icon: CheckCircle2, tone: "text-emerald-600 dark:text-emerald-400" },
  needs_review: { Icon: AlertCircle, tone: "text-amber-600 dark:text-amber-400" },
  duplicate: { Icon: Copy, tone: "text-sky-600 dark:text-sky-400" },
  failed: { Icon: XCircle, tone: "text-destructive" },
};

function StatusIcon({ status }: { status: QueueStatus }) {
  const { Icon, tone } = ICONS[status];
  // Keyed by status so a change plays a short pop instead of snapping.
  return (
    <span key={status} className="mt-0.5 animate-in fade-in zoom-in-75 duration-300 motion-reduce:animate-none">
      <Icon className={cn("size-4", tone, status === "running" && "animate-spin motion-reduce:animate-none")} aria-hidden />
      <span className="sr-only">{status.replace("_", " ")}</span>
    </span>
  );
}

function Detail({ item }: { item: QueueItem }) {
  const step = currentStep(item.steps);
  switch (item.status) {
    case "queued":
      return <span className="text-muted-foreground">Waiting for its turn</span>;
    case "running":
      return (
        <span key={step?.name ?? "start"} className="animate-in fade-in slide-in-from-bottom-1 duration-200 motion-reduce:animate-none">
          {step ? `${STEP_LABELS[step.name]}${step.detail ? `: ${step.detail}` : ""}` : "Starting"}
        </span>
      );
    case "saved":
      return <span className="text-muted-foreground">Saved to Jobs</span>;
    case "duplicate":
      return <span className="text-muted-foreground">Already in Jobs, nothing added</span>;
    case "needs_review":
    case "failed":
      return <span className={item.status === "failed" ? "text-destructive" : "text-amber-700 dark:text-amber-300"}>{item.error}</span>;
  }
}

function Row({
  item,
  fresh,
  folding,
  onRetry,
  onRemove,
}: {
  item: QueueItem;
  fresh: boolean;
  folding: boolean;
  onRetry: () => void;
  onRemove: () => void;
}) {
  const progress = progressOf(item.steps);
  const jobId = item.status === "saved" ? item.jobId : item.status === "duplicate" ? item.duplicateJobId : null;
  return (
    <li className={cn(fresh && "animate-in fade-in slide-in-from-bottom-2 duration-300 motion-reduce:animate-none")}>
      <Collapse open={!folding}>
        <div className="flex items-start gap-3 px-3 py-2.5 transition-colors duration-500 hover:bg-muted/40">
          <StatusIcon status={item.status} />
          <div className="min-w-0 flex-1 space-y-1">
            <div className="truncate text-sm font-medium" title={item.label}>
              {item.label}
            </div>
            <div className="text-xs">
              <Detail item={item} />
            </div>
            <Collapse open={item.status === "running"}>
              <div className="pt-1">
                <div className="h-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-[width] duration-700 ease-out motion-reduce:transition-none"
                    style={{ width: `${Math.max(progress * 100, 6)}%` }}
                  />
                </div>
              </div>
            </Collapse>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {item.status === "needs_review" && (
              <Button size="sm" nativeButton={false} render={<Link href={`/new?review=${item.id}`} scroll={false} />}>
                Review
              </Button>
            )}
            {jobId && (
              <Button size="sm" variant="outline" nativeButton={false} render={<Link href={`/jobs?job=${jobId}`} />}>
                View job
              </Button>
            )}
            {item.status === "failed" && (
              <Button size="sm" variant="outline" onClick={onRetry}>
                <RotateCcw /> Retry
              </Button>
            )}
            {item.status !== "running" && (
              <Button variant="ghost" size="icon-sm" onClick={onRemove} aria-label={`Remove ${item.label}`}>
                <X />
              </Button>
            )}
          </div>
        </div>
      </Collapse>
    </li>
  );
}

function summary(counts: Record<QueueStatus, number>): string {
  const parts = [
    counts.running + counts.queued > 0 ? `${counts.running + counts.queued} in progress` : "",
    counts.needs_review > 0 ? `${counts.needs_review} to review` : "",
    counts.saved > 0 ? `${counts.saved} saved` : "",
    counts.failed > 0 ? `${counts.failed} failed` : "",
  ].filter(Boolean);
  return parts.join(" · ");
}

/** The live queue. Rows ease in when added and fold away when removed; progress and status change in place. */
export function QueueList() {
  const { snapshot, isSuccess } = useQueue();
  const queryClient = useQueryClient();
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["queue"] });
  const [folding, setFolding] = useState<Set<string>>(new Set());
  // Rows present on first load do not animate in; only rows added afterwards do.
  const [initial, setInitial] = useState<Set<string> | null>(null);
  if (isSuccess && initial === null) setInitial(new Set(snapshot.items.map((i) => i.id)));

  const fold = async (ids: string[], run: () => Promise<{ ok: boolean; error?: string }>) => {
    setFolding((s) => new Set([...s, ...ids]));
    await new Promise((r) => setTimeout(r, FOLD_MS));
    const res = await run();
    if (!res.ok) {
      toast.error(res.error ?? "Could not remove");
      setFolding((s) => new Set([...s].filter((id) => !ids.includes(id))));
    }
    refresh();
  };

  const finishedIds = snapshot.items.filter((i) => ["saved", "duplicate", "failed"].includes(i.status)).map((i) => i.id);

  if (!isSuccess) return null;
  return (
    <section className="space-y-2 animate-in fade-in duration-300 motion-reduce:animate-none" aria-label="Job queue">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium">Queue</h2>
        <div className="flex items-center gap-3">
          <span key={summary(snapshot.counts)} className="animate-in fade-in text-xs text-muted-foreground duration-200 motion-reduce:animate-none">
            {summary(snapshot.counts)}
          </span>
          <Collapse open={finishedIds.length > 0}>
            <Button variant="ghost" size="sm" onClick={() => void fold(finishedIds, () => clearFinishedQueueAction())}>
              Clear finished
            </Button>
          </Collapse>
        </div>
      </div>

      {snapshot.items.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          Nothing queued. Jobs you add are processed in the background, so you can leave this page.
        </div>
      ) : (
        <ul className="divide-y overflow-hidden rounded-lg border">
          {snapshot.items.map((item) => (
            <Row
              key={item.id}
              item={item}
              fresh={initial !== null && !initial.has(item.id)}
              folding={folding.has(item.id)}
              onRetry={async () => {
                const res = await retryQueueItemAction(item.id);
                if (!res.ok) toast.error(res.error);
                refresh();
              }}
              onRemove={() => void fold([item.id], () => removeQueueItemAction(item.id))}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
