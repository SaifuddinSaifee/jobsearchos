import { z } from "zod";
import { normalizeText } from "@/lib/career/normalize";
import { env } from "@/lib/env";
import { chatStructured, type StructuredOptions } from "@/lib/llm/structured";
import type { GenerationInstructions } from "@/lib/profile/schema";
import { containsPhrase, type JobInput } from "./context";
import { bulletItems, checkFaithful, missingMentions, revertRewrites, type BulletItem, type Finding } from "./faithful";
import { checkStuffing, coverageNotes, keywordCoverage, stuffingNotes } from "./keywords";
import { modelReviewer, reviewNote, RUBRIC, type Review, type Reviewer } from "./review";
import type { Requirement } from "./types";
import { answerSchema, bulletText, buildPrompt, checkWriting, readWriting, type WriterAnswer, type WritingPlan, type WrittenResume } from "./write";

// Writes the resume in three calls: the writer drafts it from the candidate's own lines, a different model reviews the
// draft against fixed criteria (review.ts), and the writer revises it with that review and what the code checks found.
// Code then puts back to the candidate's own words any bullet still rewritten out of all recognition.

export type Writer = (plan: WritingPlan, job: JobInput, requirements: Requirement[], instructions?: GenerationInstructions | null) => Promise<{ written: WrittenResume; notes: string[] }>;

type Effort = NonNullable<StructuredOptions["reasoningEffort"]>;

/**
 * High, not max. Measured on five cases with `npm run eval:writer` (2026-10-15): at max GLM-5.3 thought for 12,000 to
 * 32,000 tokens a draft and one call in five ran out of room, so a resume took about 8 minutes and $0.25 and sometimes
 * failed; at high it took about 2 minutes and $0.06, never failed, and its resumes had no more code-check findings.
 */
export const WRITER_EFFORT: Effort = "high";
/**
 * GLM-5.3 does not think under Together's structured outputs, whatever the effort (checked 2026-10-15: no reasoning
 * tokens with a JSON schema, about 1,100 at max effort without one), so the writer asks for its JSON in the prompt.
 */
const WRITER_JSON = "prompt" as const;
/** Thinking counts against the output limit, so the writer gets plenty. */
const WRITER_MAX_TOKENS = 32_000;

/**
 * Waits before the review is tried again after a rate-limit refusal. Together's limits for the review model shift with
 * its live capacity, and the client's own quick retries (openai.ts) can all land inside one busy window.
 */
export const REVIEW_WAITS_MS = [20_000, 40_000];

/** One step less thinking, for a call that ran out of room thinking. */
const LOWER_EFFORT: Partial<Record<string, Effort>> = { max: "high", high: "medium", medium: "low" };
export const lowerEffort = (effort: Effort): Effort => LOWER_EFFORT[effort] ?? effort;
/** A reply cut off at the output limit: at high effort, almost always the model's thinking ran on. */
const isCutOff = (err: unknown) => /cut off \(max_tokens\)/i.test(err instanceof Error ? err.message : String(err));

/**
 * Asks up to `tries` times while `retry` says the error is worth another try. A reply cut off at the output limit is
 * asked again with one step less effort, since asking the same way runs out of room the same way.
 */
async function askWithRetry<T>(effort: Effort, tries: number, retry: (err: unknown) => boolean, ask: (effort: Effort) => Promise<T>): Promise<{ value: T | null; error: unknown; attempts: number }> {
  let error: unknown = null;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      return { value: await ask(effort), error: null, attempts: attempt };
    } catch (err) {
      error = err;
      if (!retry(err)) return { value: null, error, attempts: attempt };
      if (isCutOff(err)) effort = lowerEffort(effort);
    }
  }
  return { value: null, error, attempts: tries };
}

const isRateLimited = (err: unknown) => /\b429\b|rate limit|too many requests/i.test(err instanceof Error ? err.message : String(err));
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** What the code checks found in a written resume: the candidate's lines against each bullet, then the whole page. */
export function codeFindings(w: WrittenResume, items: BulletItem[], plan: WritingPlan, job: JobInput, requirements: Requirement[]): Finding[] {
  const stuffing = checkStuffing(w, job, requirements, plan.terms);
  return [
    ...checkFaithful(items, plan.terms),
    ...(w.interests === "" && plan.interests.length > 0 ? [{ bullet: "resume", kind: "missing-mention" as const, detail: "leaves out the Interests line the candidate asked for" }] : []),
    ...missingMentions(w.summary, plan.mentions).map((m) => ({ bullet: "summary", kind: "missing-mention" as const, detail: `does not mention, as the candidate asked: "${m}"` })),
    ...checkWriting(w).map((phrase) => ({ bullet: "resume", kind: "generic" as const, detail: `uses the generic phrase "${phrase}"` })),
    ...stuffing.copied.map((c) => ({ bullet: "resume", kind: "copied" as const, detail: `copies the posting's wording: "${c}"` })),
    ...stuffing.overused.map((t) => ({ bullet: "resume", kind: "overused" as const, detail: `uses "${t}" in too many places` })),
    ...stuffing.bare.map((t) => ({ bullet: "resume", kind: "named-trait" as const, detail: `names the way of working "${t}" instead of showing it` })),
  ];
}

const CRITERION = new Map(RUBRIC.map((c) => [c.id, c.name]));

/** What the writer is asked when it revises: everything it was asked before, its draft, the review and the code findings. */
export function buildRevisePrompt(prompt: { system: string; user: string }, draft: WriterAnswer, items: BulletItem[], review: Review | null, findings: Finding[]): { system: string; user: string } {
  const edits = (review?.edits ?? []).map((e) => `- ${e.target} [${CRITERION.get(e.criterion) ?? e.criterion}]: ${e.problem} Do this: ${e.instruction}`);
  const sections = [
    prompt.user,
    `YOUR DRAFT (in the answer format)\n${JSON.stringify(draft)}`,
    `YOUR DRAFT'S BULLETS BY ID (the review below refers to these)\n${items.map((i) => `${i.id} (${i.where}): ${i.text}`).join("\n")}`,
    edits.length ? `THE REVIEW\n${edits.join("\n")}` : "",
    findings.length ? `FOUND BY CODE CHECKS\n${findings.map((f) => `- ${f.bullet} ${f.detail}`).join("\n")}` : "",
  ];
  return {
    system: `${prompt.system}\n\nYou are now revising your draft. Make each edit in the review and fix each finding, unless doing so would break a rule above. Change nothing else: keep every other bullet, its wording and its fact ids exactly as they are. Answer with the whole resume in the same format.`,
    user: sections.filter(Boolean).join("\n\n"),
  };
}

/** How the writer revises after the review. */
export type RevisionMode =
  /** Revise the whole resume whenever the review asks for any edit or a code check found anything (the default). */
  | "always"
  /** Skip the revision when no code check found anything and the review asks for no material edit; else rewrite only the flagged parts. */
  | "targeted";

/** What the writer runs with. Every field has a default, which is what the app uses. */
export type WriterConfig = {
  model: string;
  effort: NonNullable<StructuredOptions["reasoningEffort"]>;
  /** Asked when the reviewer still fails after its retries. None by default: the draft is kept with a note. */
  fallbackReviewer: Reviewer | null;
  revision: RevisionMode;
  /** Told what happened inside one run, for evaluation (scripts/eval-resume-writer.ts). */
  onTrace?: (trace: WriterTrace) => void;
};

/** What happened inside one run of the writer. */
export type WriterTrace = {
  draftAttempts: number;
  /** What the code checks found in the draft. */
  findings: Finding[];
  review: Review | null;
  reviewedBy: "primary" | "fallback" | null;
  reviewErrors: string[];
  /** The waits before the review was tried again after a rate-limit refusal, in milliseconds. */
  reviewWaitsMs: number[];
  /** The review's edits that count as material (see `materialEdits`). */
  materialEdits: number;
  revision: "full" | "targeted" | "skipped" | "failed";
  /** The parts rewritten by a targeted revision: bullet ids, "summary", "skills", "interests". */
  targets: string[];
  /** Where the review and the code checks disagree (see `disagreements`). */
  disagreements: string[];
  /** What the code checks find in the final resume. */
  finalFindings: Finding[];
  reverted: number;
};

/** Criteria where any edit is material: the ones about what the resume claims, not how it reads. */
const HARD_CRITERIA = new Set(["faithful", "outcomes", "specific"]);

/** The review's edits that matter: any edit on what the resume claims, and any edit on a criterion scored 3 or less. */
export function materialEdits(review: Review): Review["edits"] {
  const score = new Map(review.scores.map((s) => [s.criterion, s.score]));
  return review.edits.filter((e) => HARD_CRITERIA.has(e.criterion) || (score.get(e.criterion) ?? 5) <= 3);
}

/**
 * The parts of the resume a finding is about: its bullet, the summary, the interests line, or, for a finding about the
 * whole resume, every part that has the quoted phrase. Empty when it cannot be placed.
 */
export function findingTargets(f: Finding, w: WrittenResume, items: BulletItem[]): string[] {
  if (f.bullet === "summary") return ["summary"];
  if (f.bullet !== "resume") return [f.bullet];
  if (f.kind === "missing-mention") return /interests/i.test(f.detail) ? ["interests"] : ["summary"];
  const phrase = f.detail.match(/"([^"]+)"/)?.[1];
  if (!phrase) return [];
  const has = (text: string) => containsPhrase(normalizeText(text), normalizeText(phrase));
  return [...(has(w.summary) ? ["summary"] : []), ...items.filter((i) => has(i.text)).map((i) => i.id)];
}

const FAITHFUL_KINDS = new Set<Finding["kind"]>(["new-number", "added-outcome", "lost-names", "rewritten"]);

/**
 * Where the review and the code checks disagree: the review calls the draft ready while the checks found something, it
 * makes no edit to a part a check flagged (it was asked to confirm or dismiss each), or it marks faithfulness down while
 * the checks found nothing unfaithful.
 */
export function disagreements(review: Review, findings: Finding[], targetsOf: (f: Finding) => string[]): string[] {
  const out: string[] = [];
  if (review.verdict === "ready" && findings.length > 0) out.push(`verdict "ready" with ${findings.length} code ${findings.length === 1 ? "finding" : "findings"}`);
  const edited = new Set(review.edits.map((e) => e.target));
  const passed = findings.filter((f) => {
    const t = targetsOf(f);
    return t.length > 0 && !t.some((x) => edited.has(x));
  });
  if (passed.length > 0) out.push(`no edit for ${passed.map((f) => `${f.bullet} ${f.kind}`).join(", ")}`);
  const unfaithful = findings.some((f) => FAITHFUL_KINDS.has(f.kind));
  for (const s of review.scores) {
    if ((s.criterion === "faithful" || s.criterion === "outcomes") && s.score <= 3 && !unfaithful) out.push(`scored ${s.criterion} ${s.score} while the code checks found nothing unfaithful`);
  }
  return out;
}

/** The answer to a targeted revision: only the parts it was asked to rewrite. */
export function patchSchema(plan: WritingPlan, bulletIds: string[]) {
  const full = answerSchema(plan).shape;
  return z.object({
    bullets: z.array(z.object({ id: z.enum(bulletIds.length ? (bulletIds as [string, ...string[]]) : ["none"]), text: z.string().min(10).max(plan.bulletChars + 60) })).optional(),
    summary: full.summary.optional(),
    mention: full.mention,
    skills: full.skills.optional(),
    interests: full.interests,
  });
}
export type WriterPatch = z.infer<ReturnType<typeof patchSchema>>;

/** What the writer is asked in a targeted revision: everything it was asked before, its draft, and only what to change. */
export function buildPatchPrompt(prompt: { system: string; user: string }, draft: WriterAnswer, items: BulletItem[], edits: Review["edits"], findings: Finding[], targets: string[]): { system: string; user: string } {
  const lines = edits.map((e) => `- ${e.target} [${CRITERION.get(e.criterion) ?? e.criterion}]: ${e.problem} Do this: ${e.instruction}`);
  const sections = [
    prompt.user,
    `YOUR DRAFT (in the answer format)\n${JSON.stringify(draft)}`,
    `YOUR DRAFT'S BULLETS BY ID\n${items.map((i) => `${i.id} (${i.where}): ${i.text}`).join("\n")}`,
    `TO REVISE\n${targets.join(", ")}`,
    lines.length ? `THE REVIEW\n${lines.join("\n")}` : "",
    findings.length ? `FOUND BY CODE CHECKS\n${findings.map((f) => `- ${f.bullet} ${f.detail}`).join("\n")}` : "",
  ];
  return {
    system: `${prompt.system}\n\nYou are now revising only the parts of your draft listed under TO REVISE. Make each edit in the review and fix each finding there, unless doing so would break a rule above. Answer with only those parts: under "bullets", each listed bullet by its id with its new text; "summary" (with "mention" when there is one), "skills" or "interests" only when listed. Everything else stays as it is.`,
    user: sections.filter(Boolean).join("\n\n"),
  };
}

/** The draft with a targeted revision applied: the listed parts replaced, every other part and every bullet's facts kept. */
export function applyPatch(draft: WriterAnswer, items: BulletItem[], patch: WriterPatch, plan: WritingPlan, targets: Set<string>): WrittenResume {
  const answer: WriterAnswer = {
    ...draft,
    ...(targets.has("summary") && patch.summary ? { summary: patch.summary } : {}),
    ...(targets.has("summary") && patch.mention ? { mention: patch.mention } : {}),
    ...(targets.has("skills") && patch.skills?.length ? { skills: patch.skills } : {}),
    ...(targets.has("interests") && patch.interests !== undefined ? { interests: patch.interests } : {}),
  };
  // Read from the same roles as the draft, so every bullet sits where its item says.
  const w = readWriting(answer, plan);
  const byId = new Map(items.map((i) => [i.id, i]));
  for (const b of patch.bullets ?? []) {
    const item = byId.get(b.id);
    if (!item || !targets.has(b.id)) continue;
    const list = item.at.kind === "role" ? w.roles[item.at.entry]?.bullets : w.projects[item.at.entry]?.bullets;
    const old = list?.[item.at.bullet];
    if (list && old) list[item.at.bullet] = { ...old, text: bulletText(b.text) };
  }
  return w;
}

/**
 * The writer that asks the models: a draft (tried twice if the reply cannot be read, with less thinking if it ran out of room), a review by
 * the review model, and a revision when the review or the code checks ask for one. A failed review or revision keeps the
 * draft, with a note. `chat` and `reviewer` are injectable so tests never reach the network; `config` changes the models
 * and the revision for evaluation, and is left out by the app.
 */
export function makeWriter(chat: typeof chatStructured = chatStructured, reviewer: Reviewer = modelReviewer, wait: (ms: number) => Promise<void> = sleep, config: Partial<WriterConfig> = {}): Writer {
  return async (plan, job, requirements, instructions) => {
    const schema = answerSchema(plan);
    const prompt = buildPrompt(plan, job, requirements, instructions);
    const opts = { model: config.model ?? env().WRITER_MODEL, maxTokens: WRITER_MAX_TOKENS, reasoningEffort: config.effort ?? WRITER_EFFORT, jsonMode: WRITER_JSON } satisfies Partial<StructuredOptions>;
    const revision = config.revision ?? "always";

    // Any failure is worth a second try; one cut off at the output limit is tried with less thinking.
    const drafting = await askWithRetry(opts.reasoningEffort, 2, () => true, (reasoningEffort) => chat(schema, prompt, { ...opts, reasoningEffort, step: "write-resume" }));
    const draft = drafting.value;
    const draftAttempts = drafting.attempts;
    if (!draft) throw new Error(`Could not write the resume with the model: ${drafting.error instanceof Error ? drafting.error.message : "unknown error"}`);

    const notes: string[] = [];
    const drafted = readWriting(draft, plan);
    const items = bulletItems(drafted, plan);
    const findings = codeFindings(drafted, items, plan, job, requirements);

    let review: Review | null = null;
    let reviewedBy: WriterTrace["reviewedBy"] = null;
    const reviewErrors: string[] = [];
    const reviewWaitsMs: number[] = [];
    for (let attempt = 0; !review; attempt++) {
      try {
        review = await reviewer(drafted, items, plan, job, requirements, findings);
        reviewedBy = "primary";
      } catch (err) {
        reviewErrors.push(err instanceof Error ? err.message : String(err));
        if (isRateLimited(err) && attempt < REVIEW_WAITS_MS.length) {
          reviewWaitsMs.push(REVIEW_WAITS_MS[attempt]);
          await wait(REVIEW_WAITS_MS[attempt]);
          continue;
        }
        console.error("[resume-writer] review failed:", err instanceof Error ? err.message : err);
        break;
      }
    }
    if (!review && config.fallbackReviewer) {
      try {
        review = await config.fallbackReviewer(drafted, items, plan, job, requirements, findings);
        reviewedBy = "fallback";
      } catch (err) {
        reviewErrors.push(err instanceof Error ? err.message : String(err));
        console.error("[resume-writer] fallback review failed:", err instanceof Error ? err.message : err);
      }
    }
    if (!review) notes.push("The review could not run, so this is the first draft with only the code checks applied.");

    const targetsOf = (f: Finding) => findingTargets(f, drafted, items);
    const material = review ? materialEdits(review) : [];
    let written = drafted;
    let outcome: WriterTrace["revision"] = "skipped";
    let targets: string[] = [];
    if (revision === "targeted") {
      targets = [...new Set([...material.map((e) => e.target), ...findings.flatMap(targetsOf)])];
      if (targets.length > 0) {
        const wanted = new Set(targets);
        const bulletIds = items.map((i) => i.id).filter((id) => wanted.has(id));
        const patching = await askWithRetry(opts.reasoningEffort, 2, isCutOff, (reasoningEffort) =>
          chat(patchSchema(plan, bulletIds), buildPatchPrompt(prompt, draft, items, material.filter((e) => wanted.has(e.target)), findings, targets), { ...opts, reasoningEffort, step: "revise-resume" }),
        );
        if (patching.value) {
          written = applyPatch(draft, items, patching.value, plan, wanted);
          outcome = "targeted";
        } else {
          console.error("[resume-writer] revision failed:", patching.error instanceof Error ? patching.error.message : patching.error);
          notes.push("The revision after the review could not run, so this is the first draft.");
          outcome = "failed";
        }
      }
    } else if (review ? review.verdict === "revise" || review.edits.length > 0 : findings.length > 0) {
      // Only a revision cut off at the output limit is tried again (with less thinking); any other failure keeps the draft.
      const revising = await askWithRetry(opts.reasoningEffort, 2, isCutOff, (reasoningEffort) => chat(schema, buildRevisePrompt(prompt, draft, items, review, findings), { ...opts, reasoningEffort, step: "revise-resume" }));
      if (revising.value) {
        written = readWriting(revising.value, plan);
        outcome = "full";
      } else {
        console.error("[resume-writer] revision failed:", revising.error instanceof Error ? revising.error.message : revising.error);
        notes.push("The revision after the review could not run, so this is the first draft.");
        outcome = "failed";
      }
    }
    const revised = outcome === "full" || outcome === "targeted";
    if (review) notes.unshift(reviewNote(review, revised));

    const safe = revertRewrites(written, plan);
    if (safe.reverted.length > 0) {
      notes.push(`${safe.reverted.length === 1 ? "One bullet was" : `${safe.reverted.length} bullets were`} put back to your own wording, because the model rewrote ${safe.reverted.length === 1 ? "it" : "them"} beyond recognition.`);
    }
    config.onTrace?.({
      draftAttempts,
      findings,
      review,
      reviewedBy,
      reviewErrors,
      reviewWaitsMs,
      materialEdits: material.length,
      revision: outcome,
      targets,
      disagreements: review ? disagreements(review, findings, targetsOf) : [],
      finalFindings: codeFindings(safe.written, bulletItems(safe.written, plan), plan, job, requirements),
      reverted: safe.reverted.length,
    });
    const generic = checkWriting(safe.written);
    const unsaid = missingMentions(safe.written.summary, plan.mentions);
    return {
      written: safe.written,
      notes: [
        ...notes,
        ...(generic.length ? [`The wording still has phrases that read as generic: ${generic.join(", ")}.`] : []),
        ...unsaid.map((m) => `The summary does not mention "${m}"; add it by hand if you want it there.`),
        ...stuffingNotes(checkStuffing(safe.written, job, requirements, plan.terms)),
        ...coverageNotes(keywordCoverage(safe.written, plan.terms)),
      ],
    };
  };
}

export const modelWriter: Writer = makeWriter();
