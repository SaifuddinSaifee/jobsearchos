import { normalizeForDedup } from "@/lib/jobs/normalize";

// Text normalization shared by matching and de-duplication. Pure, so it can run in the browser too.

/** Lowercase, no accents, no punctuation, single spaces. "Led a team of 5." and "led a team of 5" match. */
export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Same rule as the companies directory (`normalizeCompanyName`), without importing its database code. */
export function normalizeEmployer(name: string): string {
  return normalizeForDedup(name) || name.toLowerCase().trim();
}

const TITLE_WORDS: Record<string, string> = {
  sr: "senior",
  snr: "senior",
  jr: "junior",
  mgr: "manager",
  eng: "engineer",
  dev: "developer",
  swe: "software engineer",
  sde: "software development engineer",
  pm: "product manager",
};

/** A job title with common abbreviations spelled out: "Sr. PM" and "Senior Product Manager" match. */
export function normalizeTitle(title: string): string {
  return normalizeText(title)
    .split(" ")
    .map((w) => TITLE_WORDS[w] ?? w)
    .join(" ")
    .trim();
}

const STOP = new Set(["a", "an", "the", "of", "and", "or", "for", "to", "in", "at", "on", "with"]);

export function tokens(value: string, normalize: (v: string) => string = normalizeText): Set<string> {
  return new Set(normalize(value).split(" ").filter((w) => w && !STOP.has(w)));
}

/** Overlap of two token sets, 0 to 1. Two empty sets are not similar. */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return shared / (a.size + b.size - shared);
}

export const titleSimilarity = (a: string, b: string) => jaccard(tokens(a, normalizeTitle), tokens(b, normalizeTitle));
export const textSimilarity = (a: string, b: string) => jaccard(tokens(a), tokens(b));

/** A short, stable, non-cryptographic hash (FNV-1a) for item keys. Not for security. */
export function hash8(value: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
