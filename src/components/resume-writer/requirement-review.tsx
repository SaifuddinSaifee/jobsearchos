"use client";

import { ChevronDown, ChevronRight, CircleCheck, CircleDashed, CircleDotDashed, Plus, Quote, type LucideIcon } from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapse } from "@/components/ui/collapse";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  assumeQualified,
  matchScore,
  REQUIREMENT_KIND_LABEL,
  REQUIREMENT_USE_LABEL,
  requirementUse,
  type GenerationChoices,
  type GenerationItem,
  type NumberClash,
  type Requirement,
  type ReviewAnswer,
  type RoleOption,
  type Verdict,
} from "@/lib/resume-writer/types";
import { cn } from "@/lib/utils";

const MAX_NOTE = 200;

type Answers = Record<string, { userHas: boolean; note: string }>;

/**
 * The requirements are split by what the record shows of them, gaps first: that is where the decisions are. What the
 * record already has only takes an optional detail, so it sits in its own tab.
 */
const VERDICT_TABS: { verdict: Verdict; label: string; short: string; icon: LucideIcon; iconClass: string; hint: string; empty: string }[] = [
  {
    verdict: "missing",
    label: "Not in your record",
    short: "Not in record",
    icon: CircleDashed,
    iconClass: "text-muted-foreground",
    hint: "Your record does not show these. Ticked ones go into the resume as yours: experience and skills start ticked, keywords are your pick.",
    empty: "Your record shows something of everything this job asks for.",
  },
  {
    verdict: "partial",
    label: "Partly in your record",
    short: "Partly",
    icon: CircleDotDashed,
    iconClass: "text-amber-600 dark:text-amber-400",
    hint: "Your record shows some of these. Ticked ones are filled out in the resume; From your record shows what it already says.",
    empty: "Nothing the job asks for is only partly in your record.",
  },
  {
    verdict: "met",
    label: "In your record",
    short: "In record",
    icon: CircleCheck,
    iconClass: "text-green-600 dark:text-green-400",
    hint: "Already in your record, so nothing to decide. Add detail where one line would make the resume more believable.",
    empty: "Nothing the job asks for is fully in your record yet.",
  },
];

/** The lists the tabs group by. The company's own words and the job's conditions are not matched, so they sit below the tabs. */
const MATCHED_KINDS = ["must", "nice", "keyword"] as const;

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

  // Split by what the record shows, not by the ticks, so an item stays in its tab while the user works on it. The job's
  // core comes first in each list.
  const matched = live.filter((r) => r.use !== "logistics" && r.kind !== "company").sort((a, b) => Number(!!b.core) - Number(!!a.core));
  const byVerdict = { missing: matched.filter((r) => r.verdict === "missing"), partial: matched.filter((r) => r.verdict === "partial"), met: matched.filter((r) => r.verdict === "met") };
  const [defaultTab] = useState<Verdict>(() => VERDICT_TABS.find((t) => byVerdict[t.verdict].length > 0)?.verdict ?? "missing");
  const conditions = live.filter((r) => r.use === "logistics");
  const company = live.filter((r) => r.kind === "company" && r.use !== "logistics");
  const row = (r: Requirement) => <RequirementRow key={r.id} r={r} answer={answers[r.id] ?? { userHas: r.userHas, note: r.note }} onChange={(patch) => set(r.id, patch)} />;

  return (
    <section aria-labelledby="review-heading" className="space-y-4 animate-in fade-in duration-200 motion-reduce:animate-none">
      <div className="space-y-1">
        <h3 id="review-heading" className="text-base font-medium">
          What this job asks for
        </h3>
        <p className="text-sm text-muted-foreground">
          Matched against {fromBase ? "your base resume" : `your career record (version ${generation.recordVersion})`}. Ticked items go into the resume
          as yours; a note on where you did it turns a listed skill into work.
        </p>
        {generation.notes.map((n) => (
          <p key={n} className="text-sm text-muted-foreground">
            {n}
          </p>
        ))}
      </div>

      {roles.length > 0 && <RoleChoices roles={roles} value={framings} onChange={(roleId, framingId) => setFramings((f) => ({ ...f, [roleId]: framingId }))} />}
      {clashes.length > 0 && <ClashChoices clashes={clashes} value={wordings} onChange={(factId, wordingId) => setWordings((w) => ({ ...w, [factId]: wordingId }))} />}

      <Tabs defaultValue={defaultTab}>
        <TabsList className="w-full sm:w-fit">
          {VERDICT_TABS.map((t) => (
            <TabsTrigger key={t.verdict} value={t.verdict} className="px-2.5">
              <t.icon className={cn("size-4", t.iconClass)} aria-hidden />
              <span className="sm:hidden">{t.short}</span>
              <span className="hidden sm:inline">{t.label}</span>
              <span className="text-xs text-muted-foreground tabular-nums">{byVerdict[t.verdict].length}</span>
            </TabsTrigger>
          ))}
        </TabsList>
        {VERDICT_TABS.map((t) => {
          const items = byVerdict[t.verdict];
          return (
            <TabsContent key={t.verdict} value={t.verdict} className="space-y-4 pt-2">
              {items.length === 0 ? (
                <p className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">{t.empty}</p>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground">{t.hint}</p>
                  {MATCHED_KINDS.map((kind) => {
                    const group = items.filter((r) => r.kind === kind);
                    return group.length === 0 ? null : (
                      <div key={kind} className="space-y-1.5">
                        <h4 className="flex items-center gap-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                          {REQUIREMENT_KIND_LABEL[kind]}
                          <span className="tabular-nums">{group.length}</span>
                        </h4>
                        <ul className="divide-y rounded-lg border">{group.map(row)}</ul>
                      </div>
                    );
                  })}
                </>
              )}
            </TabsContent>
          );
        })}
      </Tabs>

      {(conditions.length > 0 || company.length > 0) && (
        <div className="space-y-2">
          {conditions.length > 0 && (
            <FoldedSection
              title="Conditions"
              count={conditions.length}
              summary="Not counted in the match"
              hint="Conditions of the job, not experience. Tick one to state it in the resume's header, next to your contact details, and say how you meet it."
              defaultOpen={conditions.some((r) => r.userHas)}
            >
              {conditions.map(row)}
            </FoldedSection>
          )}
          {company.length > 0 && (
            <FoldedSection
              title="From the company"
              count={company.length}
              summary="Sets the tone, never claimed as yours"
              hint="The company's own words. They set the tone of the resume and are never claimed as yours."
            >
              {company.map(row)}
            </FoldedSection>
          )}
        </div>
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

/** A part of the posting that is not matched against the record, folded away until the user wants it. */
function FoldedSection({
  title,
  count,
  summary,
  hint,
  defaultOpen = false,
  children,
}: {
  title: string;
  count: number;
  summary: string;
  hint: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-lg border">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors duration-150 outline-none hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50 active:bg-muted/60"
      >
        <ChevronRight className={cn("size-4 shrink-0 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none", open && "rotate-90")} aria-hidden />
        {title}
        <span className="text-xs text-muted-foreground tabular-nums">{count}</span>
        <span className="ml-auto hidden truncate text-xs font-normal text-muted-foreground sm:block">{summary}</span>
      </button>
      <Collapse open={open}>
        <div className="border-t">
          <p className="px-3 pt-2.5 pb-1 text-xs text-muted-foreground">{hint}</p>
          <ul className="divide-y">{children}</ul>
        </div>
      </Collapse>
    </div>
  );
}

/**
 * One requirement as a checklist line. The tab it sits in says what the record shows, so the row only carries what
 * differs between items: the tick (or Add detail, for what the record has), Core, and Only in your skills.
 */
function RequirementRow({ r, answer, onChange }: { r: Requirement; answer: Answers[string]; onChange: (patch: Partial<Answers[string]>) => void }) {
  const [open, setOpen] = useState(false);
  const logistics = r.use === "logistics";
  const company = r.kind === "company";
  const core = !!r.core && !logistics && !company;
  // Only the skills list has it: the record names it but never tells of work with it, so the resume can only list it.
  const listedOnly = !!r.skillsOnly && r.verdict === "met" && !logistics && !company;
  // A gap is ticked as "I have this"; a condition is ticked to be mentioned. What the record has takes a detail instead.
  const tickable = logistics || (r.verdict !== "met" && !company);
  const detailable = r.verdict === "met" && !logistics && !company;
  // Detail on what the record already shows makes the resume more believable; for the job's core, and for what only the
  // skills list has, the field is open.
  const [adding, setAdding] = useState(core || listedOnly || answer.note !== "");
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
  const text = (
    <span className="min-w-0 flex-1">
      {r.text}
      {(core || listedOnly || useLabel) && (
        <span className="ml-2 inline-flex flex-wrap items-center gap-1.5 align-middle">
          {core && <Badge variant="secondary">Core</Badge>}
          {listedOnly && (
            <Badge variant="outline" className="text-amber-700 dark:text-amber-400">
              Only in your skills
            </Badge>
          )}
          {useLabel && <span className="text-xs text-muted-foreground">{useLabel}</span>}
        </span>
      )}
    </span>
  );
  return (
    <li className="px-3 py-2.5 text-sm transition-colors duration-150 hover:bg-muted/40">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
        {tickable ? (
          // An unticked item is dimmed, so what goes into the resume reads at a glance.
          <label className={cn("flex min-w-0 flex-1 cursor-pointer items-start gap-3 transition-colors duration-150", !answer.userHas && "text-muted-foreground")}>
            <Checkbox className="mt-0.5" checked={answer.userHas} onCheckedChange={(c) => onChange({ userHas: c === true })} />
            <span className="sr-only">{logistics ? "Mention on the resume:" : "I have this:"}</span>
            {text}
          </label>
        ) : (
          <p className="flex min-w-0 flex-1">{text}</p>
        )}
        {(hasEvidence || (detailable && !adding)) && (
          <div className="ml-auto flex shrink-0 items-center gap-1">
            {detailable && !adding && (
              <Button size="xs" variant="ghost" onClick={() => setAdding(true)}>
                <Plus aria-hidden />
                Add detail
              </Button>
            )}
            {hasEvidence && (
              <Button size="xs" variant="ghost" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
                <ChevronDown className={cn("transition-transform duration-200 motion-reduce:transition-none", open && "rotate-180")} aria-hidden />
                From your record
              </Button>
            )}
          </div>
        )}
      </div>
      <div className={cn(tickable && "pl-7")}>
        {hasEvidence && (
          <Collapse open={open}>
            <ul className="space-y-1 pt-2">
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
          <Collapse open={answer.userHas}>
            <div className="pt-2">{noteInput("How you meet it", "How you meet it, for example: relocating to Toronto")}</div>
          </Collapse>
        )}
        {tickable && !logistics && (
          <Collapse open={answer.userHas}>
            <div className="pt-2">
              {noteInput("Note")}
              {/* A claim with no detail can only be listed; a line on where it happened lets the resume show it as work. */}
              <Collapse open={answer.note.trim() === ""}>
                <p className="pt-1.5 text-xs text-muted-foreground">With no note this is listed in your skills only. Say where you did it and the resume shows it as work.</p>
              </Collapse>
            </div>
          </Collapse>
        )}
        {detailable && (
          <Collapse open={adding}>
            <div className="pt-2">
              {noteInput("Detail")}
              {listedOnly && (
                <Collapse open={answer.note.trim() === ""}>
                  <p className="pt-1.5 text-xs text-muted-foreground">Your record lists this as a skill but tells of no work with it, so the resume can only list it. Optional.</p>
                </Collapse>
              )}
            </div>
          </Collapse>
        )}
      </div>
    </li>
  );
}
