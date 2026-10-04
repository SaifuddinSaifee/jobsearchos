import { createHash } from "node:crypto";

const COMPANY_SUFFIX = /\b(inc|incorporated|llc|ltd|limited|gmbh|corp|corporation|co|company|plc|ag|sa|bv)\b/g;

/** Lowercase, drop punctuation and company suffixes, collapse whitespace. */
export function normalizeForDedup(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(COMPANY_SUFFIX, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Hash of normalized company + title + location. */
export function dedupKey(job: { company: string; title: string; location: string }): string {
  const parts = [job.company, job.title, job.location].map(normalizeForDedup).join("|");
  return createHash("sha256").update(parts).digest("hex");
}
