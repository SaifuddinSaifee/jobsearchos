/**
 * The names a model call is filed under. Kept free of imports so client components (the AI usage page) can use them.
 * An action is the user-level unit of work that caused the calls; a step is one kind of call inside it.
 */
export const LLM_ACTIONS = [
  "upload-resume",
  "fill-job-details",
  "research-company",
  "regroup-role",
  "add-job",
  "find-contacts",
  "index-resume",
  "read-career-source",
  "eval-resume",
  "eval-jobs",
  "snapshot-job",
] as const;

export const LLM_STEPS = [
  "parse-resume",
  "extract-job",
  "extract-additional-details",
  "research-company",
  "extract-posting-people",
  "find-people-web",
  "rank-contacts",
  "group-bullets",
  "classify-cover-paragraphs",
  "generate-document",
] as const;

export type LlmAction = (typeof LLM_ACTIONS)[number];
export type LlmStep = (typeof LLM_STEPS)[number];

/** A call made outside any `withLlmContext`. It still works, but is filed here so it can be found and fixed. */
export const UNKNOWN_ACTION = "unknown";
export type RecordedAction = LlmAction | typeof UNKNOWN_ACTION;

export type LlmCallStatus = "ok" | "error" | "stopped";

/** Ids that link a call back to what it was for. None are foreign keys: usage history outlives what it points at. */
export type LlmIds = {
  jobId?: string;
  companyId?: string;
  documentId?: string;
  documentVersionId?: string;
  proposalId?: string;
  searchId?: string;
  queueItemId?: string;
};
