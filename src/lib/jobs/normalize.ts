// Kept apart from dedup.ts (which hashes with node:crypto) so browser code can normalize names too.

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
