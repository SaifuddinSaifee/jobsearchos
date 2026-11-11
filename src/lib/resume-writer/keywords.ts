import { normalizeText } from "@/lib/career/normalize";
import { containsPhrase, type JobInput } from "./context";
import { requirementUse, type Requirement } from "./types";
import type { WrittenResume } from "./write";

// Which of the job's own terms the resume uses, and whether it overdoes them. An applicant tracking system matches the
// posting's words literally, but a person reads the resume too, so this is checked in code after writing, not left to the
// prompt: it tells the user what was worked in, and lets the writer be asked once more when the wording was copied from
// the posting, a term is used in too many places, or a way of working is named instead of shown.

/** Everything the resume says in words, as one normalized text to look for terms in. */
export function resumeText(w: WrittenResume): string {
  return normalizeText(
    [
      w.summary,
      ...w.roles.flatMap((r) => [r.plan.title, ...r.bullets.map((b) => b.text)]),
      ...w.projects.flatMap((p) => [p.plan.name, p.plan.technologies.join(" "), ...p.bullets.map((b) => b.text)]),
      ...w.skills.flatMap((s) => s.items),
      ...w.certifications.map((c) => c.name),
    ].join("\n"),
  );
}

export type KeywordCoverage = {
  /** Job terms the resume uses. */
  present: string[];
  /** Job terms it leaves out although the record, or what the user says they have, supports them. */
  missing: string[];
};

export type RequirementLike = Pick<Requirement, "text" | "kind" | "verdict" | "userHas" | "use">;

/**
 * Splits the job's terms (see `jobTerms`: only what the candidate has) into those the resume uses and those it left
 * out. Nothing is asked of the writer for the ones left out; they are reported so the user can add them by hand.
 */
export function keywordCoverage(w: WrittenResume, terms: string[]): KeywordCoverage {
  const text = resumeText(w);
  const out: KeywordCoverage = { present: [], missing: [] };
  for (const term of terms) (containsPhrase(text, normalizeText(term)) ? out.present : out.missing).push(term);
  return out;
}

const list = (xs: string[]) => xs.join(", ");

/** The coverage in words, for the notes on a finished resume. */
export function coverageNotes(c: KeywordCoverage): string[] {
  return [
    ...(c.present.length > 0 ? [`Job terms worked in: ${list(c.present)}.`] : []),
    ...(c.missing.length > 0 ? [`Job terms not worked in: ${list(c.missing)}.`] : []),
  ];
}

/** A run of this many words in a row, shared with the posting, is copying and not wording of the candidate's own. */
export const COPY_RUN = 6;
/** A term used in more places than this (the summary and each bullet are places) reads as stuffing. */
export const MAX_PLACES = 3;
/** A way of working named in this few words ("Adaptability", "Ownership mindset") is checked for being named bare. */
const MAX_TRAIT_WORDS = 3;

const wordsOf = (text: string) => normalizeText(text).split(" ").filter(Boolean);

/** The runs of `run` or more words that `text` shares, word for word, with any of the sources. */
export function copiedPhrases(text: string, sources: string[], run = COPY_RUN): string[] {
  const grams = new Set<string>();
  for (const source of sources) {
    const w = wordsOf(source);
    for (let i = 0; i + run <= w.length; i++) grams.add(w.slice(i, i + run).join(" "));
  }
  const w = wordsOf(text);
  const out: string[] = [];
  let start = -1;
  for (let i = 0; i + run <= w.length; i++) {
    const hit = grams.has(w.slice(i, i + run).join(" "));
    if (hit && start < 0) start = i;
    if (!hit && start >= 0) {
      out.push(w.slice(start, i - 1 + run).join(" "));
      start = -1;
    }
  }
  if (start >= 0) out.push(w.slice(start).join(" "));
  return out;
}

export type Stuffing = {
  /** Wording lifted from the posting or the company's own text. */
  copied: string[];
  /** Job terms used in more than `MAX_PLACES` places. */
  overused: string[];
  /** Ways of working named outright instead of shown. */
  bare: string[];
};

export const stuffingCount = (s: Stuffing) => s.copied.length + s.overused.length + s.bare.length;

/** Everything the resume says in sentences: the summary, then each bullet. Skills lines are not sentences. */
const sentencesOf = (w: WrittenResume) => [w.summary, ...w.roles.flatMap((r) => r.bullets.map((b) => b.text)), ...w.projects.flatMap((p) => p.bullets.map((b) => b.text))];

/** Looks for the signs of a resume written for a keyword scanner instead of a person. */
/** A requirement whose own wording the resume may echo: a condition the user asked to mention, or experience or a skill the candidate has. */
function echoAllowed(r: RequirementLike): boolean {
  const use = requirementUse(r);
  return use === "logistics" || ((use === "experience" || use === "skill") && (r.verdict === "met" || r.userHas));
}

export function checkStuffing(w: WrittenResume, job: Pick<JobInput, "aboutCompany" | "responsibilities" | "companyProfile">, requirements: RequirementLike[], terms: string[]): Stuffing {
  const units = sentencesOf(w).filter(Boolean);
  const normalized = units.map(normalizeText);

  const sources = [
    job.aboutCompany ?? "",
    job.companyProfile?.about ?? "",
    job.companyProfile?.principles ?? "",
    ...job.responsibilities,
    // Not a condition (the summary's mention line restates it on purpose), and not experience or a skill the candidate
    // has: saying "5+ years of product design experience" as the posting does is the keyword match a screen looks for.
    ...requirements.filter((r) => r.kind !== "keyword" && !echoAllowed(r)).map((r) => r.text),
  ].filter(Boolean);
  const copied = [...new Set(units.flatMap((u) => copiedPhrases(u, sources)))].slice(0, 3);

  const places = (key: string) => normalized.filter((u) => containsPhrase(u, key)).length;
  const overused = terms.filter((t) => places(normalizeText(t)) > MAX_PLACES);

  const bare = requirements
    .filter((r) => requirementUse(r) === "trait" && wordsOf(r.text).length <= MAX_TRAIT_WORDS)
    .map((r) => r.text)
    .filter((t) => places(normalizeText(t)) > 0);

  return { copied, overused, bare };
}

/** What to tell the writer when it is asked again. */
export function stuffingFeedback(s: Stuffing): string[] {
  return [
    ...(s.copied.length > 0 ? [`Your last answer copied wording from the posting or the company's own text: ${s.copied.map((c) => `"${c}"`).join(", ")}. Say it in your own words, from what the candidate did.`] : []),
    ...(s.overused.length > 0 ? [`These terms appear in too many places: ${s.overused.join(", ")}. Use each once, where it fits, and the top few in the summary and skills only.`] : []),
    ...(s.bare.length > 0 ? [`Do not name these ways of working, show them through what was done: ${s.bare.join(", ")}.`] : []),
  ];
}

/** What is left over after the last try, for the notes on a finished resume. */
export function stuffingNotes(s: Stuffing): string[] {
  return [
    ...(s.copied.length > 0 ? [`Some wording is close to the posting's own: ${s.copied.map((c) => `"${c}"`).join(", ")}.`] : []),
    ...(s.overused.length > 0 ? [`Used often: ${s.overused.join(", ")}.`] : []),
    ...(s.bare.length > 0 ? [`Named outright: ${s.bare.join(", ")}.`] : []),
  ];
}
