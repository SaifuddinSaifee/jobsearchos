"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ClipboardCheck, FileUp, Hammer, History, Library, Loader2, Play, RotateCcw, UserRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  includeProfileAction,
  prepareSkippedAction,
  restoreRecordVersionAction,
  retryFailedAction,
  reviewAgainAction,
  startBuildAction,
} from "@/app/(app)/library/record/actions";
import type { CareerStatus } from "@/lib/career/review";
import type { CareerRecord } from "@/lib/career/schema";
import type { SourceInfo } from "@/lib/career/service";
import { FailureDialog } from "./failure-dialog";
import { RecordBrowser } from "./record-browser";
import { SkipButton } from "./skip-button";
import { RecordEditProvider } from "./record-edit";
import { CAREER_STATUS_KEY, isPreparing, useCareerStatus } from "./use-career-status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import type { RecordSummary, RecordVersionItem } from "./types";

const REASON_LABEL: Record<RecordVersionItem["reason"], string> = {
  merge: "Merged",
  edit: "Edited",
  restore: "Restored",
};

export function RecordView({
  summary,
  versions,
  status,
  record,
  sources,
}: {
  summary: RecordSummary | null;
  versions: RecordVersionItem[];
  status: CareerStatus;
  record: CareerRecord | null;
  sources: Record<string, SourceInfo>;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <p className="max-w-xl text-sm text-muted-foreground">
          Everything you have done, merged from your resumes and cover letters. It has no length limit and it is never
          sent anywhere. Nothing is added to it without your review.
        </p>
        <VersionsSheet versions={versions} latest={summary?.version ?? 0} />
      </div>

      <Progress initial={status} />
      {summary && record ? (
        <RecordEditProvider version={summary.version} sources={sources}>
          <Summary summary={summary} />
          <RecordBrowser record={record} />
        </RecordEditProvider>
      ) : (
        <EmptyState hasSources={status.total > 0} />
      )}
    </div>
  );
}

/** Where the sources are on their way into the record, and what to do next. */
function Progress({ initial }: { initial: CareerStatus }) {
  const router = useRouter();
  const client = useQueryClient();
  const { data } = useCareerStatus(initial);
  const status = data ?? initial;
  const [retrying, startRetry] = useTransition();
  const [again, startAgain] = useTransition();
  const [, startPrepare] = useTransition();
  const [preparingSkipped, setPreparingSkipped] = useState<string | null>(null);

  const preparing = isPreparing(status);
  const refresh = () => client.invalidateQueries({ queryKey: CAREER_STATUS_KEY }).then(() => router.refresh());
  const retry = () =>
    startRetry(async () => {
      const res = await retryFailedAction();
      if (!res.ok) toast.error(res.error);
      await refresh();
    });

  return (
    <div className="space-y-2">
      {status.counts.ready > 0 && (
        <div className="animate-in fade-in slide-in-from-bottom-1 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/40 px-4 py-3 duration-300 motion-reduce:animate-none">
          <p className="text-sm">
            <span className="font-medium">{status.current?.label ?? "A source"}</span> is ready to review ({status.done} of {status.total} done).
          </p>
          <div className="flex flex-wrap gap-2">
            {status.current && <SkipButton proposalId={status.current.id} ready />}
            <Button nativeButton={false} render={<Link href="/library/record/review" />}>
              <ClipboardCheck aria-hidden />
              Review
            </Button>
          </div>
        </div>
      )}

      {preparing && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Preparing {status.current?.label ?? "the next source"} ({status.done} of {status.total} done)
          </p>
          {status.current?.status === "running" && <SkipButton proposalId={status.current.id} ready={false} />}
        </div>
      )}

      {status.counts.failed > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm animate-in fade-in duration-300 motion-reduce:animate-none">
          <p>
            {status.counts.failed} could not be prepared: {status.failed.map((f) => f.label).join(", ")}.
          </p>
          <div className="flex flex-wrap gap-2">
            <FailureDialog failures={status.failed} retrying={retrying} onRetry={retry} />
            <Button variant="outline" loading={retrying} onClick={retry}>
              <RotateCcw aria-hidden />
              Try again
            </Button>
          </div>
        </div>
      )}

      {status.undone.length > 0 && (
        <div className="space-y-1 rounded-lg border px-4 py-3 text-sm animate-in fade-in duration-300 motion-reduce:animate-none">
          <p className="font-medium">Undone by a restore</p>
          <ul className="space-y-1">
            {status.undone.map((u) => (
              <li key={u.id} className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">{u.label}</span>
                <Button
                  size="sm"
                  variant="outline"
                  loading={again}
                  onClick={() =>
                    startAgain(async () => {
                      const res = await reviewAgainAction(u.id);
                      if (!res.ok) toast.error(res.error);
                      await refresh();
                    })
                  }
                >
                  Review again
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {status.skipped.length > 0 && (
        <div className="space-y-1 rounded-lg border px-4 py-3 text-sm animate-in fade-in duration-300 motion-reduce:animate-none">
          <p className="font-medium">Skipped, not reviewed yet</p>
          <ul className="space-y-1">
            {status.skipped.map((u) => (
              <li key={u.id} className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">{u.label}</span>
                <Button
                  size="sm"
                  variant="outline"
                  loading={preparingSkipped === u.id}
                  disabled={preparingSkipped !== null}
                  onClick={() => {
                    setPreparingSkipped(u.id);
                    startPrepare(async () => {
                      const res = await prepareSkippedAction(u.id);
                      if (res.ok) toast.success(`${u.label} queued for review`);
                      else toast.error(res.error);
                      await refresh();
                      setPreparingSkipped(null);
                    });
                  }}
                >
                  <Play aria-hidden />
                  Prepare
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <SourceActions refresh={refresh} started={status.total > 0 || status.recordVersion > 0} />
    </div>
  );
}

/** More things to read into the record: new documents, the Profile, or a LinkedIn profile saved as a PDF. */
function SourceActions({ refresh, started }: { refresh: () => Promise<unknown>; started: boolean }) {
  const [building, startBuild] = useTransition();
  const [including, startInclude] = useTransition();
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setUploading(true);
    try {
      const body = new FormData();
      body.set("file", file);
      const res = await fetch("/api/career/linkedin", { method: "POST", body });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.ok) toast.success("LinkedIn profile queued for review");
      else toast.error(data.error ?? "Could not read that file");
      await refresh();
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      {started && (
        <Button
          variant="outline"
          size="sm"
          loading={building}
          onClick={() =>
            startBuild(async () => {
              const res = await startBuildAction();
              if (res.ok) toast.success(res.queued > 0 ? `${res.queued} sources queued` : "Nothing new to add");
              else toast.error(res.error);
              await refresh();
            })
          }
        >
          <Hammer aria-hidden />
          Look for new sources
        </Button>
      )}
      <Button
        variant="outline"
        size="sm"
        loading={including}
        onClick={() =>
          startInclude(async () => {
            const res = await includeProfileAction();
            if (!res.ok) toast.error(res.error);
            else if (res.status === "empty") toast.error("Your Profile is empty. Add your experience on the Profile page first.");
            else if (res.status === "skipped") toast.success(res.reason ?? "Nothing new in your Profile");
            else toast.success("Profile queued for review");
            await refresh();
          })
        }
      >
        <UserRound aria-hidden />
        Include Profile
      </Button>
      <Button variant="outline" size="sm" loading={uploading} onClick={() => fileInput.current?.click()}>
        <FileUp aria-hidden />
        Add LinkedIn PDF
      </Button>
      <input
        ref={fileInput}
        type="file"
        accept="application/pdf,.pdf"
        className="sr-only"
        tabIndex={-1}
        aria-label="LinkedIn profile saved as a PDF"
        onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])}
      />
    </div>
  );
}

function EmptyState({ hasSources }: { hasSources: boolean }) {
  const router = useRouter();
  const client = useQueryClient();
  const [building, start] = useTransition();
  return (
    <div className="animate-in fade-in slide-in-from-bottom-1 rounded-lg border border-dashed p-8 text-center duration-300 motion-reduce:animate-none">
      <Library className="mx-auto size-6 text-muted-foreground" aria-hidden />
      <h2 className="mt-3 text-sm font-medium">Your career record is empty</h2>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
        It will hold every employer, role and accomplishment from your documents, with each way you have worded them.
        You review each source before anything is added.
      </p>
      {!hasSources && (
        <Button
          className="mt-4"
          loading={building}
          onClick={() =>
            start(async () => {
              const res = await startBuildAction();
              if (res.ok) toast.success(res.queued > 0 ? `${res.queued} sources queued` : "There is nothing to read yet");
              else toast.error(res.error);
              await client.invalidateQueries({ queryKey: CAREER_STATUS_KEY });
              router.refresh();
            })
          }
        >
          <Hammer aria-hidden />
          Build from your library
        </Button>
      )}
    </div>
  );
}

function Summary({ summary }: { summary: RecordSummary }) {
  const items: [string, number][] = [
    ["Employers", summary.employers],
    ["Roles", summary.roles],
    ["Facts", summary.facts],
    ["Wordings", summary.wordings],
    ["Skills", summary.skills],
  ];
  return (
    <dl className="animate-in fade-in slide-in-from-bottom-1 grid grid-cols-2 gap-3 duration-300 motion-reduce:animate-none sm:grid-cols-5">
      {items.map(([label, n]) => (
        <div key={label} className="rounded-lg border p-3">
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="text-xl font-semibold tabular-nums">{n}</dd>
        </div>
      ))}
    </dl>
  );
}

function VersionsSheet({ versions, latest }: { versions: RecordVersionItem[]; latest: number }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState<RecordVersionItem | null>(null);
  const [pending, start] = useTransition();

  function restore(v: RecordVersionItem) {
    start(async () => {
      const result = await restoreRecordVersionAction(v.id);
      if (result.ok) {
        toast.success(`Restored as version ${result.version}`);
        setConfirm(null);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <>
      <Sheet>
        <SheetTrigger render={<Button variant="outline" className="shrink-0" />}>
          <History aria-hidden />
          Versions
          <span className="text-xs tabular-nums text-muted-foreground">{versions.length}</span>
        </SheetTrigger>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Record versions</SheetTitle>
            <SheetDescription>
              Every change makes a new version, so any change can be undone. Restoring saves an old version as a new one.
            </SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-4 pb-4">
            {versions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No versions yet.</p>
            ) : (
              <ol className="divide-y rounded-lg border">
                {versions.map((v) => (
                  <li key={v.id} className="flex items-center justify-between gap-3 p-3 transition-colors duration-100 hover:bg-muted/50">
                    <div className="min-w-0 space-y-0.5 text-sm">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">Version {v.version}</span>
                        {v.version === latest && <Badge>Current</Badge>}
                        <span className="text-xs text-muted-foreground">{REASON_LABEL[v.reason]}</span>
                      </div>
                      <p className="truncate text-xs text-muted-foreground">
                        {new Date(v.createdAt).toLocaleString()}
                        {v.changeNote ? `, ${v.changeNote}` : ""}
                      </p>
                    </div>
                    {v.version !== latest && (
                      <Button size="sm" variant="outline" onClick={() => setConfirm(v)}>
                        <RotateCcw aria-hidden />
                        Restore
                      </Button>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </div>
        </SheetContent>
      </Sheet>

      <Dialog open={confirm !== null} onOpenChange={(open) => !open && !pending && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Restore version {confirm?.version}?</DialogTitle>
            <DialogDescription>
              Your record goes back to how it was then, saved as a new version. Merges made since are marked so you can
              review them again.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={pending} onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button loading={pending} onClick={() => confirm && restore(confirm)}>
              Restore
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
