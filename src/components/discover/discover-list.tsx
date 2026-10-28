"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowDownUp,
  Ban,
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  ExternalLink,
  Filter,
  Loader2,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { addDiscoveredAgainAction, dismissDiscoveredAction, restoreDiscoveredAction } from "@/app/(app)/discover/actions";
import { retryQueueItemAction } from "@/app/(app)/new/actions";
import { useQueue } from "@/components/queue/use-queue";
import { useNow } from "@/components/jobs/use-now";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapse } from "@/components/ui/collapse";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  activeFilterCount,
  DEFAULT_FILTERS,
  matchesFilters,
  MIN_FITS,
  modesOf,
  NO_TRACK,
  PROGRESS_FILTERS,
  PROGRESS_LABEL,
  SORT_LABEL,
  SORTS,
  sortJobs,
  sourceTitle,
  trackKey,
  tracksOf,
  type DiscoverFilters,
  type DiscoverSort,
  type MinFit,
  type ProgressFilter,
} from "@/lib/discover/filter";
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

function Card({ job, now, fresh, onRemove }: { job: DiscoveredJob; now: Date | null; fresh: boolean; onRemove: () => void }) {
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
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            className="text-muted-foreground hover:text-destructive"
            title={job.state === "in_jobs" ? "Remove from Discover. The job stays in Jobs." : "Remove from Discover"}
            onClick={onRemove}
          >
            <Trash2 /> Remove
          </Button>
          <Actions job={job} busy={busy} onRetry={onRetry} onAddAgain={onAddAgain} />
        </div>
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

/** A per-viewer setting kept in this browser. Storage can be missing or blocked; then it is just not remembered. */
function useStored<T extends string>(key: string, fallback: T, valid: (v: string) => v is T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(fallback);
  useEffect(() => {
    try {
      const v = localStorage.getItem(key);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- restoring from localStorage can only happen after mount
      if (v !== null && valid(v)) setValue(v);
    } catch {}
  }, [key, valid]);
  const set = (v: T) => {
    setValue(v);
    try {
      localStorage.setItem(key, v);
    } catch {}
  };
  return [value, set];
}

const isOpenFlag = (v: string): v is "open" | "closed" => v === "open" || v === "closed";
const isSort = (v: string): v is DiscoverSort => (SORTS as readonly string[]).includes(v);

function trackLabel(track: string): string {
  return track === NO_TRACK ? "Other" : track;
}

function Toolbar({
  jobs,
  filters,
  onFilters,
  sort,
  onSort,
}: {
  jobs: DiscoveredJob[];
  filters: DiscoverFilters;
  onFilters: (f: DiscoverFilters) => void;
  sort: DiscoverSort;
  onSort: (s: DiscoverSort) => void;
}) {
  const modes = useMemo(() => modesOf(jobs), [jobs]);
  const hasFit = jobs.some((j) => j.fit != null);
  const hasPay = jobs.some((j) => j.pay.trim());
  const count = activeFilterCount(filters);
  const set = (patch: Partial<DiscoverFilters>) => onFilters({ ...filters, ...patch });
  const cleared = count > 0 || filters.search !== "";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative w-full sm:max-w-xs">
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={filters.search}
          onChange={(e) => set({ search: e.target.value })}
          placeholder="Search title, company, location..."
          aria-label="Search these jobs"
          className="pl-8"
        />
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
          <Filter /> Filters
          {count > 0 && (
            <span
              key={count}
              className="ml-0.5 inline-flex size-4 items-center justify-center rounded-full bg-primary text-[0.65rem] text-primary-foreground tabular-nums animate-in zoom-in-50 fade-in duration-200 motion-reduce:animate-none"
              aria-label={`${count} active`}
            >
              {count}
            </span>
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-60">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Status</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={filters.progress} onValueChange={(v) => set({ progress: v as ProgressFilter })}>
              {PROGRESS_FILTERS.map((p) => (
                <DropdownMenuRadioItem key={p} value={p}>
                  {PROGRESS_LABEL[p]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
          {modes.length > 1 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>Work mode</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={filters.mode} onValueChange={(v) => set({ mode: v as string })}>
                  <DropdownMenuRadioItem value="any">Any</DropdownMenuRadioItem>
                  {modes.map((m) => (
                    <DropdownMenuRadioItem key={m.key} value={m.key}>
                      {m.label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuGroup>
            </>
          )}
          {hasFit && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>Fit</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={String(filters.minFit)} onValueChange={(v) => set({ minFit: Number(v) as MinFit })}>
                  {MIN_FITS.map((f) => (
                    <DropdownMenuRadioItem key={f} value={String(f)}>
                      {f === 0 ? "Any fit" : `${f}% or more`}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuGroup>
            </>
          )}
          {hasPay && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem checked={filters.payListed} onCheckedChange={(on) => set({ payListed: !!on })}>
                Pay listed
              </DropdownMenuCheckboxItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {cleared && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onFilters({ ...DEFAULT_FILTERS, track: filters.track })}
          className="animate-in fade-in slide-in-from-left-1 duration-200 motion-reduce:animate-none"
        >
          <X /> Clear
        </Button>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="outline" size="sm" className="ml-auto" />}>
          <ArrowDownUp /> {SORT_LABEL[sort]}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Sort by</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={sort} onValueChange={(v) => onSort(v as DiscoverSort)}>
              {SORTS.map((s) => (
                <DropdownMenuRadioItem key={s} value={s}>
                  {SORT_LABEL[s]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** One source's jobs (today, the ones Claude found) under a header that shows or hides them. */
function SourceSection({
  source,
  jobs,
  removed,
  initial,
  now,
  onRemove,
}: {
  source: string;
  jobs: DiscoveredJob[];
  removed: Set<string>;
  initial: Set<string>;
  now: Date | null;
  onRemove: (job: DiscoveredJob) => void;
}) {
  const [openFlag, setOpenFlag] = useStored(`discover.open.${source}`, "open", isOpenFlag);
  const [sort, setSort] = useStored(`discover.sort.${source}`, "newest", isSort);
  const [filters, setFilters] = useState<DiscoverFilters>(DEFAULT_FILTERS);
  const open = openFlag === "open";

  const visible = useMemo(() => jobs.filter((j) => !removed.has(j.id)), [jobs, removed]);
  const tracks = useMemo(() => tracksOf(visible), [visible]);
  // A tab whose last job was removed falls back to All.
  const track = filters.track === "all" || tracks.includes(filters.track) ? filters.track : "all";
  const matching = useMemo(() => visible.filter((j) => matchesFilters(j, filters)), [visible, filters]);
  const counts = useMemo(() => {
    const c = new Map<string, number>();
    for (const j of matching) c.set(trackKey(j), (c.get(trackKey(j)) ?? 0) + 1);
    return c;
  }, [matching]);
  // Removed cards stay in the list for a moment so they can fold away instead of vanishing.
  const shown = useMemo(
    () => sortJobs(jobs.filter((j) => (track === "all" || trackKey(j) === track) && (removed.has(j.id) || matchesFilters(j, filters))), sort),
    [jobs, removed, track, filters, sort],
  );
  const shownCount = shown.filter((j) => !removed.has(j.id)).length;
  const panelId = `discover-${source.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;

  return (
    <section className="rounded-xl border bg-card/40">
      <h2>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpenFlag(open ? "closed" : "open")}
          className="group flex w-full items-center gap-3 rounded-xl p-4 text-left outline-none transition-colors duration-150 hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring active:bg-muted"
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Sparkles aria-hidden className="size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">{sourceTitle(source)}</span>
            <span className="block text-xs text-muted-foreground tabular-nums">{summary(visible)}</span>
          </span>
          <ChevronDown
            aria-hidden
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform duration-200 ease-out group-hover:text-foreground motion-reduce:transition-none",
              open && "rotate-180",
            )}
          />
          <span className="sr-only">{open ? "Hide these jobs" : "Show these jobs"}</span>
        </button>
      </h2>

      <Collapse open={open}>
        <div id={panelId} className="space-y-3 px-4 pb-4">
          {tracks.length > 1 && (
            <Tabs value={track} onValueChange={(v) => setFilters({ ...filters, track: v as string })}>
              <TabsList className="h-auto flex-wrap">
                <TabsTrigger value="all">
                  All
                  <span className="ml-1.5 text-xs text-muted-foreground tabular-nums">{matching.length}</span>
                </TabsTrigger>
                {tracks.map((t) => (
                  <TabsTrigger key={t} value={t}>
                    {trackLabel(t)}
                    <span className="ml-1.5 text-xs text-muted-foreground tabular-nums">{counts.get(t) ?? 0}</span>
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          )}

          <Toolbar jobs={visible} filters={{ ...filters, track }} onFilters={setFilters} sort={sort} onSort={setSort} />

          {shownCount === 0 && (
            <div className="space-y-2 rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground animate-in fade-in duration-200 motion-reduce:animate-none">
              <p className="font-medium text-foreground">No jobs match</p>
              <Button variant="outline" size="sm" onClick={() => setFilters(DEFAULT_FILTERS)}>
                <X /> Clear filters
              </Button>
            </div>
          )}

          {/* Keyed by the order, so a new sort or tab fades the list in instead of snapping. */}
          <div key={`${track}:${sort}`} className="animate-in fade-in duration-200 motion-reduce:animate-none">
            {shown.map((job) => (
              <Collapse key={job.id} open={!removed.has(job.id)}>
                <div className="pb-3">
                  <Card job={job} now={now} fresh={!initial.has(job.id)} onRemove={() => onRemove(job)} />
                </div>
              </Collapse>
            ))}
          </div>
        </div>
      </Collapse>
    </section>
  );
}

/** Jobs that arrived from outside the app, grouped by where they came from, each with where it is now. */
export function DiscoverList({ jobs }: { jobs: DiscoveredJob[] }) {
  useRefreshOnQueueChange();
  const router = useRouter();
  const now = useNow();
  // Cards present on first render do not animate in; only ones that arrive while the page is open do.
  const [initial] = useState(() => new Set(jobs.map((j) => j.id)));
  // Hidden at once on Remove, before the server confirms; put back if it fails or on Undo.
  const [removed, setRemoved] = useState<Set<string>>(() => new Set());

  const sources = useMemo(() => {
    const by = new Map<string, DiscoveredJob[]>();
    for (const j of jobs) by.set(j.source, [...(by.get(j.source) ?? []), j]);
    return [...by.entries()];
  }, [jobs]);

  const unhide = (ids: string[]) =>
    setRemoved((s) => {
      const next = new Set(s);
      for (const id of ids) next.delete(id);
      return next;
    });

  const undo = async (ids: string[]) => {
    const res = await restoreDiscoveredAction(ids);
    if (!res.ok) return void toast.error(res.error);
    unhide(ids);
    router.refresh();
    toast.success("Back on Discover");
  };

  const remove = async (job: DiscoveredJob) => {
    setRemoved((s) => new Set(s).add(job.id));
    const res = await dismissDiscoveredAction([job.id]);
    if (!res.ok) {
      unhide([job.id]);
      return void toast.error(res.error);
    }
    const title = job.title || hostOf(job.url);
    toast(`Removed "${title}" from Discover`, {
      description: job.state === "in_jobs" ? "It is still in Jobs." : undefined,
      duration: 8000,
      action: { label: "Undo", onClick: () => void undo(res.removed) },
    });
  };

  if (jobs.length === 0 || jobs.every((j) => removed.has(j.id))) {
    return (
      <div className="space-y-2 rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground animate-in fade-in duration-300 motion-reduce:animate-none">
        <p className="font-medium text-foreground">Nothing discovered yet</p>
        <p>
          When you click Saved to JSOS on the Daily Job Shortlist in claude.ai, the job shows up here, under Found by Claude,
          while it is read and saved to Jobs.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {sources.map(([source, list]) => (
        <SourceSection key={source} source={source} jobs={list} removed={removed} initial={initial} now={now} onRemove={remove} />
      ))}
    </div>
  );
}
