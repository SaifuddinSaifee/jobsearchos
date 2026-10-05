"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ChevronLeft, ChevronRight, Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { saveNotesAction } from "@/app/(app)/jobs/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { formatDate, formatSalary, relativeDays, storedToDate } from "@/lib/jobs/format";
import { sourceLabel } from "@/lib/jobs/links";
import { MAX_NOTES, type DeletedState, type JobDetail, type JobRow } from "@/lib/jobs/types";
import { statusInfo, type ApplicationStatus } from "@/lib/jobs/status";
import { detailToMarkdownJob } from "@/lib/jobs/markdown";
import { cn } from "@/lib/utils";
import { AskClaudeButton } from "./ask-claude";
import { JobEditForm } from "./job-edit-form";
import { MarkdownButtons, toMarkdownFile } from "./markdown-actions";
import { JobLinkButtons } from "./table/job-links";
import { StatusMenu } from "./table/status-menu";
import { useNow } from "./use-now";

const REMOTE_LABEL: Record<string, string> = { remote: "Remote", hybrid: "Hybrid", onsite: "On-site" };

class NotFoundError extends Error {}

async function fetchJob(id: string): Promise<JobDetail> {
  const res = await fetch(`/api/jobs/${id}`);
  if (res.status === 404) throw new NotFoundError("Job not found");
  if (!res.ok) throw new Error("Could not load the job");
  return res.json();
}

type Props = {
  jobId: string | null;
  row: JobRow | null;
  neighbors: { prev: string | null; next: string | null; position: string | null };
  focusDate: boolean;
  onClose: () => void;
  onNavigate: (jobId: string) => void;
  onChangeStatus: (applicationId: string, to: ApplicationStatus) => void;
  onSetAppliedAt: (applicationId: string, date: string) => void;
  /** Unsaved notes or job edits; the table asks before throwing them away. */
  onDirty: (dirty: boolean) => void;
  onNotesSaved: () => void;
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
  onEdited: (removedCompanies: DeletedState["companies"]) => void;
  onDelete: (jobId: string) => void;
};

export function JobSheet(props: Props) {
  const { jobId, row, onClose } = props;
  const { data, isLoading, error } = useQuery({
    queryKey: ["job", jobId],
    queryFn: () => fetchJob(jobId!),
    enabled: Boolean(jobId),
    retry: false,
  });

  const head: JobRow | null = row ?? data ?? null;

  return (
    <Sheet open={Boolean(jobId)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="gap-0 overflow-y-auto p-0 data-[side=right]:w-1/2 data-[side=right]:sm:max-w-6xl">
        {head ? (
          <Panel {...props} head={head} detail={data ?? null} loading={isLoading} />
        ) : error instanceof NotFoundError ? (
          <div className="space-y-3 p-6">
            <SheetTitle>Job not found</SheetTitle>
            <SheetDescription>This job does not exist or was removed.</SheetDescription>
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
          </div>
        ) : (
          <div className="space-y-3 p-6">
            <SheetTitle className="sr-only">Loading job</SheetTitle>
            <SheetDescription className="sr-only">Loading job details</SheetDescription>
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-32 w-full" />
            {error && <p className="text-sm text-destructive">{error.message}</p>}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2 border-t px-6 py-4">
      <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</h3>
      {children}
    </section>
  );
}

function BulletList({ items }: { items: string[] }) {
  if (!items.length) return <p className="text-sm text-muted-foreground">None listed.</p>;
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm">
      {items.map((x, i) => (
        <li key={i}>{x}</li>
      ))}
    </ul>
  );
}

function Panel({
  head,
  detail,
  loading,
  neighbors,
  focusDate,
  onNavigate,
  onChangeStatus,
  onSetAppliedAt,
  onDirty,
  onNotesSaved,
  editing,
  onEditingChange,
  onEdited,
  onDelete,
}: Props & { head: JobRow; detail: JobDetail | null; loading: boolean }) {
  const now = useNow();
  const dateRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (focusDate) dateRef.current?.focus();
  }, [focusDate, head.appliedAt]);

  const salary = formatSalary(head.salaryMin, head.salaryMax, head.salaryCurrency, head.salaryPeriod);

  return (
    <>
      <SheetHeader className="space-y-2 p-6 pr-14">
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Previous job"
            disabled={!neighbors.prev}
            onClick={() => neighbors.prev && onNavigate(neighbors.prev)}
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Next job"
            disabled={!neighbors.next}
            onClick={() => neighbors.next && onNavigate(neighbors.next)}
          >
            <ChevronRight />
          </Button>
          {neighbors.position && <span>{neighbors.position}</span>}
        </div>
        <SheetTitle className="text-lg leading-snug">{head.title}</SheetTitle>
        <SheetDescription className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-medium text-foreground">{head.company}</span>
          {head.location && <span>· {head.location}</span>}
          {REMOTE_LABEL[head.remoteType] && <Badge variant="outline">{REMOTE_LABEL[head.remoteType]}</Badge>}
          {salary && <span>· {salary}</span>}
        </SheetDescription>
        <JobLinkButtons job={head} />
        <div className="flex flex-wrap items-center gap-2">
          <MarkdownButtons
            disabled={!detail}
            build={() => toMarkdownFile(detailToMarkdownJob(detail!))}
          />
          <AskClaudeButton disabled={!detail} build={() => detailToMarkdownJob(detail!)} />
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant={editing ? "secondary" : "outline"}
              size="sm"
              disabled={!detail}
              aria-pressed={editing}
              onClick={() => onEditingChange(!editing)}
            >
              <Pencil />
              {editing ? "Editing" : "Edit"}
            </Button>
            <Button variant="destructive" size="sm" onClick={() => onDelete(head.jobId)}>
              <Trash2 />
              Delete
            </Button>
          </div>
        </div>
      </SheetHeader>

      {editing ? (
        detail ? (
          <JobEditForm
            key={detail.jobId}
            detail={detail}
            onCancel={() => onEditingChange(false)}
            onSaved={onEdited}
            onDirty={onDirty}
          />
        ) : (
          <div className="space-y-3 border-t p-6">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        )
      ) : (
        <PanelBody
          head={head}
          detail={detail}
          loading={loading}
          now={now}
          dateRef={dateRef}
          onChangeStatus={onChangeStatus}
          onSetAppliedAt={onSetAppliedAt}
          onDirty={onDirty}
          onNotesSaved={onNotesSaved}
        />
      )}
    </>
  );
}

function PanelBody({
  head,
  detail,
  loading,
  now,
  dateRef,
  onChangeStatus,
  onSetAppliedAt,
  onDirty,
  onNotesSaved,
}: Pick<Props, "onChangeStatus" | "onSetAppliedAt" | "onDirty" | "onNotesSaved"> & {
  head: JobRow;
  detail: JobDetail | null;
  loading: boolean;
  now: Date | null;
  dateRef: React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <div className="animate-in fade-in duration-200 motion-reduce:animate-none">
      <Section title="Tracking">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Status</label>
            <div>
              <StatusMenu status={head.status} onChange={(to) => onChangeStatus(head.applicationId, to)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="applied-date" className="text-sm font-medium">
              Applied on
            </label>
            {head.appliedAt ? (
              <Input
                id="applied-date"
                ref={dateRef}
                type="date"
                key={head.appliedAt}
                defaultValue={storedToDate(head.appliedAt)}
                onChange={(e) => {
                  const v = e.target.value;
                  if (/^\d{4}-\d{2}-\d{2}$/.test(v) && v !== storedToDate(head.appliedAt)) {
                    onSetAppliedAt(head.applicationId, v);
                  }
                }}
              />
            ) : (
              <p className="text-sm text-muted-foreground">Not applied yet</p>
            )}
          </div>
        </div>
        <NotesEditor
          key={`${head.applicationId}:${detail?.notes ?? "…"}`}
          applicationId={head.applicationId}
          initial={detail?.notes ?? ""}
          ready={Boolean(detail)}
          onDirty={onDirty}
          onSaved={onNotesSaved}
        />
      </Section>

      {loading && !detail ? (
        <div className="space-y-3 border-t p-6">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : detail ? (
        <>
          <Section title="Details">
            <dl className="grid grid-cols-[8rem_1fr] gap-y-1.5 text-sm">
              <dt className="text-muted-foreground">Employment</dt>
              <dd>{detail.employmentType || "—"}</dd>
              <dt className="text-muted-foreground">Posted</dt>
              <dd>{formatDate(detail.postedAt) || "—"}</dd>
              <dt className="text-muted-foreground">Saved</dt>
              <dd>{formatDate(detail.createdAt)}</dd>
              <dt className="text-muted-foreground">Source</dt>
              <dd>
                {sourceLabel(detail.source)}
                {detail.snapshot && <span className="text-muted-foreground"> · fetched via {detail.snapshot.fetchMethod}</span>}
              </dd>
            </dl>
            {detail.technologies.length > 0 && (
              <div className="flex flex-wrap gap-1 pt-1">
                {detail.technologies.map((t) => (
                  <Badge key={t} variant="outline">
                    {t}
                  </Badge>
                ))}
              </div>
            )}
          </Section>

          <Section title="Requirements">
            <p className="text-xs font-medium">Required</p>
            <BulletList items={detail.requirements.required} />
            {detail.requirements.preferred.length > 0 && (
              <>
                <p className="pt-1 text-xs font-medium">Preferred</p>
                <BulletList items={detail.requirements.preferred} />
              </>
            )}
          </Section>

          <Section title="Responsibilities">
            <BulletList items={detail.responsibilities} />
          </Section>

          <CompanySection detail={detail} />

          {detail.keywords.length > 0 && (
            <Section title="Keywords">
              <div className="flex flex-wrap gap-1">
                {detail.keywords.map((k) => (
                  <Badge key={k} variant="secondary">
                    {k}
                  </Badge>
                ))}
              </div>
            </Section>
          )}

          <Section title="Timeline">
            <ol className="space-y-2 text-sm">
              {detail.timeline.map((e) => (
                <li key={e.id} className="flex items-baseline justify-between gap-3">
                  <span className={e.note === "Undo" ? "text-muted-foreground" : undefined}>
                    {e.from && (
                      <>
                        {statusInfo(e.from).label}
                        <ArrowRight className="mx-1 inline size-3.5 align-text-bottom" aria-label="to" />
                      </>
                    )}
                    <strong className="font-medium">{statusInfo(e.to).label}</strong>
                    {e.note && <span className="text-muted-foreground"> ({e.note})</span>}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground" title={new Date(e.at).toISOString()}>
                    {formatDate(e.at)}
                    {now && ` · ${relativeDays(e.at, now)}`}
                  </span>
                </li>
              ))}
            </ol>
          </Section>

          {detail.snapshot && (
            <Section title="Source text">
              <details className="text-sm">
                <summary className="text-muted-foreground hover:text-foreground">
                  Show the text the AI read ({detail.snapshot.rawText.length.toLocaleString("en-US")} characters, fetched{" "}
                  {formatDate(detail.snapshot.fetchedAt)})
                </summary>
                <pre className="mt-2 max-h-96 overflow-auto rounded-md border bg-muted/40 p-3 text-xs whitespace-pre-wrap">
                  {detail.snapshot.rawText}
                </pre>
              </details>
            </Section>
          )}
        </>
      ) : null}
    </div>
  );
}

function CompanySection({ detail }: { detail: JobDetail }) {
  const c = detail.companyProfile;
  const posting = detail.aboutCompany.trim();
  const blocks: [string, string][] = c
    ? [
        ["What they do", c.about],
        ["Mission, values and principles", c.principles],
        ["Culture and ways of working", c.culture],
        ["My notes", c.notes],
      ]
    : [];
  const shown = blocks.filter(([, t]) => t.trim());
  if (!c && !posting) return null;
  return (
    <Section title="Company">
      {c && (
        <p className="text-sm">
          <Link href={`/companies/${c.id}`} className="font-medium underline decoration-foreground/30 underline-offset-2 transition-colors hover:decoration-foreground">
            {c.name}
          </Link>
          <span className="text-muted-foreground"> · company profile (included when you copy as Markdown)</span>
          {c.parent && (
            <span className="text-muted-foreground">
              {" "}
              · part of{" "}
              <Link href={`/companies/${c.parent.id}`} className="underline underline-offset-2">
                {c.parent.name}
              </Link>
            </span>
          )}
        </p>
      )}
      {shown.length === 0 && c && (
        <p className="text-sm text-muted-foreground">No profile written yet. Open the company to add or research one.</p>
      )}
      {shown.map(([h, t]) => (
        <details key={h} className="text-sm">
          <summary className="font-medium hover:text-muted-foreground">{h}</summary>
          <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{t}</p>
        </details>
      ))}
      {posting && posting !== c?.about.trim() && (
        <details className="text-sm">
          <summary className="font-medium hover:text-muted-foreground">As described in this posting</summary>
          <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{posting}</p>
        </details>
      )}
    </Section>
  );
}

function NotesEditor({
  applicationId,
  initial,
  ready,
  onDirty,
  onSaved,
}: {
  applicationId: string;
  initial: string;
  ready: boolean;
  onDirty: (dirty: boolean) => void;
  onSaved: () => void;
}) {
  const [text, setText] = useState(initial);
  const [saving, setSaving] = useState(false);
  const dirty = text !== initial;

  // Tell the table whether closing/navigating would lose edits; clear it when this editor goes away.
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);

  async function save() {
    setSaving(true);
    const res = await saveNotesAction(applicationId, text);
    setSaving(false);
    if (!res.ok) return void toast.error(res.error);
    toast.success("Notes saved");
    onSaved();
  }

  return (
    <div className="space-y-1.5">
      <label htmlFor="notes" className="text-sm font-medium">
        Notes
      </label>
      <Textarea
        id="notes"
        rows={5}
        value={text}
        disabled={!ready}
        maxLength={MAX_NOTES}
        placeholder="Recruiter name, interview prep, follow-up ideas…"
        onChange={(e) => setText(e.target.value)}
      />
      <div className="flex items-center justify-between">
        <span
          key={dirty ? "dirty" : "clean"}
          className={cn(
            "text-xs animate-in fade-in duration-200 motion-reduce:animate-none",
            dirty ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground",
          )}
        >
          {dirty ? "Unsaved changes" : ready && initial ? "Saved" : ""}
        </span>
        <Button size="sm" onClick={() => void save()} disabled={!dirty} loading={saving}>
          Save notes
        </Button>
      </div>
    </div>
  );
}
