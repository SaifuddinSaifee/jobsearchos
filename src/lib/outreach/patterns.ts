// Pure and client-safe: used by the contact editor and the email finder.

const clean = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");

export const PATTERN_IDS = ["first.last", "first", "flast", "firstlast", "firstl", "first_last", "f.last", "last", "lastf"] as const;
export type PatternId = (typeof PATTERN_IDS)[number];

/** The formats tried when nothing is known about the company, most common first. */
const DEFAULT_ORDER: PatternId[] = ["first.last", "first", "flast", "firstlast", "firstl", "first_last"];

const FORMAT: Record<PatternId, (first: string, last: string) => string> = {
  "first.last": (f, l) => `${f}.${l}`,
  first: (f) => f,
  flast: (f, l) => `${f[0]}${l}`,
  firstlast: (f, l) => `${f}${l}`,
  firstl: (f, l) => `${f}${l[0]}`,
  first_last: (f, l) => `${f}_${l}`,
  "f.last": (f, l) => `${f[0]}.${l}`,
  last: (_f, l) => l,
  lastf: (f, l) => `${l}${f[0]}`,
};

/** First and last name, cleaned of accents and punctuation; null when there is no usable pair. */
export function nameParts(fullName: string): { first: string; last: string } | null {
  const parts = fullName.trim().split(/\s+/).map(clean).filter(Boolean);
  return parts.length >= 2 ? { first: parts[0], last: parts[parts.length - 1] } : null;
}

export function applyPattern(id: PatternId, fullName: string, domain: string): string | null {
  const p = nameParts(fullName);
  return p && domain ? `${FORMAT[id](p.first, p.last)}@${domain}` : null;
}

/** Which formats produce this address for this person (usually one). Learned from addresses already known at a company. */
export function detectPatterns(fullName: string, email: string): PatternId[] {
  const p = nameParts(fullName);
  const local = email.split("@")[0]?.toLowerCase();
  if (!p || !local) return [];
  return PATTERN_IDS.filter((id) => FORMAT[id](p.first, p.last) === local);
}

/**
 * Likely addresses for someone whose email is not known. `learned` are formats already seen at this company
 * (tried first). These are guesses: nothing here confirms the address exists.
 */
export function suggestEmails(fullName: string, domain: string, learned: PatternId[] = []): string[] {
  const order = [...new Set([...learned, ...DEFAULT_ORDER])];
  return [...new Set(order.map((id) => applyPattern(id, fullName, domain)).filter((e): e is string => e !== null))];
}
