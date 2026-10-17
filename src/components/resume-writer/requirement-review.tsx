"use client";

import { ChevronDown, Plus, Quote } from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapse } from "@/components/ui/collapse";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import {
  assumeQualified,
  matchScore,
  REQUIREMENT_KIND_LABEL,
  REQUIREMENT_KINDS,
  REQUIREMENT_USE_LABEL,
  requirementUse,
  type GenerationChoices,
  type GenerationItem,
  type NumberClash,
  type Requirement,
  type ReviewAnswer,
  type RoleOption,
} from "@/lib/resume-writer/types";
import { cn } from "@/lib/utils";

const MAX_NOTE = 200;

type Answers = Record<string, { userHas: boolean; note: string }>;

const CHIP: Record<Requirement["verdict"], { label: string; className: string }> = {
  met: { label: "In your record", className: "text-green-700 dark:text-green-400" },
  partial: { label: "Partly in your record", className: "text-amber-700 dark:text-amber-400" },
  missing: { label: "Not in your record", className: "text-muted-foreground" },
};

/**
 * What the job asks for, lined up against the career record, before the resume is written. The user picks the telling
 * of each role (the recommended one is preselected) and the number to use where the record disagrees with itself, can
 * say "I have this" for anything the record does not show (with a note), adds detail to the job's core, and sees what
 * share of the job they cover as they do.
 */
export function RequirementReview({
  generation,
  submitting,
  onSubmit,
}: {
  generation: GenerationItem;
  submitting: boolean;
  onSubmit: (answers: ReviewAnswer[], skipReviewNextTime: boolean, choices: GenerationChoices) => void;
}) {
  // The candidate is taken to be qualified: whatever the record does not show of the must-haves and nice-to-haves starts
  // out as something they have, and they untick what they do not. Keywords are their pick, so they start unticked.
  const [answers, setAnswers] = useState<Answers>(() => Object.fromEntries(assumeQualified(generation.requirements).map((r) => [r.id, { userHas: r.userHas, note: r.note }])));
  const { roles, clashes } = generation.reviewOptions;
  const [framings, setFramings] = useState<Record<string, string>>(() => Object.fromEntries(roles.map((r) => [r.roleId, generation.choices.framings[r.roleId] ?? r.recommended])));
  const [wordings, setWordings] = useState<Record<string, string>>(() => Object.fromEntries(clashes.map((c) => [c.factId, generation.choices.wordings[c.factId] ?? c.recommended])));
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

      {roles.length > 0 && <RoleChoices roles={roles} value={framings} onChange={(roleId, framingId) => setFramings((f) => ({ ...f, [roleId]: framingId }))} />}
      {clashes.length > 0 && <ClashChoices clashes={clashes} value={wordings} onChange={(factId, wordingId) => setWordings((w) => ({ ...w, [factId]: wordingId }))} />}

      {[...REQUIREMENT_KINDS.map((kind) => ({ key: kind, title: REQUIREMENT_KIND_LABEL[kind], items: live.filter((r) => r.kind === kind && r.use !== "logistics") })), { key: "logistics", title: "Conditions", items: live.filter((r) => r.use === "logistics") }].map(
        ({ key, title, items }) =>
          items.length === 0 ? null : (
            <div key={key} className="space-y-1">
              <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</h4>
              {key === "logistics" && (
                <p className="text-xs text-muted-foreground">
                  Conditions of the job, not experience. They do not count toward the match. Tick one to state it in the resume&apos;s header, next to your contact details, and say how you meet it.
                </p>
              )}
              {key === "company" && <p className="text-xs text-muted-foreground">The company&apos;s own words. They set the tone of the resume and are never claimed as yours.</p>}
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
              { framings, wordings },
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

/** The telling of each role told more than one way, with the one that proves the most for this job preselected. */
function RoleChoices({ roles, value, onChange }: { roles: RoleOption[]; value: Record<string, string>; onChange: (roleId: string, framingId: string) => void }) {
  return (
    <div className="space-y-1">
      <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Write each role as</h4>
      <p className="text-xs text-muted-foreground">Your record tells these roles more than one way. The recommended one fits this job&apos;s title and proves the most of what it asks for.</p>
      <ul className="divide-y rounded-lg border">
        {roles.map((r) => (
          <li key={r.roleId} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 text-sm transition-colors duration-150 hover:bg-muted/40">
            <label htmlFor={`framing-${r.roleId}`} className="min-w-0 flex-1 font-medium">
              {r.label}
            </label>
            <NativeSelect id={`framing-${r.roleId}`} size="sm" className="w-full sm:w-72" value={value[r.roleId] ?? r.recommended} onChange={(e) => onChange(r.roleId, e.target.value)}>
              {r.framings.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.id === r.recommended ? `${f.title} (recommended)` : f.title}
                </option>
              ))}
            </NativeSelect>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A line with its numbers in bold, so the difference between two versions of it reads at a glance. */
function WithNumbers({ text, numbers }: { text: string; numbers: string[] }) {
  const wanted = new Set(numbers);
  return (
    <>
      {text.split(/(\d[\d,]*(?:\.\d+)?%?)/).map((part, i) =>
        wanted.has(part.replace(/[,%]/g, "").replace(/\.0+$/, "")) ? (
          <strong key={i} className="font-semibold text-foreground">
            {part}
          </strong>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}

/** Where the record gives two numbers for the same result: the user picks the one the resume uses, the recommended one first. */
function ClashChoices({ clashes, value, onChange }: { clashes: NumberClash[]; value: Record<string, string>; onChange: (factId: string, wordingId: string) => void }) {
  return (
    <div className="space-y-1">
      <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Your record says this more than one way</h4>
      <p className="text-xs text-muted-foreground">These lines give different numbers for the same result. Pick the one this resume should use; it is remembered for your next resumes.</p>
      <ul className="divide-y rounded-lg border">
        {clashes.map((c) => (
          <li key={c.factId} className="px-3 py-2.5 text-sm">
            <fieldset className="space-y-2">
              <legend className="mb-2 font-medium">
                {c.where}: {c.measure}
              </legend>
              {c.options.map((o) => {
                const recommended = o.wordingId === c.recommended;
                const checked = value[c.factId] === o.wordingId;
                return (
                  <label
                    key={o.wordingId}
                    className={cn(
                      "flex cursor-pointer items-start gap-2.5 rounded-md border px-2.5 py-2 transition-colors duration-150 hover:bg-muted/40",
                      checked ? "border-primary/60 bg-primary/5" : "border-transparent",
                    )}
                  >
                    <input
                      type="radio"
                      name={`clash-${c.factId}`}
                      value={o.wordingId}
                      checked={checked}
                      onChange={() => onChange(c.factId, o.wordingId)}
                      className="mt-0.5 size-4 shrink-0 accent-primary"
                    />
                    <span className="min-w-0 flex-1 space-y-1">
                      <span className="block text-xs text-muted-foreground">
                        <WithNumbers text={o.text} numbers={o.numbers} />
                      </span>
                      <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        {recommended && (
                          <Badge variant="outline" className="text-primary">
                            Recommended
                          </Badge>
                        )}
                        {recommended ? c.reason : `${o.count} ${o.count === 1 ? "version says" : "versions say"} it this way.`}
                      </span>
                    </span>
                  </label>
                );
              })}
            </fieldset>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RequirementRow({ r, answer, onChange }: { r: Requirement; answer: Answers[string]; onChange: (patch: Partial<Answers[string]>) => void }) {
  const [open, setOpen] = useState(false);
  const logistics = r.use === "logistics";
  const company = r.kind === "company";
  const core = !!r.core && !logistics && !company;
  // Only the skills list has it: the record names it but never tells of work with it, so the resume can only list it.
  const listedOnly = !!r.skillsOnly && r.verdict === "met" && !logistics && !company;
  // Detail on what the record already shows makes the resume more believable; for the job's core, and for what only the
  // skills list has, the field is open.
  const [adding, setAdding] = useState(core || listedOnly || answer.note !== "");
  const chip = logistics
    ? answer.userHas
      ? { label: "Mentioned", className: "text-primary" }
      : { label: "Not mentioned", className: "text-muted-foreground" }
    : company
      ? { label: "For tone", className: "text-muted-foreground" }
      : answer.userHas
        ? { label: "You have this", className: "text-primary" }
        : listedOnly
          ? { label: "Only in your skills", className: "text-amber-700 dark:text-amber-400" }
          : CHIP[r.verdict];
  const useLabel = r.kind === "keyword" ? REQUIREMENT_USE_LABEL[requirementUse(r)] : null;
  const hasEvidence = r.evidence.length > 0;
  const placeholder = listedOnly
    ? `Anything you have built with ${r.text}? Say where, and the resume shows it as work`
    : core
      ? "One line on how you do this makes the resume more believable"
      : "Optional note, for example: AWS certified, 2023";
  const noteInput = (label: string, hint = placeholder) => (
    <Input value={answer.note} maxLength={MAX_NOTE} placeholder={hint} aria-label={`${label}: ${r.text}`} onChange={(e) => onChange({ note: e.target.value })} />
  );
  return (
    <li className="space-y-2 px-3 py-2.5 text-sm transition-colors duration-150 hover:bg-muted/40">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
        <Badge variant="outline" className={cn("shrink-0", chip.className)}>
          {chip.label}
        </Badge>
        {core && (
          <Badge variant="secondary" className="shrink-0">
            Core
          </Badge>
        )}
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
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex cursor-pointer items-center gap-2">
            <Checkbox checked={answer.userHas} onCheckedChange={(c) => onChange({ userHas: c === true })} />
            Mention it on the resume
          </label>
          <Collapse open={answer.userHas} className="min-w-0 flex-1">
            {noteInput("How you meet it", "How you meet it, for example: relocating to Toronto")}
          </Collapse>
        </div>
      )}
      {r.verdict !== "met" && !logistics && !company && (
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex cursor-pointer items-center gap-2">
            <Checkbox checked={answer.userHas} onCheckedChange={(c) => onChange({ userHas: c === true })} />
            I have this
          </label>
          <Collapse open={answer.userHas} className="min-w-0 flex-1">
            {noteInput("Note")}
          </Collapse>
          {/* A claim with no detail can only be listed; a line on where it happened lets the resume show it as work. */}
          <Collapse open={answer.userHas && answer.note.trim() === ""} className="basis-full">
            <p className="text-xs text-muted-foreground">With no note this is listed in your skills only. Say where you did it and the resume shows it as work.</p>
          </Collapse>
        </div>
      )}
      {r.verdict === "met" && !logistics && !company && (
        <div className="flex flex-wrap items-center gap-3">
          {!adding && (
            <Button size="xs" variant="ghost" onClick={() => setAdding(true)}>
              <Plus aria-hidden />
              Add detail
            </Button>
          )}
          <Collapse open={adding} className="min-w-0 flex-1">
            {noteInput("Detail")}
          </Collapse>
          {listedOnly && (
            <Collapse open={answer.note.trim() === ""} className="basis-full">
              <p className="text-xs text-muted-foreground">Your record lists this as a skill but tells of no work with it, so the resume can only list it. Optional.</p>
            </Collapse>
          )}
        </div>
      )}
    </li>
  );
}
