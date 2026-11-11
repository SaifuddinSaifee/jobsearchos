import { z } from "zod";
import { normalizeText } from "@/lib/career/normalize";
import { env } from "@/lib/env";
import { isStopped } from "@/lib/llm/abort";
import { chatStructured, type StructuredOptions } from "@/lib/llm/structured";
import type { GenerationInstructions } from "@/lib/profile/schema";
import { clip, containsPhrase, type JobInput } from "./context";
import { bareClaimFindings, bulletItems, checkFaithful, droppedStrong, mergedResults, missingMentions, revertAddedNames, revertRewrites, twoStories, unbackedInSummary, unproven, withoutRepeats, type BulletItem, type Finding } from "./faithful";
import { checkStuffing, copiedPhrases, coverageNotes, keywordCoverage, stuffingNotes } from "./keywords";
import { meanScore, modelReviewer, reviewNote, RUBRIC, type Review, type Reviewer } from "./review";
import type { Requirement } from "./types";
import { answerSchema, bulletText, buildPrompt, checkWriting, MAX_SUMMARY_CHARS, readWriting, type WriterAnswer, type WritingPlan, type WrittenResume } from "./write";

// Writes the resume in three calls: the writer drafts it from the candidate's own lines, a different model reviews the
// draft against fixed criteria (review.ts), and the writer revises it with that review and what the code checks found.
// Code then puts back to the candidate's own words any bullet still rewritten out of all recognition.

/** A stage of writing starting or ending, so the page can show where it is and how long each part took. */
export type WriterStage = (stage: "write" | "review" | "revise", status: "running" | "done" | "failed" | "skipped", detail?: string) => Promise<void> | void;

export type Writer = (plan: WritingPlan, job: JobInput, requirements: Requirement[], instructions?: GenerationInstructions | null, onStage?: WriterStage) => Promise<{ written: WrittenResume; notes: string[] }>;

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
// The output limits, thinking included, are settings (`WRITER_MAX_TOKENS`, `WRITER_FALLBACK_MAX_TOKENS`,
// `REVISE_MAX_TOKENS` in env.ts). A finished draft is about 1,500 tokens; drafts that worked thought for 6,000 to 22,000,
// but on the same prompt GLM-5.3 at high effort sometimes thinks on past any limit (one run in three on Oct 16).
/**
 * The effort a draft is written again with after it ran out of room. Not medium: on Oct 16 a medium retry ran out of
 * room too, so a stuck draft cost $0.19 and gave nothing. At low effort GLM-5.3 thinks very little, so the draft is
 * written: plainer than a high-effort one, it is then reviewed and revised as usual, and marked as a fallback.
 */
export const FALLBACK_EFFORT: Effort = "low";
/** What every revision is told about length, so an edit that adds words does not push a bullet past its limit. */
const KEEP_LENGTH = "Keep every bullet within the lengths under LENGTH: when an edit adds words to a bullet, cut that bullet's least important clause so it still fits.";

/**
 * Waits before the review is tried again after a rate-limit refusal. Together's limits for the review model shift with
 * its live capacity, and the client's own quick retries (openai.ts) can all land inside one busy window.
 */
export const REVIEW_WAITS_MS = [20_000, 40_000];

/** A reply cut off at the output limit: at high effort, almost always the model's thinking ran on. */
const isCutOff = (err: unknown) => /cut off \(max_tokens\)/i.test(err instanceof Error ? err.message : String(err));

/**
 * Asks up to `tries` times while `retry` says the error is worth another try, and never after the user stopped the job.
 * A reply cut off at the output limit is asked again at `FALLBACK_EFFORT` with `fallbackMaxTokens` of room, since asking
 * the same way runs out of room the same way. Says which attempt worked and at what effort.
 */
async function askWithRetry<T>(
  effort: Effort,
  maxTokens: number,
  tries: number,
  retry: (err: unknown) => boolean,
  ask: (effort: Effort, maxTokens: number, attempt: number) => Promise<T>,
  fallbackMaxTokens = maxTokens,
): Promise<{ value: T | null; error: unknown; attempts: number; effort: Effort }> {
  let error: unknown = null;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      return { value: await ask(effort, maxTokens, attempt), error: null, attempts: attempt, effort };
    } catch (err) {
      error = err;
      if (isStopped(err) || !retry(err)) return { value: null, error, attempts: attempt, effort };
      if (isCutOff(err)) {
        effort = FALLBACK_EFFORT;
        maxTokens = Math.min(maxTokens, fallbackMaxTokens);
      }
    }
  }
  return { value: null, error, attempts: tries, effort };
}

const isRateLimited = (err: unknown) => /\b429\b|rate limit|too many requests/i.test(err instanceof Error ? err.message : String(err));
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** What the code checks found in a written resume: the candidate's lines against each bullet, then the whole page. */
export function codeFindings(w: WrittenResume, items: BulletItem[], plan: WritingPlan, job: JobInput, requirements: Requirement[]): Finding[] {
  const stuffing = checkStuffing(w, job, requirements, plan.terms);
  return [
    ...checkFaithful(items, plan.terms),
    ...unproven(items, plan.users).map((u) => ({ bullet: "resume", kind: "unproven" as const, detail: `does not show "${u.text}" in any bullet; prove it as work in the role where it fits` })),
    ...bareClaimFindings(w, items, plan.users),
    ...mergedResults(w.summary, plan).map((sentence) => ({ bullet: "summary", kind: "merged" as const, detail: `joins results from different lines in one sentence: "${sentence}"; give one result per sentence` })),
    ...unbackedInSummary(w, items, plan).map((name) => ({ bullet: "summary", kind: "unbacked" as const, detail: `names "${name}", which no bullet shows; take it out of the summary (the skills section lists it)` })),
    ...twoStories(items).map(({ item, clauses }) => ({
      bullet: item.id,
      kind: "two-stories" as const,
      detail: `tells two separate results ("${clip(clauses[0], 60)}" and "${clip(clauses[1], 60)}"); keep the one that matters for this job, or make it two bullets citing the same fact within the role's bullet count`,
    })),
    ...droppedStrong(w, items),
    ...tooLong(w, items, plan),
    ...leftOut(w, plan),
    ...repeatedInSummary(w, items).map((run) => ({ bullet: "summary", kind: "repeated" as const, detail: `repeats a bullet word for word: "${run}"; say the result in a clause of your own` })),
    ...(w.interests === "" && plan.interests.length > 0 ? [{ bullet: "resume", kind: "missing-mention" as const, detail: "leaves out the Interests line the candidate asked for" }] : []),
    // A mention in the header answers the conditions; only one that closes the summary is looked for there.
    ...(w.mention ? [] : missingMentions(w.summary, plan.mentions)).map((m) => ({ bullet: "summary", kind: "missing-mention" as const, detail: `does not mention, as the candidate asked: "${m}"` })),
    ...checkWriting(w).map((phrase) => ({ bullet: "resume", kind: "generic" as const, detail: `uses the generic phrase "${phrase}"` })),
    ...stuffing.copied.map((c) => ({ bullet: "resume", kind: "copied" as const, detail: `copies the posting's wording: "${c}"` })),
    ...stuffing.overused.map((t) => ({ bullet: "resume", kind: "overused" as const, detail: `uses "${t}" in too many places` })),
    ...stuffing.bare.map((t) => ({ bullet: "resume", kind: "named-trait" as const, detail: `names the way of working "${t}" instead of showing it` })),
  ];
}

/**
 * What a draft leaves out that a resume needs: the summary, a role (code kept it from the record's own lines), or a
 * project code chose for the job. Each goes to the revision to write; none of them fails the run, since a draft that cost a
 * minute or more of thinking is worth fixing rather than throwing away.
 */
export function leftOut(w: WrittenResume, plan: WritingPlan): Finding[] {
  return [
    ...(w.summary.trim() === "" ? [{ bullet: "summary", kind: "left-out" as const, detail: "is empty; write the summary" }] : []),
    ...w.roles.filter((r) => r.fromRecord).map((r) => ({ bullet: "resume", kind: "left-out" as const, detail: `leaves out ${r.plan.title || "the role"} at ${r.plan.employer} (${r.plan.alias}); write its bullets from its facts` })),
    // Code chose the projects for this job (at most three), so each is meant to be on the page: left to the writer, a
    // draft kept one and dropped the two with an accuracy number and a test suite.
    ...plan.projects
      .filter((p) => !w.projects.some((x) => x.plan === p))
      .map((p) => ({ bullet: "resume", kind: "left-out" as const, detail: `leaves out the project ${p.name} (${p.alias}); include it with one or two bullets from its lines` })),
  ];
}

/** Words in a row the summary may share with a bullet: a name and a number ("500K+ daily events at 99.9% uptime"), not a sentence. */
const REPEAT_RUN = 9;

/** Runs of the summary copied from a bullet: a summary that repeats the page tells the reader nothing new. */
export function repeatedInSummary(w: WrittenResume, items: BulletItem[]): string[] {
  return copiedPhrases(w.summary, items.map((i) => i.text), REPEAT_RUN);
}

/** How far past its limit a bullet may run before it is flagged: a few words, not a clause. */
const LENGTH_SLACK = 40;

/** Bullets and a summary past their length. Read without a limit, so a long one is shortened by the revision, not thrown away. */
export function tooLong(w: WrittenResume, items: BulletItem[], plan: WritingPlan): Finding[] {
  return [
    ...(w.summary.length > MAX_SUMMARY_CHARS ? [{ bullet: "summary", kind: "too-long" as const, detail: `is ${w.summary.length} characters; keep it under ${MAX_SUMMARY_CHARS} by cutting its least important clause` }] : []),
    ...items
      .filter((i) => i.text.length > plan.bulletChars + LENGTH_SLACK)
      .map((i) => ({ bullet: i.id, kind: "too-long" as const, detail: `is ${i.text.length} characters; keep it under ${plan.bulletChars} by cutting its least important clause` })),
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
    system: `${prompt.system}\n\nYou are now revising your draft. Make each edit in the review and fix each finding, unless doing so would break a rule above. ${KEEP_LENGTH} Change nothing else: keep every other bullet, its wording and its fact ids exactly as they are. Answer with the whole resume in the same format.`,
    user: sections.filter(Boolean).join("\n\n"),
  };
}

/** How the writer revises after the review. */
export type RevisionMode =
  /** Revise the whole resume when the review asks for a material edit or a code check found anything (the default). */
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
  /** The draft was written at `FALLBACK_EFFORT` after a first one ran out of room. */
  fallback: boolean;
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
  /** The parts rewritten by a targeted revision: bullet ids, "summary", "interests". */
  targets: string[];
  /** Where the review and the code checks disagree (see `disagreements`). */
  disagreements: string[];
  /** What the code checks find in the final resume. */
  finalFindings: Finding[];
  reverted: number;
};

/** Criteria where any edit is material: the ones about what the resume claims and proves, not how it reads. */
const HARD_CRITERIA = new Set(["faithful", "outcomes", "specific", "proof"]);

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

const FAITHFUL_KINDS = new Set<Finding["kind"]>(["new-number", "added-outcome", "lost-names", "added-names", "rewritten"]);

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
    bullets: z.array(z.object({ id: z.enum(bulletIds.length ? (bulletIds as [string, ...string[]]) : ["none"]), text: z.string().min(10) })).optional(),
    summary: full.summary.optional(),
    mention: full.mention,
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
    system: `${prompt.system}\n\nYou are now revising only the parts of your draft listed under TO REVISE. Make each edit in the review and fix each finding there, unless doing so would break a rule above. ${KEEP_LENGTH} Answer with only those parts: under "bullets", each listed bullet by its id with its new text; "summary" (with "mention" when there is one) or "interests" only when listed. Everything else stays as it is.`,
    user: sections.filter(Boolean).join("\n\n"),
  };
}

/** The draft with a targeted revision applied: the listed parts replaced, every other part and every bullet's facts kept. */
export function applyPatch(draft: WriterAnswer, items: BulletItem[], patch: WriterPatch, plan: WritingPlan, targets: Set<string>): WrittenResume {
  const answer: WriterAnswer = {
    ...draft,
    ...(targets.has("summary") && patch.summary ? { summary: patch.summary } : {}),
    ...(targets.has("summary") && patch.mention ? { mention: patch.mention } : {}),
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
  return async (plan, job, requirements, instructions, onStage = () => {}) => {
    const schema = answerSchema(plan);
    const prompt = buildPrompt(plan, job, requirements, instructions);
    const limits = env();
    const opts = { model: config.model ?? limits.WRITER_MODEL, maxTokens: limits.WRITER_MAX_TOKENS, reasoningEffort: config.effort ?? WRITER_EFFORT, jsonMode: WRITER_JSON } satisfies Partial<StructuredOptions>;
    const revision = config.revision ?? "always";

    // Any failure is worth a second try; one cut off at the output limit is tried at low effort, with less room.
    const drafting = await askWithRetry(
      opts.reasoningEffort,
      limits.WRITER_MAX_TOKENS,
      2,
      () => true,
      (reasoningEffort, maxTokens, attempt) =>
        chat(schema, prompt, {
          ...opts,
          reasoningEffort,
          maxTokens,
          step: "write-resume",
          traceAttributes: { "resume.attempt": attempt, "resume.fallback": reasoningEffort !== opts.reasoningEffort },
        }),
      limits.WRITER_FALLBACK_MAX_TOKENS,
    );
    const draft = drafting.value;
    const draftAttempts = drafting.attempts;
    const fallback = !!draft && drafting.effort !== opts.reasoningEffort;
    if (!draft) throw new Error(`Could not write the resume with the model: ${drafting.error instanceof Error ? drafting.error.message : "unknown error"}`);
    await onStage("write", "done", fallback ? "fallback: the first ran too long, written with less thinking" : draftAttempts > 1 ? "on the second try" : undefined);
    await onStage("review", "running");

    const notes: string[] = fallback
      ? ["The first draft thought for too long and was stopped, so this one was written with less thinking (a fallback draft). It was reviewed and revised as usual; read it with that in mind, or write it again."]
      : [];
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
    const mean = review ? meanScore(review) : null;
    await onStage("review", review ? "done" : "failed", review ? (mean === null ? undefined : `${mean.toFixed(1)} of 5`) : "the draft goes on with the code checks");

    const targetsOf = (f: Finding) => findingTargets(f, drafted, items);
    const material = review ? materialEdits(review) : [];
    let written = drafted;
    let outcome: WriterTrace["revision"] = "skipped";
    let targets: string[] = [];
    if (revision === "targeted") {
      targets = [...new Set([...material.map((e) => e.target), ...findings.flatMap(targetsOf)])];
      if (targets.length > 0) {
        await onStage("revise", "running");
        const wanted = new Set(targets);
        const bulletIds = items.map((i) => i.id).filter((id) => wanted.has(id));
        const patching = await askWithRetry(opts.reasoningEffort, limits.REVISE_MAX_TOKENS, 1, () => false, (reasoningEffort, maxTokens) =>
          chat(patchSchema(plan, bulletIds), buildPatchPrompt(prompt, draft, items, material.filter((e) => wanted.has(e.target)), findings, targets), { ...opts, maxTokens, reasoningEffort, step: "revise-resume" }),
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
    } else if (material.length > 0 || findings.length > 0) {
      await onStage("revise", "running");
      // Only when the review asks for something that matters or a code check found something: an edit of taste alone is
      // not worth a second pass over the whole page. Asked once: a revision that fails, even one cut off at its limit,
      // keeps the reviewed draft (twice 32,000 tokens of thinking once cost $0.31 and gave nothing).
      const revising = await askWithRetry(opts.reasoningEffort, limits.REVISE_MAX_TOKENS, 1, () => false, (reasoningEffort, maxTokens) =>
        chat(schema, buildRevisePrompt(prompt, draft, items, review, findings), { ...opts, maxTokens, reasoningEffort, step: "revise-resume" }),
      );
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
    const edits = material.length + findings.length;
    await onStage("revise", revised ? "done" : outcome === "failed" ? "failed" : "skipped", revised ? `${edits} ${edits === 1 ? "change" : "changes"} asked for` : outcome === "failed" ? "kept the reviewed draft" : "nothing needed");
    // After the fallback note, which matters more.
    if (review) notes.splice(fallback ? 1 : 0, 0, reviewNote(review, revised));

    // A tool or job term the revision moved into a line about other work goes back out, before anything else is checked.
    const named = revertAddedNames(written, drafted, plan);
    if (named.reverted.length > 0) {
      notes.push(`${named.reverted.length === 1 ? "One bullet was" : `${named.reverted.length} bullets were`} put back as drafted or to your own wording, because ${named.reverted.length === 1 ? "it" : "they"} named a tool or term ${named.reverted.length === 1 ? "its" : "their"} own lines do not.`);
    }
    const rewritten = revertRewrites(named.written, plan);
    if (rewritten.reverted.length > 0) {
      notes.push(`${rewritten.reverted.length === 1 ? "One bullet was" : `${rewritten.reverted.length} bullets were`} put back to your own wording, because the model rewrote ${rewritten.reverted.length === 1 ? "it" : "them"} beyond recognition.`);
    }
    // Last: a bullet that says what one above it says, however it got there, is left out.
    const repeats = withoutRepeats(rewritten.written);
    if (repeats.dropped > 0) notes.push(`${repeats.dropped === 1 ? "One bullet was" : `${repeats.dropped} bullets were`} left out for repeating another.`);
    const safe = { written: repeats.written, reverted: rewritten.reverted };
    config.onTrace?.({
      draftAttempts,
      fallback,
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
      reverted: safe.reverted.length + named.reverted.length,
    });
    const generic = checkWriting(safe.written);
    // A mention in the header answers the conditions; only one meant to close the summary is looked for there.
    const unsaid = safe.written.mention ? [] : missingMentions(safe.written.summary, plan.mentions);
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
