"use client";

import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Ban, CheckCircle2, CircleDashed, ExternalLink, Loader2, RotateCcw, Sparkles, XCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { addDiscoveredAgainAction } from "@/app/(app)/discover/actions";
import { retryQueueItemAction } from "@/app/(app)/new/actions";
import { useQueue } from "@/components/queue/use-queue";
import { useNow } from "@/components/jobs/use-now";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { DiscoveredJob, DiscoverState } from "@/lib/discover/types";
import { formatDate, relativeDays } from "@/lib/jobs/format";
import { statusInfo } from "@/lib/jobs/status";
import { cn } from "@/lib/utils";

const STATE: Record<DiscoverState, { Icon: typeof CheckCircle2; tone: string; label: string }> = {
  in_jobs: { Icon: CheckCircle2, tone: "text-emerald-600 dark:text-emerald-400", label: "In Jobs" },
  reading: { Icon: Loader2, tone: "text-primary", label: "Reading the posting" },
  review: { Icon: AlertCircle, tone: "text-amber-600 dark:text-amber-400", label: "Waiting for your review" },
  failed: { Icon: XCircle, tone: "text-destructive", label: "Could not read it" },
  not_added: { Icon: Ban, tone: "text-muted-foreground", label: "Not added" },
  gone: { Icon: CircleDashed, tone: "text-muted-foreground", label: "No longer in Jobs" },
};

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * Refreshes the page when the queue changes (a pick arrives from claude.ai, or one being read finishes). The queue
 * is already polled for the sidebar tracker, so this adds no requests of its own.
 */
function useRefreshOnQueueChange() {
  const router = useRouter();
  const { snapshot, isSuccess } = useQueue();
  // The finish time is part of it so a retry that fails again within one poll still counts as a change.
  const signature = snapshot.items.map((i) => `${i.id}:${i.status}:${i.finishedAt ?? ""}`).join(",");
  const last = useRef<string | null>(null);
  useEffect(() => {
    if (!isSuccess) return;
    if (last.current !== null && last.current !== signature) router.refresh();
    last.current = signature;
  }, [isSuccess, signature, router]);
}

function FitBar({ fit }: { fit: number }) {
  const value = Math.max(0, Math.min(100, fit));
  return (
    <div className="flex shrink-0 items-center gap-2" title="Fit score from the shortlist">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${value}%` }} />
      </div>
      <span className="text-xs text-muted-foreground tabular-nums">{value}% fit</span>
    </div>
  );
}

function StateLine({ job }: { job: DiscoveredJob }) {
  const { Icon, tone, label } = STATE[job.state];
  const status = job.jobStatus ? statusInfo(job.jobStatus) : null;
  return (
    // Keyed by state so a change (reading, then saved) fades in instead of snapping.
    <div key={job.state} className="flex min-w-0 items-start gap-2 text-sm animate-in fade-in duration-300 motion-reduce:animate-none">
      <Icon aria-hidden className={cn("mt-0.5 size-4 shrink-0", tone, job.state === "reading" && "animate-spin motion-reduce:animate-none")} />
      <div className="min-w-0">
        <span className="font-medium">{label}</span>
        {status && <span className={cn("ml-2 rounded-md px-1.5 py-0.5 text-xs font-medium", status.tone)}>{status.label}</span>}
        {job.reason && <p className="text-xs text-muted-foreground">{job.reason}</p>}
      </div>
    </div>
  );
}

function Actions({ job, onAddAgain, onRetry, busy }: { job: DiscoveredJob; onAddAgain: () => void; onRetry: () => void; busy: boolean }) {
  switch (job.state) {
    case "in_jobs":
      return (
        <Button size="sm" variant="outline" nativeButton={false} render={<Link href={`/jobs?job=${job.jobId}`} />}>
          View job
        </Button>
      );
    case "review":
      return (
        <Button size="sm" nativeButton={false} render={<Link href={`/new?review=${job.queueId}`} scroll={false} />}>
          Review
        </Button>
      );
    case "failed":
      return (
        <Button size="sm" variant="outline" loading={busy} onClick={onRetry}>
          <RotateCcw /> Retry
        </Button>
      );
    case "not_added":
      return (
        <Button size="sm" variant="outline" nativeButton={false} render={<Link href="/new" />}>
          Paste the text
        </Button>
      );
    case "gone":
      return (
        <Button size="sm" variant="outline" loading={busy} onClick={onAddAgain}>
          Add again
        </Button>
      );
    case "reading":
      return null;
  }
}

function Card({ job, now, fresh }: { job: DiscoveredJob; now: Date | null; fresh: boolean }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  const act = async (run: () => Promise<{ ok: boolean; error?: string }>, done: string) => {
    setBusy(true);
    const res = await run();
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error ?? "Something went wrong");
      return;
    }
    toast.success(done);
    router.refresh();
    // The queue polls fast while something is being read, so the card follows it to the end.
    void queryClient.invalidateQueries({ queryKey: ["queue"] });
  };
  const onRetry = () => job.queueId && act(() => retryQueueItemAction(job.queueId!), "Reading it again");
  const onAddAgain = () =>
    act(async () => {
      const res = await addDiscoveredAgainAction(job.id);
      if (res.ok && res.state === "not_added") return { ok: false, error: res.reason ?? "Could not add it" };
      return res;
    }, "Added to the queue");

  // A mode of "Remote" and a location of "Remote" say the same thing once.
  const chips = [job.track, job.mode, job.location, job.pay, job.posted && `Posted ${formatDate(job.posted)}`].filter(
    (c, i, all): c is string => !!c && all.findIndex((o) => o && o.toLowerCase() === c.toLowerCase()) === i,
  );
  return (
    <article
      className={cn(
        "rounded-xl border bg-card p-4 transition-[border-color,box-shadow] duration-200 hover:border-foreground/20 hover:shadow-sm",
        fresh && "animate-in fade-in slide-in-from-bottom-2 duration-300 motion-reduce:animate-none",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <h2 className="min-w-0 text-sm font-semibold">
          <a
            href={job.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-baseline gap-1 rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            {job.title || hostOf(job.url)}
            <ExternalLink aria-hidden className="size-3 shrink-0 self-center text-muted-foreground" />
            <span className="sr-only">(opens the posting)</span>
          </a>
          {job.company && <span className="font-normal text-muted-foreground"> at {job.company}</span>}
        </h2>
        {job.fit != null && <FitBar fit={job.fit} />}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Badge variant="secondary" title="Where this job came from">
          <Sparkles aria-hidden /> {job.source}
        </Badge>
        {chips.map((c) => (
          <Badge key={c} variant="outline" className="font-normal text-muted-foreground">
            {c}
          </Badge>
        ))}
        <span className="text-xs text-muted-foreground">Sent {now ? relativeDays(job.createdAt, now) : formatDate(job.createdAt)}</span>
      </div>

      {(job.why || job.leadWith || job.applyHow) && (
        <div className="mt-3 max-w-prose space-y-1 text-sm">
          {job.why && <p>{job.why}</p>}
          {job.leadWith && (
            <p className="text-muted-foreground">
              <span className="font-medium text-foreground">Lead with:</span> {job.leadWith}
            </p>
          )}
          {job.applyHow && (
            <p className="text-muted-foreground">
              <span className="font-medium text-foreground">Apply:</span> {job.applyHow}
            </p>
          )}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t pt-3">
        <StateLine job={job} />
        <Actions job={job} busy={busy} onRetry={onRetry} onAddAgain={onAddAgain} />
      </div>
    </article>
  );
}

function summary(jobs: DiscoveredJob[]): string {
  const n = (s: DiscoverState) => jobs.filter((j) => j.state === s).length;
  return [
    `${jobs.length} job${jobs.length === 1 ? "" : "s"}`,
    n("in_jobs") ? `${n("in_jobs")} in Jobs` : "",
    n("reading") ? `${n("reading")} being read` : "",
    n("review") ? `${n("review")} to review` : "",
    n("failed") + n("not_added") + n("gone") ? `${n("failed") + n("not_added") + n("gone")} need you` : "",
  ]
    .filter(Boolean)
    .join(", ");
}

/** Jobs that arrived from outside the app, newest first, each with where it is now. */
export function DiscoverList({ jobs }: { jobs: DiscoveredJob[] }) {
  useRefreshOnQueueChange();
  const now = useNow();
  // Cards present on first render do not animate in; only ones that arrive while the page is open do.
  const [initial] = useState(() => new Set(jobs.map((j) => j.id)));

  if (jobs.length === 0) {
    return (
      <div className="space-y-2 rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
        <p className="font-medium text-foreground">Nothing discovered yet</p>
        <p>
          When you click Saved to JSOS on the Daily Job Shortlist in claude.ai, the job shows up here, marked Claude.ai, while
          it is read and saved to Jobs.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground tabular-nums">{summary(jobs)}</p>
      {jobs.map((job) => (
        <Card key={job.id} job={job} now={now} fresh={!initial.has(job.id)} />
      ))}
    </div>
  );
}
