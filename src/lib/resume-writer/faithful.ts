import { normalizeText } from "@/lib/career/normalize";
import { clip, containsPhrase } from "./context";
import { namesIn, numbersIn } from "./proof";
import type { PlanUser, WritingPlan, WrittenBullet, WrittenResume } from "./write";
import { tidy } from "./write";

// Checks, in code, that the resume still sounds like the candidate: each bullet against the candidate's own lines it
// was written from. What the model is told is in the prompt; this is what it is held to. Findings go to the reviewer
// and the revision, and a bullet the model rewrote out of all recognition is put back to the candidate's own words.

/** One bullet of the resume with what it was written from, under the id the reviewer and the reviser see ("b3"). */
export type BulletItem = {
  id: string;
  /** Where it sits: "Software Engineer at Acme", or a project's name. */
  where: string;
  text: string;
  /** The candidate's own lines it was written from (each wording of each fact it names). */
  sources: string[];
  /** What the candidate said they have that it works in. */
  users: PlanUser[];
  /** Every line of the role it sits in: the context a claim is proven with (its product, tools and team). */
  context: string[];
  /** Where it is in the written resume, to change it there. */
  at: { kind: "role" | "project"; entry: number; bullet: number };
};

/** Every bullet of the resume, numbered in reading order, with its sources. */
export function bulletItems(w: WrittenResume, plan: WritingPlan): BulletItem[] {
  const factTexts = new Map(plan.roles.flatMap((r) => r.facts).map((f) => [f.factId, f.texts]));
  const userById = new Map(plan.users.map((u) => [u.requirementId, u]));
  const items: BulletItem[] = [];
  const add = (b: WrittenBullet, where: string, sources: string[], context: string[], at: BulletItem["at"]) =>
    items.push({ id: `b${items.length + 1}`, where, text: b.text, sources, users: b.userRequirementIds.map((id) => userById.get(id)).filter((u): u is PlanUser => !!u), context, at });
  w.roles.forEach((r, entry) =>
    r.bullets.forEach((b, bullet) =>
      add(b, `${r.plan.title || "Role"} at ${r.plan.employer}`, b.factIds.flatMap((id) => factTexts.get(id) ?? []), r.plan.facts.flatMap((f) => f.texts), { kind: "role", entry, bullet }),
    ),
  );
  w.projects.forEach((p, entry) => {
    const sources = [p.plan.description, ...p.plan.texts].filter(Boolean);
    p.bullets.forEach((b, bullet) => add(b, p.plan.name, sources, sources, { kind: "project", entry, bullet }));
  });
  return items;
}

export type FindingKind =
  | "new-number"
  | "added-outcome"
  | "lost-names"
  | "added-names"
  | "rewritten"
  | "labelled"
  | "unproven"
  | "bare-claim"
  | "merged"
  | "dropped-strong"
  | "too-long"
  | "repeated"
  | "left-out"
  | "generic"
  | "copied"
  | "overused"
  | "named-trait"
  | "missing-mention";
/** Something a code check found. `bullet` is a bullet id ("b3"), or "resume" for the resume as a whole. */
export type Finding = { bullet: string; kind: FindingKind; detail: string };

const STOP = new Set(["with", "from", "that", "this", "into", "their", "they", "them", "were", "have", "been", "over", "across", "using", "used", "also", "more", "than", "each", "every", "which", "while", "about", "after", "before"]);
const words = (text: string) => normalizeText(text).split(" ").filter((w) => w.length >= 4 && !STOP.has(w));

export { namesIn, numbersIn };

/** A clause that states a result or a purpose, tacked on after a comma. */
const OUTCOME = /,\s*(so that|so|giving|enabling|allowing|ensuring|helping|letting|which (?:meant|let|gave|made|helped|allowed|enabled))\b(.*)$/i;

/** A bullet that opens on a short phrase and a comma ("On realtime voice agents, built..."): a term worn as a label. */
const LABEL = /^(?:on|for|with|in|across|around)\s+([^,]{3,60}),\s/i;

/** The term a bullet wears as a label in front of what was done, when the phrase is something the user has or a job term. */
export function labelIn(text: string, said: string[]): string | null {
  const m = LABEL.exec(text);
  if (!m) return null;
  const phrase = normalizeText(m[1]);
  return said.some((s) => normalizeText(s) && (phrase.includes(normalizeText(s)) || normalizeText(s).includes(phrase))) ? m[1] : null;
}

/**
 * What the user said they have, with a note, that no bullet proves: no bullet cites it or names its skill. A claim with
 * detail listed only in the skills lines, or not at all, is not yet shown as work. A claim with no note has nothing to
 * be told with, so the skills lines are its place.
 */
export function unproven(items: BulletItem[], users: PlanUser[]): PlanUser[] {
  const cited = new Set(items.flatMap((i) => i.users.map((u) => u.requirementId)));
  const said = items.map((i) => normalizeText(i.text));
  return users.filter((u) => !u.bare && !YEARS.test(u.text) && !cited.has(u.requirementId) && !u.skills.some((s) => said.some((t) => t.includes(normalizeText(s)))));
}

/** A claim about years of experience ("5+ years"): the dates show it, and no bullet can, so it is never asked of one. */
const YEARS = /\b\d+\s*\+?\s*years?\b/i;

/** "Large Language Model (LLM)": an acronym written out, whose capitals are the acronym's, not names. */
const EXPANSION = /\b(?:[A-Z][a-z]+[- ]){1,6}[A-Z][a-z]+\s*\(([A-Z][A-Za-z]{1,9})\)/g;

/**
 * The tools, products and job terms a bullet names that its own lines (and the claims it cites) do not: a claim or a
 * term moved into a line about other work, such as "Claude Code" put into a line about a product's own logging layer.
 * The job's terms are the candidate's, but that does not make them part of every line. A name spelled the posting's way
 * ("PostgreSQL" for "Postgres") counts as the same name.
 */
export function addedNames(item: BulletItem, terms: string[]): string[] {
  const context = item.users.length > 0 ? item.context : [];
  const allowed = normalizeText([...item.sources, ...context, ...item.users.flatMap((u) => [u.text, u.note, ...u.skills])].join(" "));
  const stems = new Set(allowed.split(" ").filter((w) => w.length >= 5).map((w) => w.slice(0, 5)));
  const own = (x: string) => {
    const key = normalizeText(x);
    return !key || containsPhrase(allowed, key) || (key.length >= 5 && !key.includes(" ") && stems.has(key.slice(0, 5)));
  };
  const said = normalizeText(item.text);
  const fromTerms = terms.filter((t) => containsPhrase(said, normalizeText(t)) && !own(t));
  const fromNames = namesIn(item.text.replace(EXPANSION, "$1")).filter((n) => !own(n) && !fromTerms.some((t) => containsPhrase(normalizeText(t), normalizeText(n))));
  return [...new Set([...fromTerms, ...fromNames])];
}

/** A summary sentence that joins results from different lines: the numbers it gives are never found together in one clause of the record. */
export function mergedResults(summary: string, plan: WritingPlan): string[] {
  const clauses = [...plan.roles.flatMap((r) => r.facts.flatMap((f) => f.texts)), ...plan.projects.flatMap((p) => p.texts)]
    .flatMap((t) => t.split(/;\s+|\.\s+/))
    .map((c) => new Set(numbersIn(c)));
  return summary
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => {
      const nums = [...new Set(numbersIn(sentence))].filter((n) => clauses.some((c) => c.has(n)));
      return nums.length >= 2 && !clauses.some((c) => nums.every((n) => c.has(n)));
    });
}


/**
 * Where a role leaves out one of the results marked to keep while a bullet proves less, aimed at that bullet: the weakest
 * of the role's bullets that does not prove a claim with a note (that one is there for the claim). One bullet per
 * result left out.
 */
export function droppedStrong(w: WrittenResume, items: BulletItem[]): Finding[] {
  const out: Finding[] = [];
  w.roles.forEach((role, entry) => {
    const cited = new Set(role.bullets.flatMap((b) => b.factIds));
    const missing = role.plan.facts.filter((f) => f.keep && !cited.has(f.factId)).sort((a, b) => b.proof - a.proof);
    if (missing.length === 0 || role.bullets.length === 0) return;
    const proofOf = new Map(role.plan.facts.map((f) => [f.factId, f.proof]));
    const strength = (b: WrittenBullet) => Math.max(0, ...b.factIds.map((id) => proofOf.get(id) ?? 0));
    const roleItems = items.filter((i) => i.at.kind === "role" && i.at.entry === entry);
    const open = role.bullets
      .map((b, bullet) => ({ b, item: roleItems.find((i) => i.at.bullet === bullet) }))
      .filter((x) => x.item && !x.item.users.some((u) => !u.bare))
      .sort((a, b) => strength(a.b) - strength(b.b));
    missing.forEach((fact, n) => {
      const target = open[n];
      if (!target?.item || strength(target.b) >= fact.proof) return;
      out.push({ bullet: target.item.id, kind: "dropped-strong", detail: `proves less than one of the role's strongest results, which is left out: "${clip(fact.texts[0], 120)}"; put that in its place` });
    });
  });
  return out;
}

/**
 * A claim the user gave with no note, placed where it needs detail it does not have: in the summary, or as the whole of
 * a bullet. Its place is the skills lines, or inside a bullet whose own lines show that work.
 */
export function bareClaimFindings(w: WrittenResume, items: BulletItem[], users: PlanUser[]): Finding[] {
  const out: Finding[] = [];
  const summary = normalizeText(w.summary);
  for (const u of users.filter((x) => x.bare)) {
    const said = (u.skills.length > 0 ? u.skills : [u.text]).find((n) => containsPhrase(summary, normalizeText(n)));
    if (said) out.push({ bullet: "summary", kind: "bare-claim", detail: `names "${said}", which the candidate gave no detail for; keep it to the skills lines or a bullet whose own lines show that work` });
  }
  for (const item of items) {
    if (item.sources.length === 0 && item.users.length > 0 && item.users.every((u) => u.bare)) {
      out.push({ bullet: item.id, kind: "bare-claim", detail: `is built only on "${item.users[0].text}", which the candidate gave no detail for; fold it into a bullet whose lines show that work, or into the skills lines` });
    }
  }
  return out;
}

/** Share of the words of `text` that `against` also has, 0 to 1 (1 when `text` has no words that count). */
function overlap(text: string, against: Set<string>): number {
  const w = words(text);
  return w.length === 0 ? 1 : w.filter((x) => against.has(x)).length / w.length;
}

/** Below this share of its words found in its sources (and what the user said), a bullet reads as written anew. */
export const REWRITE_FLOOR = 0.5;
/** Below this, and with nothing the user said worked in, it is put back to the candidate's own words. */
export const REVERT_FLOOR = 0.35;
/** A source with this many names should keep at least half of them. */
const MIN_NAMES = 3;

/**
 * A line written in Title Case ("SaaS Platform for Document Collection and Workflow Automation"), such as a project's
 * subtitle: its capitals are style, not names of tools or teams.
 */
function isTitleCase(text: string): boolean {
  const words = text.split(/\s+/).map((w) => w.replace(/[^A-Za-z.-]/g, "")).filter((w) => w.length >= 4);
  // In a sentence the ordinary words are lowercase ("Built pipelines with Attio and Crisp"); in a title they are not.
  return words.filter((w) => /^[A-Z]/.test(w)).length >= 4 && !words.some((w) => /^[a-z]/.test(w) && !STOP.has(w.toLowerCase()));
}

/**
 * What `item` is allowed to say: its sources, what the user said about it, and the job's terms. A bullet that proves
 * something the user said they have may also use the words of its role's other lines, since a claim is made believable
 * with the real product, tools and team of the place it happened.
 */
function allowedWords(item: BulletItem, terms: string[]): Set<string> {
  const context = item.users.length > 0 ? item.context : [];
  return new Set(words([...item.sources, ...context, ...item.users.flatMap((u) => [u.text, u.note, ...u.skills]), ...terms].join(" ")));
}

/** What each bullet does that the candidate's own lines do not: new numbers, added results, lost names, a full rewrite. */
export function checkFaithful(items: BulletItem[], terms: string[]): Finding[] {
  const findings: Finding[] = [];
  for (const item of items) {
    if (item.sources.length === 0) continue;
    const said = [...item.sources, ...item.users.flatMap((u) => [u.text, u.note])].join(" ");
    const allowed = allowedWords(item, terms);

    const known = new Set(numbersIn(said));
    const added = [...new Set(numbersIn(item.text))].filter((n) => !known.has(n));
    if (added.length > 0) findings.push({ bullet: item.id, kind: "new-number", detail: `has numbers the candidate never wrote: ${added.join(", ")}` });

    const tail = OUTCOME.exec(item.text);
    if (tail && overlap(tail[0], allowed) < REWRITE_FLOOR) findings.push({ bullet: item.id, kind: "added-outcome", detail: `adds a result the candidate never wrote: "${tail[0].replace(/^,\s*/, "").trim()}"` });

    const best = item.sources
      .filter((src) => !isTitleCase(src))
      .map((src) => namesIn(src))
      .filter((n) => n.length >= MIN_NAMES)
      .map((names) => ({ names, kept: names.filter((n) => normalizeText(item.text).includes(normalizeText(n))) }))
      .sort((a, b) => b.kept.length / b.names.length - a.kept.length / a.names.length)[0];
    if (best && best.kept.length / best.names.length < 0.5) {
      const lost = best.names.filter((n) => !best.kept.includes(n));
      findings.push({ bullet: item.id, kind: "lost-names", detail: `drops names the candidate wrote: ${lost.slice(0, 6).join(", ")}` });
    }

    if (overlap(item.text, allowed) < REWRITE_FLOOR) findings.push({ bullet: item.id, kind: "rewritten", detail: "is rewritten rather than edited; start again from the candidate's own wording" });

    const label = labelIn(item.text, [...terms, ...item.users.flatMap((u) => [u.text, ...u.skills])]);
    if (label) findings.push({ bullet: item.id, kind: "labelled", detail: `opens with "${label}" as a label; say what was built or done instead` });

    const extra = addedNames(item, terms);
    if (extra.length > 0) findings.push({ bullet: item.id, kind: "added-names", detail: `names ${extra.slice(0, 5).map((n) => `"${n}"`).join(", ")}, which its own lines do not; keep each tool and term in the line about the work that used it` });
  }
  return findings;
}

/**
 * The resume with any bullet the model rewrote out of all recognition put back to the candidate's own first wording.
 * A bullet that works in something the user said they have is left alone: that one is meant to say something new.
 */
export function revertRewrites(w: WrittenResume, plan: WritingPlan): { written: WrittenResume; reverted: string[] } {
  const reverted: string[] = [];
  const items = bulletItems(w, plan);
  const next: WrittenResume = { ...w, roles: w.roles.map((r) => ({ ...r, bullets: [...r.bullets] })), projects: w.projects.map((p) => ({ ...p, bullets: [...p.bullets] })) };
  for (const item of items) {
    if (item.users.length > 0 || item.sources.length === 0) continue;
    if (overlap(item.text, allowedWords(item, plan.terms)) >= REVERT_FLOOR) continue;
    const own = item.at.kind === "role" ? item.sources[0] : item.sources.find((s, i) => i > 0 || item.sources.length === 1);
    if (!own) continue;
    const list = item.at.kind === "role" ? next.roles[item.at.entry].bullets : next.projects[item.at.entry].bullets;
    list[item.at.bullet] = { ...list[item.at.bullet], text: tidy(own) };
    reverted.push(item.id);
  }
  return { written: next, reverted };
}

/**
 * The resume with any bullet that names a tool or job term its own lines do not put back: to the draft's text when the
 * revision added it (a reviewer's suggestion can move a term into a line about other work), else, when it is a job term
 * and the bullet works in nothing the user said, to the candidate's own first wording.
 */
export function revertAddedNames(w: WrittenResume, drafted: WrittenResume, plan: WritingPlan): { written: WrittenResume; reverted: string[] } {
  const reverted: string[] = [];
  const key = (i: BulletItem) => `${i.where}|${i.sources.join("|")}`;
  const before = new Map(bulletItems(drafted, plan).map((i) => [key(i), i]));
  const next: WrittenResume = { ...w, roles: w.roles.map((r) => ({ ...r, bullets: [...r.bullets] })), projects: w.projects.map((p) => ({ ...p, bullets: [...p.bullets] })) };
  for (const item of bulletItems(w, plan)) {
    if (item.sources.length === 0) continue;
    const extra = addedNames(item, plan.terms);
    if (extra.length === 0) continue;
    const was = before.get(key(item));
    let text: string | null = null;
    if (was && was.text !== item.text && addedNames(was, plan.terms).length === 0) text = was.text;
    else if (item.users.length === 0 && extra.some((n) => plan.terms.includes(n))) text = item.at.kind === "role" ? item.sources[0] : (item.sources.find((_, i) => i > 0) ?? null);
    if (!text) continue;
    const list = item.at.kind === "role" ? next.roles[item.at.entry].bullets : next.projects[item.at.entry].bullets;
    list[item.at.bullet] = { ...list[item.at.bullet], text: tidy(text) };
    reverted.push(item.id);
  }
  return { written: next, reverted };
}

export { missingMentions } from "./write";
