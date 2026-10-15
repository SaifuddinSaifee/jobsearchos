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

/** The named stages shown while it works, in order. */
export const GENERATION_STEPS = ["read", "match", "write", "save"] as const;
export type GenerationStepName = (typeof GENERATION_STEPS)[number];

export const GENERATION_STEP_LABEL: Record<GenerationStepName, string> = {
  read: "Reading the job and your record",
  match: "Matching what the job asks for",
  write: "Writing and reviewing the resume",
  save: "Saving it to your Library",
};

export type GenerationStepState = { status: "running" | "done" | "failed" | "skipped"; detail?: string };
export type GenerationSteps = Partial<Record<GenerationStepName, GenerationStepState>>;

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
};

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

/** Whether a requirement counts toward the match: conditions such as relocation do not. */
const counted = (r: Pick<Requirement, "use">) => r.use !== "logistics";

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

/** Share of the requirements' weight the source answers: met counts in full, partial for half, and whatever the user says they have in full. 0 to 1. Conditions such as relocation are not counted. */
export function matchScore(requirements: Pick<Requirement, "weight" | "verdict" | "userHas" | "use">[]): number {
  const list = requirements.filter(counted);
  const total = list.reduce((n, r) => n + r.weight, 0);
  if (total === 0) return 0;
  const got = list.reduce((n, r) => n + r.weight * (r.verdict === "met" || r.userHas ? 1 : r.verdict === "partial" ? 0.5 : 0), 0);
  return got / total;
}
