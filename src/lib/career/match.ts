import type { Employer, Framing, Role } from "./schema";
import { mergeDates, monthOf, overlapMonths, spanMonths, toSpan, type DateParts } from "./dates";
import { normalizeEmployer, normalizeTitle, titleSimilarity } from "./normalize";

// Deciding which employer and role in the record an incoming role belongs to. Pure; the review has the last word.

/** Titles this alike (0 to 1) are treated as the same title. */
export const SAME_TITLE = 0.8;
/** Roles overlapping for this many months, or this share of the shorter one, are the same period. */
export const FRAMING_MONTHS = 4;
export const FRAMING_SHARE = 0.5;

export function matchEmployer(
  employers: Employer[],
  name: string,
  companyId: string | null,
): Employer | null {
  if (companyId) {
    const byCompany = employers.find((e) => e.companyId === companyId);
    if (byCompany) return byCompany;
  }
  const key = normalizeEmployer(name);
  if (!key) return null;
  return employers.find((e) => normalizeEmployer(e.name) === key || e.names.some((n) => normalizeEmployer(n) === key)) ?? null;
}

export type RoleMatch =
  | { kind: "same"; role: Role; framing: Framing | null }
  | { kind: "framing"; role: Role }
  | { kind: "new"; note: string | null };

export type RoleQuery = DateParts & { title: string };

const roleDates = (r: Role): DateParts => ({ start: r.start, end: r.end, current: r.current });

const sameTitle = (a: string, b: string) => {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  return na !== "" && nb !== "" && (na === nb || titleSimilarity(a, b) >= SAME_TITLE);
};

/**
 * Same role, a new framing of one, or a new role. Order of the checks:
 * 1. a role that has a framing with this title, and overlaps in time (or one side has no readable dates): same;
 * 2. a role in the same period under another title: a framing;
 * 3. otherwise a new role. Small overlaps (a promotion listed back to back) stay new roles.
 */
export function matchRole(employer: Employer | null, query: RoleQuery, now: Date = new Date()): { match: RoleMatch; candidates: Role[] } {
  if (!employer) return { match: { kind: "new", note: null }, candidates: [] };
  const nowMonth = monthOf(now);
  const incoming = toSpan(query);

  const scored = employer.roles.map((role) => {
    const span = toSpan(roleDates(role));
    const overlap = incoming && span ? overlapMonths(incoming, span, nowMonth) : 0;
    return { role, span, overlap };
  });
  const candidates = [...scored].sort((a, b) => b.overlap - a.overlap).map((s) => s.role);

  for (const { role, span, overlap } of scored) {
    const framing = role.framings.find((f) => sameTitle(f.title, query.title));
    if (!framing) continue;
    if (overlap > 0 || !incoming || !span) return { match: { kind: "same", role, framing }, candidates };
  }

  if (incoming) {
    let best: { role: Role; overlap: number } | null = null;
    for (const { role, span, overlap } of scored) {
      if (!span || overlap === 0) continue;
      const shorter = Math.min(spanMonths(incoming, nowMonth), spanMonths(span, nowMonth));
      const fuzzy = incoming.fuzzy || span.fuzzy;
      const long = overlap >= FRAMING_MONTHS;
      const share = overlap >= shorter * FRAMING_SHARE;
      // Fuzzy dates (a bare year) overlap by accident, so they need both tests.
      const same = fuzzy ? long && share : long || share;
      if (same && (!best || overlap > best.overlap)) best = { role, overlap };
    }
    if (best) return { match: { kind: "framing", role: best.role }, candidates };

    const slight = scored.find((s) => s.overlap > 0);
    if (slight) {
      const title = slight.role.framings[0]?.title ?? "another role";
      return { match: { kind: "new", note: `Dates overlap slightly with ${title}.` }, candidates };
    }
  }
  return { match: { kind: "new", note: null }, candidates };
}

/** A note when merging this source's dates into a role would widen or contradict them. */
export function dateConflict(role: Role, incoming: DateParts): boolean {
  return mergeDates(roleDates(role), incoming).conflict;
}

const ANGLES: [string, RegExp][] = [
  ["Design", /\b(design|designer|ux|ui)\b/i],
  ["Product", /\bproduct\b/i],
  ["Data", /\b(data|analytics|analyst|scientist|machine learning|ml|ai)\b/i],
  ["Marketing", /\b(marketing|growth|seo|content|brand)\b/i],
  ["Sales", /\b(sales|account executive|business development|customer success)\b/i],
  ["Program", /\b(program manager|project manager|scrum|delivery manager)\b/i],
  ["Engineering", /\b(engineer|engineering|developer|programmer|software|swe|sde|architect|devops|sre)\b/i],
];

/** A first guess at the angle a title was written for, so the user can confirm or change it. */
export function guessAngle(title: string): string {
  return ANGLES.find(([, re]) => re.test(title))?.[0] ?? "";
}
