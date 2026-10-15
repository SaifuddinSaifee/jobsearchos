import { normalizeText } from "@/lib/career/normalize";
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
  /** Where it is in the written resume, to change it there. */
  at: { kind: "role" | "project"; entry: number; bullet: number };
};

/** Every bullet of the resume, numbered in reading order, with its sources. */
export function bulletItems(w: WrittenResume, plan: WritingPlan): BulletItem[] {
  const factTexts = new Map(plan.roles.flatMap((r) => r.facts).map((f) => [f.factId, f.texts]));
  const userById = new Map(plan.users.map((u) => [u.requirementId, u]));
  const items: BulletItem[] = [];
  const add = (b: WrittenBullet, where: string, sources: string[], at: BulletItem["at"]) =>
    items.push({ id: `b${items.length + 1}`, where, text: b.text, sources, users: b.userRequirementIds.map((id) => userById.get(id)).filter((u): u is PlanUser => !!u), at });
  w.roles.forEach((r, entry) =>
    r.bullets.forEach((b, bullet) => add(b, `${r.plan.title || "Role"} at ${r.plan.employer}`, b.factIds.flatMap((id) => factTexts.get(id) ?? []), { kind: "role", entry, bullet })),
  );
  w.projects.forEach((p, entry) =>
    p.bullets.forEach((b, bullet) => add(b, p.plan.name, [p.plan.description, ...p.plan.texts].filter(Boolean), { kind: "project", entry, bullet })),
  );
  return items;
}

export type FindingKind = "new-number" | "added-outcome" | "lost-names" | "rewritten" | "generic" | "copied" | "overused" | "named-trait" | "missing-mention";
/** Something a code check found. `bullet` is a bullet id ("b3"), or "resume" for the resume as a whole. */
export type Finding = { bullet: string; kind: FindingKind; detail: string };

const STOP = new Set(["with", "from", "that", "this", "into", "their", "they", "them", "were", "have", "been", "over", "across", "using", "used", "also", "more", "than", "each", "every", "which", "while", "about", "after", "before"]);
const words = (text: string) => normalizeText(text).split(" ").filter((w) => w.length >= 4 && !STOP.has(w));

/** The numbers in a text, without thousands separators: "2,000 merchants, 99.9%" gives 2000 and 99.9. */
export const numbersIn = (text: string): string[] => [...text.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => m[0].replace(/,/g, "").replace(/\.0+$/, ""));

/**
 * The names in a text: tools, products and systems ("Attio", "PostgreSQL", "Next.js", "GitHub Actions"). A capitalized
 * word that starts the text or a sentence is left out, since it is capitalized for that reason.
 */
export function namesIn(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/(^|[.!?]\s+|\s|\()([A-Z][A-Za-z0-9]*(?:[.+#-][A-Za-z0-9]+)*)/g)) {
    const word = m[2];
    const sentenceStart = m.index === 0 || /[.!?]\s+$/.test(m[1]);
    const unusual = /[a-z][A-Z]|[0-9]|[.+#]/.test(word) || word.length <= 4 && word === word.toUpperCase();
    if (sentenceStart && !unusual) continue;
    out.add(word);
  }
  return [...out];
}

/** A clause that states a result or a purpose, tacked on after a comma. */
const OUTCOME = /,\s*(so that|so|giving|enabling|allowing|ensuring|helping|letting|which (?:meant|let|gave|made|helped|allowed|enabled))\b(.*)$/i;

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

/** What `item` is allowed to say: its sources, what the user said about it, and the job's terms. */
function allowedWords(item: BulletItem, terms: string[]): Set<string> {
  return new Set(words([...item.sources, ...item.users.flatMap((u) => [u.text, u.note, u.skill ?? ""]), ...terms].join(" ")));
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
      .map((src) => namesIn(src))
      .filter((n) => n.length >= MIN_NAMES)
      .map((names) => ({ names, kept: names.filter((n) => normalizeText(item.text).includes(normalizeText(n))) }))
      .sort((a, b) => b.kept.length / b.names.length - a.kept.length / a.names.length)[0];
    if (best && best.kept.length / best.names.length < 0.5) {
      const lost = best.names.filter((n) => !best.kept.includes(n));
      findings.push({ bullet: item.id, kind: "lost-names", detail: `drops names the candidate wrote: ${lost.slice(0, 6).join(", ")}` });
    }

    if (overlap(item.text, allowed) < REWRITE_FLOOR) findings.push({ bullet: item.id, kind: "rewritten", detail: "is rewritten rather than edited; start again from the candidate's own wording" });
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

export { missingMentions } from "./write";
