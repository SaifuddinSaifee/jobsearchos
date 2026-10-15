import { normalizeText } from "@/lib/career/normalize";
import type { CareerRecord } from "@/lib/career/schema";
import type { CompanyProfileBase } from "@/lib/companies/types";
import type { JobDetail } from "@/lib/jobs/types";
import { REQUIREMENT_WEIGHT, requirementUse, type Requirement, type RequirementUse } from "./types";

// What the job asks for, and what the source (the career record, or the base resume) can answer it with. No model and
// no database here: the same inputs give the same lists, so it is cheap to test and to run again.

/** The parts of a saved job and its company that a resume is written for. */
export type JobInput = Pick<JobDetail, "title" | "company" | "location" | "technologies" | "responsibilities" | "requirements" | "keywords" | "aboutCompany"> & {
  companyProfile: Pick<CompanyProfileBase, "about" | "principles"> | null;
};

/** How many of each kind are kept, so the review stays short enough to read and the prompt stays small. */
export const MAX_PER_KIND = { must: 18, nice: 10, keyword: 14, company: 4 } as const;
const MAX_TEXT_CHARS = 300;

const clean = (s: string) => s.replace(/\s+/g, " ").trim();
/** The text, cut at `max` characters with "..." when it is longer. */
export const clip = (s: string, max = MAX_TEXT_CHARS): string => (s.length > max ? `${s.slice(0, max - 3).trimEnd()}...` : s);

/** True when the normalized phrase appears in the normalized text as whole words. */
export function containsPhrase(normalizedText: string, normalizedPhrase: string): boolean {
  if (!normalizedPhrase) return false;
  return ` ${normalizedText} `.includes(` ${normalizedPhrase} `);
}

/** The short lines of a Markdown profile field: list items, or lines of plain text. Headings and long prose are left out. */
export function profileLines(markdown: string): string[] {
  return markdown
    .split(/\r?\n/)
    .map((l) => clean(l.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "").replace(/\*\*|__|`/g, "")))
    .filter((l) => l.length >= 8 && l.length <= 160 && !/^#/.test(l));
}

/**
 * Everything the job asks for, as a list to be matched. Must-haves and nice-to-haves come from the requirements,
 * keywords from the technologies and extracted keywords (leaving out any a requirement already says), and the
 * company's own values from its profile. Ids are r1, r2, ... in that order. Every verdict starts as "missing".
 */
export function buildRequirements(job: JobInput): Requirement[] {
  const seen = new Set<string>();
  const out: Omit<Requirement, "id">[] = [];
  const take = (kind: Requirement["kind"], texts: string[], max: number, use: RequirementUse): number => {
    let n = 0;
    for (const raw of texts) {
      const text = clip(clean(raw));
      const key = normalizeText(text);
      if (!key || seen.has(key) || n >= max) continue;
      seen.add(key);
      n++;
      out.push({ text, kind, weight: REQUIREMENT_WEIGHT[kind], verdict: "missing", refs: [], evidence: [], userHas: false, note: "", use });
    }
    return n;
  };

  take("must", job.requirements.required, MAX_PER_KIND.must, "experience");
  take("nice", job.requirements.preferred, MAX_PER_KIND.nice, "experience");

  const stated = out.map((r) => normalizeText(r.text));
  const notStated = (texts: string[]) => texts.filter((t) => !stated.some((s) => containsPhrase(s, normalizeText(t))));
  // The technologies come first, so a long keyword list never crowds a real tool out. They start as skills and the other
  // keywords as fields; the model's reading of each (see match.ts) replaces both.
  const tools = take("keyword", notStated(job.technologies), MAX_PER_KIND.keyword, "skill");
  take("keyword", notStated(job.keywords), MAX_PER_KIND.keyword - tools, "domain");
  take("company", profileLines(job.companyProfile?.principles ?? ""), MAX_PER_KIND.company, "domain");

  return out.map((r, i) => ({ ...r, id: `r${i + 1}` }));
}

/** The most job terms asked for by name, so the prompt and the coverage check stay short. */
export const MAX_JOB_TERMS = 12;

/**
 * The terms the job names, in its own wording, that an applicant tracking system will look for and that the candidate
 * can stand behind: the technologies and the keywords that are skills, once each. A keyword is the candidate's when the
 * source shows it, or the user says they have it (a partial match is not enough: keywords are the user's pick). A technology the job names only inside a sentence
 * ("not just pushed to Vercel") has no verdict of its own, and the sentence being met does not make it the candidate's,
 * so it counts only when the source itself says it (`has`) or the user ticked a requirement that names it. A gap the user
 * left unticked is never a term, a field or a way of working is never a term, and a condition such as relocation is
 * never one. The resume is asked to use them as written, once where they fit.
 */
export function jobTerms(
  job: Pick<JobInput, "technologies">,
  requirements: Pick<Requirement, "text" | "kind" | "verdict" | "userHas" | "use">[],
  has: (normalizedTerm: string) => boolean = () => false,
): string[] {
  const own = new Map(requirements.filter((r) => r.kind === "keyword").map((r) => [normalizeText(r.text), r]));
  const supported = (key: string) => {
    const r = own.get(key);
    if (r) return r.verdict === "met" || r.userHas;
    return has(key) || requirements.some((q) => q.userHas && containsPhrase(normalizeText(q.text), key));
  };
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const raw of [...job.technologies, ...requirements.filter((r) => r.kind === "keyword" && requirementUse(r) === "skill").map((r) => r.text)]) {
    const term = clean(raw);
    const key = normalizeText(term);
    const mine = own.get(key);
    if (!key || seen.has(key) || (mine && requirementUse(mine) !== "skill") || !supported(key)) continue;
    seen.add(key);
    terms.push(term);
  }
  return terms.slice(0, MAX_JOB_TERMS);
}

/** One thing in the source that can answer a requirement: a fact of a role, a skill, a project or a certification. */
export type SourceItem = {
  /** The id of the item in the record, kept on the requirement as the evidence. */
  ref: string;
  kind: "fact" | "skill" | "project" | "certification";
  /** Where it comes from, for the review screen: "Software Engineer at Acme", "Skill", "Project". */
  label: string;
  /** What it says, in the user's own words. */
  text: string;
  normalized: string;
};

const WORDINGS_SHOWN = 3;

/** Everything in a record that can answer a requirement, in the record's order. */
export function indexSource(record: CareerRecord): SourceItem[] {
  const items: SourceItem[] = [];
  const add = (item: Omit<SourceItem, "normalized">) => items.push({ ...item, text: clip(item.text), normalized: normalizeText(item.text) });

  for (const e of record.employers) {
    for (const r of e.roles) {
      const label = `${r.framings[0]?.title || "Role"} at ${e.name}`;
      for (const f of r.facts) {
        const texts = f.wordings.filter((w) => w.form === "bullet").slice(0, WORDINGS_SHOWN).map((w) => w.text);
        if (texts.length > 0) add({ ref: f.id, kind: "fact", label, text: texts.join(" | ") });
      }
    }
  }
  for (const s of record.skills) add({ ref: s.id, kind: "skill", label: s.category ? `Skill, ${s.category}` : "Skill", text: s.name });
  for (const p of record.projects) {
    const wordings = p.wordings.slice(0, WORDINGS_SHOWN).map((w) => w.text);
    add({ ref: p.id, kind: "project", label: `Project ${p.name}`, text: [p.name, p.description, p.technologies.join(", "), ...wordings].filter(Boolean).join(". ") });
  }
  for (const c of record.certifications) add({ ref: c.id, kind: "certification", label: "Certification", text: [c.name, c.issuer].filter(Boolean).join(", ") });
  return items;
}

/** Whether a record has anything to write from: at least one role with a fact. */
export const recordHasExperience = (record: CareerRecord): boolean => record.employers.some((e) => e.roles.some((r) => r.facts.length > 0));
