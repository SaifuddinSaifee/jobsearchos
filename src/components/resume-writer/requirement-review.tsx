"use client";

import { ChevronDown, Quote } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapse } from "@/components/ui/collapse";
import { Input } from "@/components/ui/input";
import { assumeQualified, matchScore, REQUIREMENT_KIND_LABEL, REQUIREMENT_KINDS, REQUIREMENT_USE_LABEL, requirementUse, type GenerationItem, type Requirement, type ReviewAnswer } from "@/lib/resume-writer/types";
import { cn } from "@/lib/utils";

const MAX_NOTE = 200;

type Answers = Record<string, { userHas: boolean; note: string }>;

const CHIP: Record<Requirement["verdict"], { label: string; className: string }> = {
  met: { label: "In your record", className: "text-green-700 dark:text-green-400" },
  partial: { label: "Partly in your record", className: "text-amber-700 dark:text-amber-400" },
  missing: { label: "Not in your record", className: "text-muted-foreground" },
};

/**
 * What the job asks for, lined up against the career record, before the resume is written. The user can say "I have
 * this" for anything the record does not show (with a note), and sees what share of the job they cover as they do.
 */
export function RequirementReview({
  generation,
  submitting,
  onSubmit,
}: {
  generation: GenerationItem;
  submitting: boolean;
  onSubmit: (answers: ReviewAnswer[], skipReviewNextTime: boolean) => void;
}) {
  // The candidate is taken to be qualified: whatever the record does not show of the must-haves and nice-to-haves starts
  // out as something they have, and they untick what they do not. Keywords are their pick, so they start unticked.
  const [answers, setAnswers] = useState<Answers>(() => Object.fromEntries(assumeQualified(generation.requirements).map((r) => [r.id, { userHas: r.userHas, note: r.note }])));
  const [skipNext, setSkipNext] = useState(false);

  const live = useMemo(() => generation.requirements.map((r) => ({ ...r, userHas: answers[r.id]?.userHas ?? r.userHas })), [generation.requirements, answers]);
  const percent = Math.round(matchScore(live) * 100);
  const recordPercent = Math.round(matchScore(generation.requirements.map((r) => ({ ...r, userHas: false }))) * 100);
  const fromBase = generation.source === "base_resume";
  const set = (id: string, patch: Partial<Answers[string]>) => setAnswers((a) => ({ ...a, [id]: { ...(a[id] ?? { userHas: false, note: "" }), ...patch } }));

  return (
    <section aria-labelledby="review-heading" className="space-y-4 animate-in fade-in duration-200 motion-reduce:animate-none">
      <div className="space-y-1">
        <h3 id="review-heading" className="text-base font-medium">
          What this job asks for
        </h3>
        <p className="text-sm text-muted-foreground">
          Matched against {fromBase ? "your base resume" : `your career record (version ${generation.recordVersion})`}. What the{" "}
          {fromBase ? "resume" : "record"} does not show of the experience and skills the job asks for is ticked as something you have, and is
          worked into the resume. Untick what you would rather leave out, tick the keywords you want in, and add a note where it helps.
        </p>
        {generation.notes.map((n) => (
          <p key={n} className="text-sm text-muted-foreground">
            {n}
          </p>
        ))}
      </div>

      {[...REQUIREMENT_KINDS.map((kind) => ({ key: kind, title: REQUIREMENT_KIND_LABEL[kind], items: live.filter((r) => r.kind === kind && r.use !== "logistics") })), { key: "logistics", title: "Conditions", items: live.filter((r) => r.use === "logistics") }].map(
        ({ key, title, items }) =>
          items.length === 0 ? null : (
            <div key={key} className="space-y-1">
              <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</h4>
              {key === "logistics" && (
                <p className="text-xs text-muted-foreground">
                  Conditions of the job, not experience. They do not count toward the match. Tick one to mention it in a short line at the end of the summary.
                </p>
              )}
              <ul className="divide-y rounded-lg border">
                {items.map((r) => (
                  <RequirementRow key={r.id} r={r} answer={answers[r.id] ?? { userHas: r.userHas, note: r.note }} onChange={(patch) => set(r.id, patch)} />
                ))}
              </ul>
            </div>
          ),
      )}

      <div className="sticky bottom-0 -mx-1 flex flex-wrap items-center gap-3 border-t bg-background/95 px-1 py-3 backdrop-blur">
        <Button
          loading={submitting}
          onClick={() =>
            onSubmit(
              generation.requirements.map((r) => ({ id: r.id, userHas: answers[r.id]?.userHas ?? false, note: answers[r.id]?.note ?? "" })),
              skipNext,
            )
          }
        >
          Write resume
        </Button>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <Checkbox checked={skipNext} onCheckedChange={(c) => setSkipNext(c === true)} />
          Don&apos;t show this step again
        </label>
        <span className="ml-auto text-sm text-muted-foreground tabular-nums" aria-live="polite">
          {fromBase ? "Your resume" : "Your record"} covers {recordPercent}%. With what you have: {percent}%
        </span>
      </div>
    </section>
  );
}

function RequirementRow({ r, answer, onChange }: { r: Requirement; answer: Answers[string]; onChange: (patch: Partial<Answers[string]>) => void }) {
  const [open, setOpen] = useState(false);
  const logistics = r.use === "logistics";
  const chip = logistics ? (answer.userHas ? { label: "Mentioned", className: "text-primary" } : { label: "Not mentioned", className: "text-muted-foreground" }) : answer.userHas ? { label: "You have this", className: "text-primary" } : CHIP[r.verdict];
  const useLabel = r.kind === "keyword" ? REQUIREMENT_USE_LABEL[requirementUse(r)] : null;
  const hasEvidence = r.evidence.length > 0;
  return (
    <li className="space-y-2 px-3 py-2.5 text-sm transition-colors duration-150 hover:bg-muted/40">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
        <Badge variant="outline" className={cn("shrink-0", chip.className)}>
          {chip.label}
        </Badge>
        <p className="min-w-0 flex-1">
          {r.text}
          {useLabel && <span className="ml-2 text-xs text-muted-foreground">{useLabel}</span>}
        </p>
        {hasEvidence && (
          <Button size="xs" variant="ghost" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            <ChevronDown className={cn("transition-transform duration-200 motion-reduce:transition-none", open && "rotate-180")} aria-hidden />
            From your record
          </Button>
        )}
      </div>
      {hasEvidence && (
        <Collapse open={open}>
          <ul className="space-y-1 pb-1 pl-1">
            {r.evidence.map((e) => (
              <li key={e} className="flex items-start gap-2 text-xs text-muted-foreground">
                <Quote className="mt-0.5 size-3 shrink-0" aria-hidden />
                {e}
              </li>
            ))}
          </ul>
        </Collapse>
      )}
      {logistics && (
        <label className="flex cursor-pointer items-center gap-2">
          <Checkbox checked={answer.userHas} onCheckedChange={(c) => onChange({ userHas: c === true })} />
          Mention it on the resume
        </label>
      )}
      {r.verdict !== "met" && !logistics && (
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex cursor-pointer items-center gap-2">
            <Checkbox checked={answer.userHas} onCheckedChange={(c) => onChange({ userHas: c === true })} />
            I have this
          </label>
          <Collapse open={answer.userHas} className="min-w-0 flex-1">
            <Input
              value={answer.note}
              maxLength={MAX_NOTE}
              placeholder="Optional note, for example: AWS certified, 2023"
              aria-label={`Note for: ${r.text}`}
              onChange={(e) => onChange({ note: e.target.value })}
            />
          </Collapse>
        </div>
      )}
    </li>
  );
}
