import type { JobDraft } from "@/lib/jobs/schema";

/**
 * A result is "clean" (safe to save without a human look) when the essentials were really extracted:
 * a company, a title and some substance (responsibilities or required qualifications).
 * Anything else goes to review, because saved jobs cannot be edited yet.
 */
export function isClean(draft: JobDraft): boolean {
  return (
    draft.company.trim() !== "" &&
    draft.title.trim() !== "" &&
    (draft.responsibilities.length > 0 || draft.requirements.required.length > 0)
  );
}

/** Why a draft was not auto-saved, in one line for the queue. */
export function reviewReason(draft: JobDraft): string {
  const missing: string[] = [];
  if (!draft.company.trim()) missing.push("company");
  if (!draft.title.trim()) missing.push("title");
  if (draft.responsibilities.length === 0 && draft.requirements.required.length === 0) {
    missing.push("responsibilities or requirements");
  }
  return `Could not find: ${missing.join(", ")}. Check and fix the fields, then save.`;
}
