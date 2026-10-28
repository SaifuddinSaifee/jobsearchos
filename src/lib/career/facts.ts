import { namesIn, numbersIn, proofStrength } from "@/lib/resume-writer/proof";
import { normalizeText, splitOutsideBrackets, textKey } from "./normalize";
import type { Detail, Fact, SourceRef, Wording } from "./schema";

// What a fact says, and keeping it to one statement plus at most one wording per slot. Pure, so the review screen can
// use it too. No model: the model's part (writing statements and reading details) is in describe.ts.

/** Longest statement kept. Resume bullets here run up to 320 characters. */
export const STATEMENT_CHARS = 320;

/** What a check needs of a fact: the texts of its wordings and details. */
export type FactTexts = { wordings: { text: string }[]; details: { text: string }[] };

/** Everything the fact's own sources say: its wordings, and its details. The statement is not a source. */
const sourceText = (fact: FactTexts) => [...fact.wordings.map((w) => w.text), ...fact.details.map((d) => d.text)].join(" \n ");

/** Whether `phrase` appears in `text`, ignoring case, punctuation and spacing. */
export function saysPhrase(text: string, phrase: string): boolean {
  const p = normalizeText(phrase);
  return p.length > 0 && ` ${normalizeText(text)} `.includes(` ${p} `);
}

/**
 * The numbers and names a text states that the fact does not: what a point would add if it joined. Empty means the
 * point only says again what the fact already holds, so it is kept as a source and its text is not.
 */
export function newClaims(text: string, fact: FactTexts & { statement: string }): string[] {
  const known = `${sourceText(fact)} \n ${fact.statement}`;
  const knownNumbers = new Set(numbersIn(known));
  const numbers = numbersIn(text).filter((n) => !knownNumbers.has(n));
  const names = namesIn(text).filter((n) => !saysPhrase(known, n));
  return [...new Set([...numbers, ...names])];
}

/**
 * What is wrong with a statement written for a fact, or nothing. Every number and every name in it must be in the
 * fact's wordings or details, so the statement can merge what the sources say but never add to it.
 */
export function checkStatement(statement: string, fact: FactTexts): string[] {
  const findings: string[] = [];
  const text = statement.trim();
  if (!text) return ["The statement is empty."];
  if (text.length > STATEMENT_CHARS) findings.push(`The statement is ${text.length} characters; keep it under ${STATEMENT_CHARS}.`);
  const said = sourceText(fact);
  const numbers = new Set(numbersIn(said));
  for (const n of new Set(numbersIn(text))) if (!numbers.has(n)) findings.push(`"${n}" is not in any wording of this fact.`);
  for (const name of namesIn(text)) if (!saysPhrase(said, name)) findings.push(`"${name}" is not in any wording of this fact.`);
  return findings;
}

/** Details whose text is in one of the wordings, with repeats taken out. Anything else the model gave is dropped. */
export function detailsFromWordings<T extends Pick<Detail, "kind" | "text">>(details: T[], wordings: { text: string }[]): T[] {
  const seen = new Set<string>();
  return details.filter((d) => {
    const key = `${d.kind}|${normalizeText(d.text)}`;
    if (seen.has(key) || !wordings.some((w) => saysPhrase(w.text, d.text))) return false;
    seen.add(key);
    return true;
  });
}

/** The values a metric gives, and the change a "from X to Y" gives as a share of X ("from 8 minutes to 1": 87.5). */
function values(text: string): { stated: number[]; derived: number[] } {
  const stated = numbersIn(text).map(Number);
  const fromTo = /\bfrom\s+(\d[\d,.]*)\D{0,30}?\bto\s+(\d[\d,.]*)/i.exec(text);
  if (!fromTo) return { stated, derived: [] };
  const [a, b] = [Number(fromTo[1].replace(/,/g, "")), Number(fromTo[2].replace(/,/g, ""))];
  return { stated, derived: a > 0 ? [(Math.abs(a - b) / a) * 100] : [] };
}

/** Whether two values of one measure agree: they share a number, or one is the change the other gives as a range. */
function agree(a: string, b: string): boolean {
  const [x, y] = [values(a), values(b)];
  if (x.stated.join(" ") === y.stated.join(" ")) return true;
  const near = (p: number[], q: number[]) => p.some((m) => q.some((n) => Math.abs(m - n) <= 1.5));
  return near(x.derived, y.stated) || near(y.derived, x.stated);
}

/**
 * Metric details that measure the same thing with values that disagree: a question for the user. Two values one
 * wording gives together ("from 8 minutes to 1 minute") are a before and after, not a disagreement.
 */
export function conflictingMetrics(details: Detail[], wordings: { text: string }[] = []): Detail[][] {
  const together = (a: string, b: string) => wordings.some((w) => w.text.includes(a) && w.text.includes(b));
  const byMeasure = new Map<string, Detail[]>();
  for (const d of details) {
    if (d.kind !== "metric" || !d.measures.trim()) continue;
    const key = normalizeText(d.measures);
    byMeasure.set(key, [...(byMeasure.get(key) ?? []), d]);
  }
  return [...byMeasure.values()].filter((group) => group.some((d, i) => group.slice(i + 1).some((e) => !agree(d.text, e.text) && !together(d.text, e.text))));
}

/** Which slot a framing's wordings share: its angle ("Product"), so two product framings keep one wording between them. */
export type SlotOf = (framingId: string | null) => string;

/** Slots by the angle of each framing of a role; a framing with no angle is a slot of its own. */
export function slotsOf(framings: { id: string; angle: string }[]): SlotOf {
  const angle = new Map(framings.map((f) => [f.id, normalizeText(f.angle) || f.id]));
  return (framingId) => (framingId ? (angle.get(framingId) ?? framingId) : "");
}

const byFraming: SlotOf = (framingId) => framingId ?? "";

/** A wording the user wrote or edited is theirs, and is never folded away. */
const isUsers = (w: Wording) => w.provenance.origin === "user" || w.provenance.user.length > 0;

/** How much of the fact a wording carries: the details it states, then how much it proves, then length. */
function carries(w: Wording, details: Detail[]): number {
  const covered = details.filter((d) => saysPhrase(w.text, d.text)).length;
  return covered * 100 + proofStrength(w.text) * 10 + Math.min(w.text.length, 600) / 100;
}

function addRef(list: SourceRef[], ref: SourceRef) {
  if (!list.some((r) => r.sourceId === ref.sourceId && r.blockId === ref.blockId)) list.push(ref);
}

/**
 * Keeps one wording per slot (angle or framing, and form): the one that carries the most of the fact, plus any the user
 * wrote or edited. The others are folded in: their sources stay on the fact and their text is noted as seen, so the
 * same text coming back is recognised. Mutates and returns the fact; the kept wordings stay in their order.
 */
export function fitSlots(fact: Fact, slotFor: SlotOf = byFraming): Fact {
  const slotOf = (w: Wording) => `${slotFor(w.framingId)}|${w.form}`;
  for (const w of fact.wordings) {
    for (const s of w.sources) addRef(fact.sources, s);
    const key = textKey(w.text);
    if (!fact.seen.includes(key)) fact.seen.push(key);
  }
  const best = new Map<string, Wording>();
  for (const w of fact.wordings) {
    if (isUsers(w)) continue;
    const slot = slotOf(w);
    const held = best.get(slot);
    if (!held || carries(w, fact.details) > carries(held, fact.details)) best.set(slot, w);
  }
  fact.wordings = fact.wordings.filter((w) => isUsers(w) || best.get(slotOf(w)) === w);
  return fact;
}

/** A fact is gone once it has nothing left to say. */
export const isEmptyFact = (fact: Fact): boolean => fact.wordings.length === 0 && !fact.statement.trim();

/** The fact as one line: its statement, or its first wording until it has one. */
export const factLine = (fact: Fact): string => fact.statement.trim() || (fact.wordings[0]?.text ?? "");

/** The label of a skills line, once or repeated ("Technologies: Technologies: Python"). */
const SKILLS_LINE = /^\s*(?:(?:technologies|tech stack|tools|skills)\s*:\s*)+/i;

/** The names on a "Technologies: ..." line, which lists what a role used rather than telling an accomplishment. Null for any other text. */
export function technologiesIn(text: string): string[] | null {
  if (!SKILLS_LINE.test(text)) return null;
  const names = splitOutsideBrackets(text.replace(SKILLS_LINE, "").replace(/[.;]\s*$/, ""));
  return names.filter((n, i) => names.findIndex((m) => normalizeText(m) === normalizeText(n)) === i);
}

/** The wording of a list that carries the most of a fact with these details. */
export function strongest<T extends Wording>(wordings: T[], details: Detail[] = []): T | undefined {
  return wordings.reduce<T | undefined>((best, w) => (!best || carries(w, details) > carries(best, details) ? w : best), undefined);
}

/** Share of the words of `text` (four letters or more) that `other` also has: 1 when it says nothing other does not. */
export function coveredBy(text: string, other: string): number {
  const words = (t: string) => new Set(normalizeText(t).split(" ").filter((w) => w.length >= 4));
  const mine = words(text);
  if (mine.size === 0) return 1;
  const theirs = words(other);
  return [...mine].filter((w) => theirs.has(w)).length / mine.size;
}
