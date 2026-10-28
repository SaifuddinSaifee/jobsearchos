"use client";

import { Check, ChevronDown, CircleAlert, Loader2, RotateCcw, Shrink, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  applyCompactionAction,
  dismissCompactionAction,
  retryCompactionAction,
  saveCompactionAnswersAction,
  startCompactionAction,
} from "@/app/(app)/library/record/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapse } from "@/components/ui/collapse";
import type { OpenCompaction } from "@/lib/career/compaction";
import type { CompactionAnswers, CompactionResult } from "@/lib/career/compact-schema";
import { factLine } from "@/lib/career/facts";
import { cn } from "@/lib/utils";

/** How often the page checks on a tidy being worked out. */
const POLL_MS = 4000;

const kb = (chars: number) => `${Math.max(1, Math.round(chars / 1024))} KB`;

/**
 * Tidying the record: folds the wordings of each fact into one statement and its details, keeps one wording per
 * framing, and takes out repeats. Worked out in the background, then reviewed here before anything is saved.
 */
export function RecordTidy({ compaction }: { compaction: OpenCompaction | null }) {
  const router = useRouter();
  const [starting, startStart] = useTransition();
  const busy = compaction?.status === "queued" || compaction?.status === "running";

  // Checks back while it is being worked out; the page's data then shows it ready.
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => router.refresh(), POLL_MS);
    return () => clearInterval(t);
  }, [busy, router]);

  const start = (retryId?: string) =>
    startStart(async () => {
      const res = retryId ? await retryCompactionAction(retryId) : await startCompactionAction();
      if (!res.ok) toast.error(res.error);
      router.refresh();
    });

  if (!compaction) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm animate-in fade-in duration-300 motion-reduce:animate-none">
        <p className="max-w-xl text-muted-foreground">
          Each fact keeps one statement, the details it states and one wording per framing. Repeated wordings are folded in and
          kept as sources. You review it before anything changes.
        </p>
        <Button variant="outline" loading={starting} onClick={() => start()}>
          <Shrink aria-hidden />
          Tidy the record
        </Button>
      </div>
    );
  }

  if (compaction.status === "queued" || compaction.status === "running") {
    return (
      <p key="busy" className="flex items-center gap-2 text-sm text-muted-foreground animate-in fade-in duration-300 motion-reduce:animate-none" aria-live="polite">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        {compaction.status === "queued" ? "Tidy queued, starting soon" : "Tidying your record. This takes a few minutes; you can leave this page."}
      </p>
    );
  }

  if (compaction.status === "failed") {
    return (
      <div key="failed" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm animate-in fade-in duration-300 motion-reduce:animate-none">
        <p className="flex items-center gap-2">
          <CircleAlert className="size-4 text-destructive" aria-hidden />
          The tidy could not finish: {compaction.error}
        </p>
        <div className="flex gap-2">
          <DismissButton id={compaction.id} label="Dismiss" />
          <Button variant="outline" loading={starting} onClick={() => start(compaction.id)}>
            <RotateCcw aria-hidden />
            Try again
          </Button>
        </div>
      </div>
    );
  }

  return <TidyReview key={compaction.id} id={compaction.id} result={compaction.result} saved={compaction.answers} />;
}

function DismissButton({ id, label }: { id: string; label: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      loading={pending}
      onClick={() =>
        start(async () => {
          const res = await dismissCompactionAction(id);
          if (!res.ok) toast.error(res.error);
          router.refresh();
        })
      }
    >
      <X aria-hidden />
      {label}
    </Button>
  );
}

function TidyReview({ id, result, saved }: { id: string; result: CompactionResult; saved: CompactionAnswers }) {
  const router = useRouter();
  const [answers, setAnswers] = useState<CompactionAnswers>(saved);
  const [applying, startApply] = useTransition();
  const facts = result.roles.reduce((n, r) => [n[0] + r.factsBefore, n[1] + r.factsAfter], [0, 0]);
  const wordings = result.roles.reduce((n, r) => [n[0] + r.wordingsBefore, n[1] + r.wordingsAfter], [0, 0]);
  const { cleanup } = result;
  const repeats = [
    cleanup.skills.before > cleanup.skills.after && `${cleanup.skills.before - cleanup.skills.after} repeated skills`,
    cleanup.education.before > cleanup.education.after && `${cleanup.education.before - cleanup.education.after} repeated schools`,
    cleanup.certifications.before > cleanup.certifications.after && `${cleanup.certifications.before - cleanup.certifications.after} repeated certifications`,
    cleanup.achievements.before > cleanup.achievements.after && `${cleanup.achievements.before - cleanup.achievements.after} repeated achievements`,
    cleanup.technologyLines > 0 && `${cleanup.technologyLines} "Technologies" lines moved to their role`,
  ].filter(Boolean);

  const answer = (questionId: string, detailId: string) => {
    const next = { ...answers, [questionId]: detailId };
    setAnswers(next);
    void saveCompactionAnswersAction(id, next).then((res) => {
      if (!res.ok) toast.error(res.error);
    });
  };

  const apply = () =>
    startApply(async () => {
      const res = await applyCompactionAction(id, answers);
      if (res.ok) toast.success(`Record tidied, saved as version ${res.version}`);
      else toast.error(res.error);
      router.refresh();
    });

  const open = result.questions.filter((q) => !answers[q.id]).length;

  return (
    <section className="space-y-4 rounded-lg border px-4 py-4 animate-in fade-in slide-in-from-bottom-1 duration-300 motion-reduce:animate-none" aria-label="Tidied record, waiting for review">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="font-medium">Your tidied record is ready to review</p>
          <p className="text-sm text-muted-foreground">
            {facts[0]} facts became {facts[1]}, and {wordings[0]} wordings became {wordings[1]}. The export goes from {kb(result.size.before)} to{" "}
            {kb(result.size.after)}.{repeats.length > 0 && ` Also taken out: ${repeats.join(", ")}.`}
          </p>
        </div>
        <div className="flex gap-2">
          <DismissButton id={id} label="Leave as it is" />
          <Button loading={applying} onClick={apply}>
            <Check aria-hidden />
            Apply
          </Button>
        </div>
      </div>

      {result.questions.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm font-medium">
            Numbers that disagree{" "}
            <span className="font-normal text-muted-foreground">
              ({open === 0 ? "all answered" : `${open} to answer; unanswered ones keep every value`})
            </span>
          </p>
          <ul className="space-y-3">
            {result.questions.map((q) => (
              <li key={q.id} className="space-y-2 rounded-md bg-muted/40 px-3 py-2 text-sm">
                <p>
                  <span className="text-muted-foreground">{q.where}:</span> which value for <span className="font-medium">{q.measures}</span> is right?
                </p>
                <p className="text-xs text-muted-foreground">{q.fact}</p>
                <div className="flex flex-wrap gap-2" role="group" aria-label={`Value for ${q.measures}`}>
                  {q.options.map((o) => {
                    const chosen = answers[q.id] === o.detailId;
                    return (
                      <Button key={o.detailId} size="sm" variant={chosen ? "default" : "outline"} aria-pressed={chosen} onClick={() => answer(q.id, o.detailId)}>
                        {chosen && <Check aria-hidden />}
                        {o.text}
                      </Button>
                    );
                  })}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <ul className="divide-y rounded-md border">
        {result.roles.map((r) => (
          <PartRow key={r.id} result={result} part={r} />
        ))}
        {result.projects
          .filter((p) => p.wordingsBefore !== p.wordingsAfter)
          .map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <span>{p.label}</span>
              <span className="text-muted-foreground tabular-nums">
                {p.wordingsBefore} bullets became {p.wordingsAfter}
              </span>
            </li>
          ))}
      </ul>
    </section>
  );
}

/** One role: how much it shrank, and its facts as they will read, opened on request. */
function PartRow({ result, part }: { result: CompactionResult; part: CompactionResult["roles"][number] }) {
  const [open, setOpen] = useState(false);
  const role = result.record.employers.flatMap((e) => e.roles).find((r) => r.id === part.id);
  const unwritten = new Set(result.unwritten.map((u) => u.factId));
  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors duration-150 hover:bg-muted/50"
      >
        <span>{part.label}</span>
        <span className="flex items-center gap-2 text-muted-foreground tabular-nums">
          {part.factsBefore} facts became {part.factsAfter}
          <ChevronDown className={cn("size-4 transition-transform duration-200 motion-reduce:transition-none", open && "rotate-180")} aria-hidden />
        </span>
      </button>
      <Collapse open={open}>
        <ul className="space-y-3 px-3 pb-3 text-sm">
          {role?.facts.map((f) => (
            <li key={f.id} className="space-y-1">
              <p>{factLine(f)}</p>
              {unwritten.has(f.id) && <p className="text-xs text-muted-foreground">No statement could be written, so this shows its first wording.</p>}
              {f.details.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {f.details.map((d) => (
                    <Badge key={d.id} variant={d.kind === "metric" ? "secondary" : "outline"} className="font-normal">
                      {d.text}
                    </Badge>
                  ))}
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                {f.wordings.length} {f.wordings.length === 1 ? "wording" : "wordings"} kept, from {f.sources.length} {f.sources.length === 1 ? "source" : "sources"}
              </p>
            </li>
          ))}
        </ul>
      </Collapse>
    </li>
  );
}
