import { z } from "zod";
import { env } from "@/lib/env";
import { chatStructured, type StructuredOptions } from "@/lib/llm/structured";
import { clip, type JobInput } from "./context";
import type { BulletItem, Finding } from "./faithful";
import { REQUIREMENT_KIND_LABEL, type Requirement } from "./types";
import { askedFor, SUPPORT_BULLET_CHARS, type WritingPlan, type WrittenResume } from "./write";

// The second opinion. After the writer's draft, a different model reads it the way a hiring manager and a resume editor
// would, scores it against fixed criteria, and lists the edits that would make it better. The writer then makes them
// (writer.ts). The criteria come from what a generated resume got wrong in practice: it read as written by a model,
// lost the candidate's specifics, invented results, and forced job terms where they did not belong.

/** One thing the reviewer scores, from 1 to 5, with what each end of the scale looks like. */
export type Criterion = { id: string; name: string; five: string; one: string };

export const RUBRIC: Criterion[] = [
  {
    id: "faithful",
    name: "Faithful to the record",
    five: "Every bullet says what the candidate's own lines say: the same work, scope and numbers. What the candidate says they have is worked in as stated. The summary claims no interest, hobby or background the candidate did not state, and the interests they gave are only in the Interests line.",
    one: "Bullets change what happened or who built what ('built captioning for the voice agents' where the candidate built the agents, or the reverse), inflate the scope, or carry numbers, tools or results the candidate never wrote; the summary gives the candidate an interest in the company's field they never claimed.",
  },
  {
    id: "voice",
    name: "Sounds like the candidate",
    five: "Reads like a person wrote it: the candidate's own wording is kept where it already works, each change has a reason, and words that add tone but no evidence are gone.",
    one: "Reads like a model wrote it: every line rewritten into the same smooth, generic register.",
  },
  {
    id: "specific",
    name: "Specific and concrete",
    five: "The names of tools, systems, products, customers and teams, and the numbers, from the candidate's lines are on the page.",
    one: "Named things are replaced by categories ('business systems', 'data infrastructure') and the numbers are gone.",
  },
  {
    id: "outcomes",
    name: "No invented results",
    five: "Every result, purpose or benefit is one the candidate wrote. A bullet whose source states no result ends at what was done.",
    one: "Bullets end in 'so that', 'giving the team', 'enabling' or 'ensuring' clauses nobody wrote.",
  },
  {
    id: "proof",
    name: "Proves what the job is about",
    five: "Each core requirement, and each thing the candidate says they have with a note, is shown by a concrete bullet in the place the candidate's lines or note put it: where it happened, with what, and what came of it when the candidate gave a result. The strongest measured results in the candidate's lines are on the page.",
    one: "Claims with detail sit only in the skills lines, or are worn as labels ('On realtime voice agents, ...'), or are moved into lines about other work; the core of the job is asserted ('AI-native builder') rather than shown; the candidate's best numbers are missing; a project reports a plan or an intention ('a customer validation plan') where the candidate's lines say what was built and what came of it.",
  },
  {
    id: "relevance",
    name: "Answers this job",
    five: "The first bullet of each recent role answers one of the job's most important requirements; the strongest evidence for the job is on the page and early.",
    one: "The job's main asks are buried or missing while lesser work leads.",
  },
  {
    id: "keywords",
    name: "Job terms placed naturally",
    five: "The job's terms the candidate has appear where they belong, about once each. The company's field is at most a few words in the summary. Ways of working are shown, not named.",
    one: "Terms are tacked onto unrelated sentences, repeated, or listed bare; field words or traits are stuffed into bullets.",
  },
  {
    id: "rhythm",
    name: "Varied and readable",
    five: "One to three detailed bullets per role, the rest one line; a bullet leads with its result where the candidate states one; sentences start and run differently; one story per bullet: the problem or decision, what was built, what came of it.",
    one: "Every bullet is the same long shape ('Verb X, Y and Z, which...'); a bullet joins two achievements, or packs several separate deliverables into one line ('demos and integrations ... using LLM APIs, AI agents and agentic search').",
  },
  {
    id: "summary",
    name: "Summary with a point of view",
    five: "In three sentences at most: what kind of professional this is, in plain words rather than the posting's title; the result the job cares most about, its numbers exact and nothing from another line joined to it, with what they built and ran that answers the core; and how they work, where a note or line of the candidate's says so. It names only what the bullets show. Plus the closing line the candidate asked for (relocation, remote, office days), which stays.",
    one: "A list of tools or adjectives; opens with the posting's exact title; names tools no bullet shows; a general line on how they work that nothing of the candidate's says; names the company or repeats its mission.",
  },
  {
    id: "mechanics",
    name: "Clean",
    five: "No first person, filler or cliches; consistent tense; acronyms spelled out once; no long dashes.",
    one: "Cliches ('passionate', 'leverage', 'results-driven'), mixed tenses, unexplained acronyms.",
  },
  {
    id: "skills",
    name: "Skills section",
    five: "Comprehensive and deliberate: every skill of the record this job would look for, under the candidate's own categories, the job's skills first in each, no repeats. Every item the candidate chose stays.",
    one: "A thin list, repeats, groups that mix unrelated things ('Product & Media'), product areas listed as skills, or the job's skills buried.",
  },
];

const CRITERIA = RUBRIC.map((c) => c.id) as [string, ...string[]];
export const MAX_EDITS = 15;
/** The review's output limit, thinking included. */
const REVIEW_MAX_TOKENS = 32_000;
const NOTE_CHARS = 400;

/** The schema for one review. Targets are only the parts of this resume, by the ids the reviewer was shown. */
export function reviewSchema(bulletIds: string[]) {
  // The skills section is written by code from the record, so it is scored but never a target.
  const targets = ["summary", ...bulletIds] as [string, ...string[]];
  return z.object({
    scores: z.array(
      z.object({
        criterion: z.enum(CRITERIA),
        score: z.number().int().min(1).max(5),
        note: z.string().max(NOTE_CHARS),
      }),
    ),
    edits: z
      .array(
        z.object({
          target: z.enum(targets),
          criterion: z.enum(CRITERIA),
          problem: z.string().max(NOTE_CHARS),
          instruction: z.string().max(600),
        }),
      )
      .max(MAX_EDITS),
    verdict: z.enum(["ready", "revise"]),
  });
}
export type Review = z.infer<ReturnType<typeof reviewSchema>>;

const SYSTEM = `You review a resume written for a specific job, as a hiring manager for that job and an experienced resume editor would. You score it against the criteria given, and you list the edits that would make it better. You do not rewrite the resume yourself.
The stance you review from:
- The candidate is qualified for the job. Everything under "THE CANDIDATE SAYS THEY HAVE THIS" is true. Never ask to remove, soften or prove it, and never mark it down as unsupported. The same goes for items the candidate chose for the skills lines.
- The candidate's own lines (shown under each bullet as "from the record") are the truth and the voice to keep. The best edit often restores their wording, their names and their numbers.
- Never ask for a number, a tool, a result or a claim that is not in the candidate's lines or in what they say they have. Do ask for what they say they have with a note to be shown as work in a bullet, told with that role's real product and tools, when it sits only in the skills lines or as a label.
- What they say they have with no detail ("no detail given") belongs in the skills lines or inside a bullet whose own lines show that work. Never ask to put it in the summary or to give it a bullet of its own.
- Replacement wording for a bullet uses only the words of its own lines from the record and the notes of the claims it shows. Never ask to move a tool, a job term or a claim into a bullet whose lines are about other work: "Claude Code" does not belong in a line about a product's own logging layer.
- One result per sentence. Never ask to join results from different lines; a line joined by a semicolon holds two results.
- A project's technologies are printed above its bullets. Never ask to list them in a bullet.
- Detail is welcome: never ask to shorten a bullet that is within its length, only to cut what adds tone and no evidence.
- Never ask to name the company or to quote its mission.
- A closing line of the summary about a condition (relocating, office days) is there because the candidate asked for it. Never ask to remove or shorten it away.
How to write the edits:
- Each edit names one target (a bullet id or "summary"), the criterion it serves, what is wrong, and exactly what to change. Give the replacement wording when you can.
- The skills section is built by code from the candidate's record: score it, but list no edits for it.
- Most important first. At most ${MAX_EDITS}. Leave out edits that only change taste.
- Score every criterion once, 1 to 5, with a short note. The verdict is "ready" only when every score is 4 or 5 and no edit is needed.`;

/**
 * The draft as the reviewer reads it: each bullet with its id and every one of the candidate's own lines it was written
 * from. Showing only the first two once made the reviewer take a project's third line for invented content, and think
 * itself out of room trying to reconcile it.
 */
export function renderDraft(w: WrittenResume, items: BulletItem[]): string {
  const byWhere = new Map<string, BulletItem[]>();
  for (const item of items)
    byWhere.set(item.where, [...(byWhere.get(item.where) ?? []), item]);
  const lines = [`Summary: ${w.summary}`];
  for (const [where, list] of byWhere) {
    lines.push("", where);
    for (const item of list) {
      lines.push(`${item.id}: ${item.text}`);
      for (const src of [...new Set(item.sources)])
        lines.push(`    from the record: ${clip(src, 600)}`);
      for (const u of item.users)
        lines.push(
          `    the candidate says they have: ${u.text}${u.note ? ` (${u.note})` : " (no detail given)"}`,
        );
    }
  }
  if (w.skills.length)
    lines.push(
      "",
      "Skills:",
      ...w.skills.map((s) => `${s.category}: ${s.items.join(", ")}`),
    );
  if (w.achievements.length) lines.push("", "Achievements:", ...w.achievements);
  if (w.interests) lines.push("", `Interests: ${w.interests}`);
  return lines.join("\n");
}

/** The criteria as the reviewer reads them. */
export const rubricText = () =>
  RUBRIC.map((c) => `${c.id} (${c.name})\n  5: ${c.five}\n  1: ${c.one}`).join(
    "\n",
  );

/** What the reviewer is asked, as text. */
export function buildReviewPrompt(
  w: WrittenResume,
  items: BulletItem[],
  plan: WritingPlan,
  job: JobInput,
  requirements: Requirement[],
  findings: Finding[],
): { system: string; user: string } {
  const asked = askedFor(requirements).map(
    (r) => `- [${r.core ? "Core, " : ""}${REQUIREMENT_KIND_LABEL[r.kind]}] ${r.text}`,
  );
  const sections = [
    `THE JOB\n${job.title} at ${job.company}${job.aboutCompany ? `\nAbout the company: ${clip(job.aboutCompany, 400)}` : ""}`,
    asked.length ? `WHAT THE JOB ASKS FOR\n${asked.join("\n")}` : "",
    job.responsibilities.length
      ? `THE POSTING'S RESPONSIBILITIES (flag any line of the resume that copies or paraphrases one; the posting's short terms used for the candidate's own work are fine)\n${job.responsibilities.slice(0, 8).map((r) => `- ${clip(r, 200)}`).join("\n")}`
      : "",
    plan.terms.length
      ? `JOB TERMS THE CANDIDATE HAS\n${plan.terms.join(", ")}${plan.listedOnly.length ? `\nOf these, only in the skills section (no line of the candidate's mentions them, so no bullet or summary should): ${plan.listedOnly.join(", ")}` : ""}`
      : "",
    plan.users.length
      ? `THE CANDIDATE SAYS THEY HAVE THIS (true; never question it)\n${plan.users.map((u) => `- ${u.text}${u.note ? ` (${u.note})` : " (no detail given)"}`).join("\n")}`
      : "",
    `THE CANDIDATE'S INTERESTS (the only ones the resume may claim)\n${plan.interests.length ? plan.interests.map((i) => `- ${i.text}${i.note ? ` (${i.note})` : ""}`).join("\n") : "none given"}`,
    `THE RESUME\n${renderDraft(w, items)}`,
    findings.length
      ? `FOUND BY CODE CHECKS (confirm or dismiss each in your edits)\n${findings.map((f) => `- ${f.bullet} ${f.detail}`).join("\n")}`
      : "",
    `LENGTH\nThe bullets that answer the core may use up to ${plan.bulletChars} characters, the others about ${SUPPORT_BULLET_CHARS}. An edit that adds words to a bullet past that says what to cut from it so it still fits.`,
    `CRITERIA\n${rubricText()}`,
  ];
  return { system: SYSTEM, user: sections.filter(Boolean).join("\n\n") };
}

export type Reviewer = (
  w: WrittenResume,
  items: BulletItem[],
  plan: WritingPlan,
  job: JobInput,
  requirements: Requirement[],
  findings: Finding[],
) => Promise<Review>;

/** Reads a review: the first score for each criterion, edits only for parts that exist. */
export function readReview(review: Review, items: BulletItem[]): Review {
  const seen = new Set<string>();
  const scores = review.scores.filter(
    (s) => !seen.has(s.criterion) && !!seen.add(s.criterion),
  );
  const known = new Set(["summary", ...items.map((i) => i.id)]);
  return {
    ...review,
    scores,
    edits: review.edits.filter((e) => known.has(e.target)),
  };
}

/** Which model reviews, and how it is asked. Left out, it is `REVIEW_MODEL` with its own default effort and structured outputs. */
export type ReviewerOptions = Pick<
  StructuredOptions,
  "model" | "reasoningEffort" | "jsonMode"
>;

/** The reviewer that asks the review model. `chat` is injectable so tests never reach the network. */
export function makeReviewer(
  chat: typeof chatStructured = chatStructured,
  options: ReviewerOptions = {},
): Reviewer {
  return async (w, items, plan, job, requirements, findings) => {
    const prompt = buildReviewPrompt(
      w,
      items,
      plan,
      job,
      requirements,
      findings,
    );
    const review = await chat(reviewSchema(items.map((i) => i.id)), prompt, {
      ...options,
      model: options.model ?? env().REVIEW_MODEL,
      // Its thinking counts against this. Reviews think for 8,000 to 13,000 tokens; one ran past 24,000 (Oct 16) and
      // was lost one edit from the end. Output is cheap on the review model, so the room is generous.
      maxTokens: REVIEW_MAX_TOKENS,
      // A review cut off at the limit still has its scores and every edit it finished: those are used.
      salvage: salvageReview,
      step: "review-resume",
    });
    return readReview(review, items);
  };
}

export const modelReviewer: Reviewer = makeReviewer();

/** A review cut off part way, once it reached its edits: what it scored and every edit it finished, read as "revise". */
export function salvageReview(partial: unknown): unknown | null {
  if (!partial || typeof partial !== "object" || !Array.isArray((partial as { edits?: unknown }).edits)) return null;
  return { verdict: "revise", scores: [], ...partial };
}

/** The mean score, 1 to 5, or null with no scores. */
export function meanScore(review: Review): number | null {
  if (review.scores.length === 0) return null;
  return review.scores.reduce((n, s) => n + s.score, 0) / review.scores.length;
}

const NAME = new Map(RUBRIC.map((c) => [c.id, c.name]));

/** The review in a line, for the notes on a finished resume. */
export function reviewNote(review: Review, revised: boolean): string {
  const mean = meanScore(review);
  const low = review.scores
    .filter((s) => s.score <= 3)
    .sort((a, b) => a.score - b.score)
    .map((s) => `${NAME.get(s.criterion)} (${s.score})`);
  const scored =
    mean === null ? "Reviewed" : `Review of the draft: ${mean.toFixed(1)} of 5`;
  const weak = low.length ? `; weakest: ${low.join(", ")}` : "";
  const after = revised
    ? ` ${review.edits.length} ${review.edits.length === 1 ? "edit was" : "edits were"} made after it.`
    : review.edits.length === 0
      ? " No edits needed."
      : "";
  return `${scored}${weak}.${after}`;
}
