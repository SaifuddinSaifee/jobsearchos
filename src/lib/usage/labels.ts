import type { LlmStep, RecordedAction } from "@/lib/llm/names";

/** Plain-language names for the usage page. A `Record` over the unions, so adding an action or step without a label fails to compile. */
export const ACTION_LABELS: Record<RecordedAction, string> = {
  "upload-resume": "Upload a resume",
  "fill-job-details": "Fill in job details",
  "research-company": "Research a company",
  "regroup-role": "Regroup a role",
  "add-job": "Add a job",
  "find-contacts": "Find contacts",
  "index-resume": "Read a resume",
  "read-career-source": "Read a career source",
  "eval-resume": "Resume eval (script)",
  "eval-jobs": "Job eval (script)",
  "snapshot-job": "Job snapshot (script)",
  unknown: "Unattributed",
};

export const STEP_LABELS: Record<LlmStep, string> = {
  "parse-resume": "Parse resume",
  "extract-job": "Extract job",
  "extract-additional-details": "Extract extra details",
  "research-company": "Summarize company",
  "extract-posting-people": "People named in the posting",
  "find-people-web": "People found on the web",
  "rank-contacts": "Rank contacts",
  "group-bullets": "Group bullets",
  "classify-cover-paragraphs": "Classify cover letter",
  "generate-document": "Write a document",
};

/** Rows keep working after a name is retired from the code, so unknown keys show as they are stored. */
export const actionLabel = (key: string): string => (ACTION_LABELS as Record<string, string>)[key] ?? key;
export const stepLabel = (key: string): string => (STEP_LABELS as Record<string, string>)[key] ?? key;

/** "zai-org/GLM-5.3-Flash" becomes "GLM-5.3-Flash": the organization is noise in a table. */
export const modelLabel = (model: string): string => model.split("/").pop() ?? model;
