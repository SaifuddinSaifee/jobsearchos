// Client-safe types for writing a resume for a job (no database or server imports).

/**
 * Where a generation is. It runs in two parts with a pause between them: matching what the job asks for against the
 * career record (`queued`, `matching`), then waiting for the user to look at it (`review`), then writing
 * (`writing_queued`, `writing`). With the review turned off it goes straight on.
 */
export const GENERATION_STATUSES = ["queued", "matching", "review", "writing_queued", "writing", "done", "failed", "stopped"] as const;
export type GenerationStatus = (typeof GENERATION_STATUSES)[number];

/** Statuses a worker is, or will soon be, working on. At most one generation per job is open at a time. */
export const WORKING_STATUSES = ["queued", "matching", "writing_queued", "writing"] as const;
/** Statuses that keep the job's single open generation: working, or waiting for the user's review. */
export const OPEN_STATUSES = ["queued", "matching", "review", "writing_queued", "writing"] as const;

export const isGenerationWorking = (s: { status: GenerationStatus } | null | undefined): boolean =>
  !!s && (WORKING_STATUSES as readonly string[]).includes(s.status);
export const isGenerationOpen = (s: { status: GenerationStatus } | null | undefined): boolean =>
  !!s && (OPEN_STATUSES as readonly string[]).includes(s.status);

/** The named stages shown while it works, in order. Writing is three of them, so the time each takes can be seen. */
export const GENERATION_STEPS = ["read", "match", "write", "review", "revise", "save"] as const;
export type GenerationStepName = (typeof GENERATION_STEPS)[number];

export const GENERATION_STEP_LABEL: Record<GenerationStepName, string> = {
  read: "Reading the job and your record",
  match: "Matching what the job asks for",
  write: "Writing the first draft",
  review: "Reviewing it as a hiring manager would",
  revise: "Making the review's edits",
  save: "Saving it to your Library",
};

/** One step's state, with when it started and, once it ended, how long it took. */
export type GenerationStepState = { status: "running" | "done" | "failed" | "skipped"; detail?: string; startedAt?: string; ms?: number };
export type GenerationSteps = Partial<Record<GenerationStepName, GenerationStepState>>;

/** A step starting now. */
export const startStep = (now: Date = new Date()): GenerationStepState => ({ status: "running", startedAt: now.toISOString() });

/** A step ending now, with how long it ran. A step that never ran (skipped) has no time. */
export function endStep(step: GenerationStepState | undefined, status: Exclude<GenerationStepState["status"], "running">, detail?: string, now: Date = new Date()): GenerationStepState {
  const started = step?.startedAt ? Date.parse(step.startedAt) : NaN;
  return {
    status,
    ...(detail ? { detail } : {}),
    ...(step?.startedAt ? { startedAt: step.startedAt } : {}),
    ...(Number.isFinite(started) ? { ms: Math.max(0, now.getTime() - started) } : {}),
  };
}

/** The steps with any still running marked as ended: for a generation that failed part way. */
export const endRunning = (steps: GenerationSteps, status: "failed", now: Date = new Date()): GenerationSteps =>
  Object.fromEntries(Object.entries(steps).map(([name, s]) => [name, s?.status === "running" ? endStep(s, status, undefined, now) : s]));

/** How long a step took, or has taken so far by `now`; null when it has no time (not started, skipped, or an older run). */
export function stepMs(step: GenerationStepState | undefined, now: number): number | null {
  if (!step) return null;
  if (typeof step.ms === "number") return step.ms;
  if (step.status !== "running" || !step.startedAt) return null;
  const started = Date.parse(step.startedAt);
  return Number.isFinite(started) ? Math.max(0, now - started) : null;
}

/** The time all the steps took, or have taken so far: the work, without the wait for a worker or for the user's review. */
export const stepsMs = (steps: GenerationSteps, now: number): number => GENERATION_STEPS.reduce((n, name) => n + (stepMs(steps[name], now) ?? 0), 0);

/** "8s", "1m 05s", "1h 02m". */
export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

/** Share of the steps that are no longer running, for a progress bar. */
export function generationProgress(steps: GenerationSteps): number {
  return GENERATION_STEPS.filter((n) => steps[n] && steps[n]!.status !== "running").length / GENERATION_STEPS.length;
}

/** What a resume is written from. */
export type GenerationSource = "record" | "base_resume";

/** How a requirement came out: in the record, partly, or not in it. */
export const VERDICTS = ["met", "partial", "missing"] as const;
export type Verdict = (typeof VERDICTS)[number];

export const REQUIREMENT_KINDS = ["must", "nice", "keyword", "company"] as const;
export type RequirementKind = (typeof REQUIREMENT_KINDS)[number];

export const REQUIREMENT_KIND_LABEL: Record<RequirementKind, string> = {
  must: "Must have",
  nice: "Nice to have",
  keyword: "Keywords",
  company: "From the company",
};

/**
 * What a requirement is, which decides where it may appear on a resume. An `experience` is a statement about a track
 * record; a `skill` is a tool, technology or technical area (it may go in bullets and the skills lines); a `domain` is
 * the field, product type or audience (a few words in the summary at most); a `trait` is a way of working (shown by what
 * was done, never named); `logistics` is a condition such as relocation (never on the resume).
 */
export const REQUIREMENT_USES = ["experience", "skill", "domain", "trait", "logistics"] as const;
export type RequirementUse = (typeof REQUIREMENT_USES)[number];

export const REQUIREMENT_USE_LABEL: Record<RequirementUse, string> = {
  experience: "Experience",
  skill: "Skill",
  domain: "Field",
  trait: "Way of working",
  logistics: "Condition",
};

/** How much a requirement counts toward the match. Must-haves count most, the company's own words least. */
export const REQUIREMENT_WEIGHT: Record<RequirementKind, number> = { must: 5, nice: 2, keyword: 2, company: 1 };
/** What one of the few things a job is really about counts, whatever list it came from. */
export const CORE_WEIGHT = 8;
/** What a must-have that is a way of working counts ("Comfortable with ambiguity"): it is shown, never the point of a bullet. */
export const TRAIT_WEIGHT = 2;

/**
 * How much a requirement counts, once matching has said what it is: the job's core counts most, a way of working little,
 * and the rest by the list it came from.
 */
export function requirementWeight(r: Pick<Requirement, "kind" | "use" | "core">): number {
  if (r.core && r.kind !== "company" && r.use !== "logistics") return CORE_WEIGHT;
  if (r.use === "trait") return Math.min(TRAIT_WEIGHT, REQUIREMENT_WEIGHT[r.kind]);
  return REQUIREMENT_WEIGHT[r.kind];
}

/**
 * One thing the job asks for, lined up against the source the resume is written from. `refs` are ids of record items
 * (facts, skills, projects, certifications) that answer it; `evidence` is the same in words, for the review screen.
 * `userHas` is the user saying "I have this": it is written in whatever the record says.
 */
export type Requirement = {
  id: string;
  text: string;
  kind: RequirementKind;
  weight: number;
  verdict: Verdict;
  refs: string[];
  evidence: string[];
  userHas: boolean;
  note: string;
  /** What it is. Missing on a generation made before this was recorded: see `requirementUse`. */
  use?: RequirementUse;
  /** One of the few things the job is really about (full-stack depth for a full-stack job), as matching read it. */
  core?: boolean;
};

/**
 * What the user chose on the review screen, by record id: the telling of each role to write from (`framings`, role id
 * to framing id) and, for a fact whose wordings give different numbers, the wording to use (`wordings`, fact id to
 * wording id).
 */
export type GenerationChoices = { framings: Record<string, string>; wordings: Record<string, string> };
export const emptyChoices = (): GenerationChoices => ({ framings: {}, wordings: {} });

/** A role told more than one way in the record (engineering and product, say), with the telling recommended for the job. */
export type RoleOption = { roleId: string; label: string; framings: { id: string; title: string }[]; recommended: string };

/** One way the record gives a number, with how many of the user's versions of the line say it. */
export type ClashOption = { wordingId: string; text: string; numbers: string[]; count: number };

/**
 * A fact whose wordings give different numbers for the same thing ("activation" up 45% in one, 18% in another), with
 * the wording recommended and why.
 */
export type NumberClash = { factId: string; where: string; measure: string; options: ClashOption[]; recommended: string; reason: string };

/** What the review screen offers besides the requirements: the telling of each role, and the numbers the record disagrees on. */
export type ReviewOptions = { roles: RoleOption[]; clashes: NumberClash[] };
export const emptyReviewOptions = (): ReviewOptions => ({ roles: [], clashes: [] });

/**
 * The user's choices kept only where they pick among what was offered: a known role and one of its tellings, a known
 * clash and one of its wordings. Anything else falls back to what was there before.
 */
export function acceptChoices(input: GenerationChoices, options: ReviewOptions, before: GenerationChoices): GenerationChoices {
  const framings = { ...before.framings };
  for (const role of options.roles) {
    const picked = input.framings[role.roleId];
    if (picked && role.framings.some((f) => f.id === picked)) framings[role.roleId] = picked;
  }
  const wordings = { ...before.wordings };
  for (const clash of options.clashes) {
    const picked = input.wordings[clash.factId];
    if (picked && clash.options.some((o) => o.wordingId === picked)) wordings[clash.factId] = picked;
  }
  return { framings, wordings };
}

/**
 * What a requirement is. Before the model has said, the job's technologies are skills, other keywords are fields and
 * sentences are experience; the company's own words are never a skill.
 */
export function requirementUse(r: Pick<Requirement, "kind" | "use">): RequirementUse {
  if (r.use) return r.use;
  return r.kind === "keyword" || r.kind === "company" ? "domain" : "experience";
}

/** What a resume needs to start from the review screen's defaults. */
export type Qualifiable = Pick<Requirement, "kind" | "verdict" | "userHas" | "use">;

/** Whether a requirement counts toward the match: conditions such as relocation and the company's own values (tone, not something to have) do not. */
const counted = (r: Pick<Requirement, "use"> & Partial<Pick<Requirement, "kind">>) => r.use !== "logistics" && r.kind !== "company";

/** What the user answered for one requirement on the review screen. */
export type ReviewAnswer = { id: string; userHas: boolean; note: string };

/** A generation as the page and the job drawer see it. */
export type GenerationItem = {
  id: string;
  jobId: string;
  documentId: string | null;
  status: GenerationStatus;
  source: GenerationSource;
  recordVersion: number | null;
  requirements: Requirement[];
  /** What the user chose on the review screen, and what it offered. */
  choices: GenerationChoices;
  reviewOptions: ReviewOptions;
  skipReview: boolean;
  steps: GenerationSteps;
  notes: string[];
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
};

/** Shown when there is neither a career record nor a base resume to write from. The page links to the Library for it. */
export const NO_SOURCE_MESSAGE = "There is nothing to write from yet. Add a resume to your Library first.";

/** A resume or cover letter linked to a job, for the job's Documents section. */
export type JobDocument = {
  id: string;
  kind: "resume" | "cover_letter";
  origin: string;
  title: string;
  version: number;
  locked: boolean;
  updatedAt: string;
};

/** What the job drawer and the resume page need to know about writing a resume for a job. */
export type JobResumeState = {
  /** The newest generation for the job, or null when none was ever asked for. */
  generation: GenerationItem | null;
  /** The job's generated resume, once written: where Open resume goes. */
  documentId: string | null;
  documents: JobDocument[];
};

/** A generation in progress (or just finished) with the job it is for, for the sidebar card and its toasts. */
export type ActiveGeneration = GenerationItem & { jobLabel: string };

/**
 * The candidate is assumed to be qualified: whatever the source does not fully show of the experience and skills a job
 * asks for in its must-haves and nice-to-haves is taken as something they have but have not written down yet, so it is
 * worked into the resume. Keywords, the field the company works in, ways of working (an interest in fandom, "ownership"),
 * the company's own values and conditions such as relocation are the user's pick and start unticked. Anything already
 * marked, with its note, stays as it is. The review screen starts from this (the user can untick any or tick more), and
 * a generation with the review turned off is written from it.
 */
export function assumeQualified<T extends Qualifiable>(requirements: T[]): T[] {
  return requirements.map((r) => {
    const use = requirementUse(r);
    return !r.userHas && r.verdict !== "met" && (r.kind === "must" || r.kind === "nice") && (use === "experience" || use === "skill") ? { ...r, userHas: true } : r;
  });
}

/** Share of the requirements' weight the source answers: met counts in full, partial for half, and whatever the user says they have in full. 0 to 1. Conditions such as relocation and the company's values are not counted. */
export function matchScore(requirements: (Pick<Requirement, "weight" | "verdict" | "userHas" | "use"> & Partial<Pick<Requirement, "kind">>)[]): number {
  const list = requirements.filter(counted);
  const total = list.reduce((n, r) => n + r.weight, 0);
  if (total === 0) return 0;
  const got = list.reduce((n, r) => n + r.weight * (r.verdict === "met" || r.userHas ? 1 : r.verdict === "partial" ? 0.5 : 0), 0);
  return got / total;
}
