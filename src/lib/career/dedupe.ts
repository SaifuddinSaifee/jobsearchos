import type { Fact, CareerRecord, Role, Wording, RecordItemKind } from "./schema";
import type { BulletSuggestion } from "./proposal-schema";
import type { ExtractedBullet } from "./extract";
import { normalizeEmployer, normalizeText, normalizeTitle, skillKey, textSimilarity } from "./normalize";

// Deterministic matching of incoming text against what the record already holds. No model: a model only sees what
// is left over after this (step 5).

/** A bullet this alike (0 to 1) to an edited copy of itself still counts as "the same bullet, edited". */
export const LINEAGE_SIMILARITY = 0.2;

const clean = (t: string) => t.replace(/\s+/g, " ").trim();

function findWording(facts: Fact[], pick: (w: Wording) => boolean): { fact: Fact; wording: Wording } | null {
  for (const fact of facts) {
    const wording = fact.wordings.find(pick);
    if (wording) return { fact, wording };
  }
  return null;
}

/**
 * What to do with one incoming bullet, given the role it is going into (null for a new role).
 * 1. exact text already a wording: known (only the source is added);
 * 2. same words apart from case and punctuation: same fact, new wording;
 * 3. same editor block as an existing wording (copies of a document keep block ids) with similar text: same fact;
 * 4. otherwise a new fact, until the model has looked at it.
 */
export function classifyBullet(role: Role | null, bullet: ExtractedBullet): BulletSuggestion {
  if (!role) return { to: "new" };
  const text = clean(bullet.text);
  const norm = normalizeText(text);

  const exact = findWording(role.facts, (w) => clean(w.text) === text);
  if (exact) return { to: "known", factId: exact.fact.id, wordingId: exact.wording.id };

  const near = findWording(role.facts, (w) => normalizeText(w.text) === norm);
  if (near) return { to: "fact", factId: near.fact.id, why: "near" };

  if (bullet.blockId) {
    const lineage = findWording(
      role.facts,
      (w) => w.sources.some((s) => s.blockId === bullet.blockId) && textSimilarity(w.text, text) >= LINEAGE_SIMILARITY,
    );
    if (lineage) return { to: "fact", factId: lineage.fact.id, why: "lineage" };
  }
  return { to: "new" };
}

export const matchSkill = (record: CareerRecord, name: string) =>
  record.skills.find((s) => skillKey(s.name) === skillKey(name)) ?? null;

export const matchProject = (record: CareerRecord, name: string) =>
  record.projects.find((p) => normalizeText(p.name) === normalizeText(name)) ?? null;

/** Words that say "certificate" and carry nothing about which one it is. */
const CERT_NOISE = new Set(["certified", "certification", "certificate", "certificates"]);

/**
 * What identifies a certification: its name without a bracketed code or the word "certified", and its issuer. "AWS
 * Certified AI Practitioner" and "AWS AI Practitioner (AIF-C01)" are one, and so are "Foundation of User Experience,
 * Google" and "Foundation of User Experience" by Google.
 */
export function certKey(name: string, issuer = ""): string {
  const words = normalizeText(`${name.replace(/\([^)]*\)/g, " ")} ${issuer}`).split(" ").filter((w) => w && !CERT_NOISE.has(w));
  return [...new Set(words)].sort().join(" ");
}

export const matchCertification = (record: CareerRecord, name: string, issuer = "") =>
  record.certifications.find((c) => certKey(c.name, c.issuer) === certKey(name, issuer)) ?? null;

/** Certifications with the repeats taken out, keeping the first of each. */
export function uniqueCertifications<T extends { name: string; issuer: string }>(certs: T[]): T[] {
  const seen = new Set<string>();
  return certs.filter((c) => {
    const key = certKey(c.name, c.issuer);
    return !seen.has(key) && !!seen.add(key);
  });
}

export const matchAchievement = (record: CareerRecord, text: string) =>
  record.achievements.find((a) => normalizeText(a.text) === normalizeText(text)) ?? null;

type EducationLike = { institution: string; degree: string; end?: string };

/** The words of a school's name that say which school it is: no country, no "board". */
const EDU_NOISE = new Set(["india", "usa", "uk", "united", "states", "kingdom", "board", "the", "of", "and"]);
const institutionWords = (name: string) => normalizeText(name).split(" ").filter((w) => w && !EDU_NOISE.has(w));

/**
 * The same school entry written two ways: one school's words are inside the other's ("Mayur Trust's ZB Patil" and
 * "Mayur Trust's ZB Patil - HSC Board, India"), the degrees agree or one side has none, and the years agree when both
 * are known.
 */
export function sameEducation(a: EducationLike, b: EducationLike): boolean {
  const wa = institutionWords(a.institution);
  const wb = institutionWords(b.institution);
  if (wa.length === 0 || wb.length === 0) return false;
  const [small, large] = wa.length <= wb.length ? [wa, wb] : [wb, wa];
  const inside = small.every((w) => large.includes(w));
  if (!inside || (small.length < 2 && small.length !== large.length)) return false;
  const da = normalizeText(a.degree);
  const db = normalizeText(b.degree);
  if (da && db && da !== db && !da.includes(db) && !db.includes(da)) return false;
  const ya = normalizeText(a.end ?? "");
  const yb = normalizeText(b.end ?? "");
  return !ya || !yb || ya === yb;
}

/** Same institution, and the same degree or one side has none. */
export function matchEducation(record: CareerRecord, institution: string, degree: string, end = "") {
  return record.education.find((e) => sameEducation(e, { institution, degree, end })) ?? null;
}

const SCHOOL_LEVEL = /\b(hsc|ssc|icse|cbse|isc|high school|higher secondary|secondary school|matriculation|gcse|a levels?|igcse)\b/;

/** A school-level entry (a board exam or high school), which a resume leaves out once there is a degree. */
export const isSchoolLevel = (e: { institution: string; degree: string }): boolean => SCHOOL_LEVEL.test(normalizeText(`${e.degree} ${e.institution}`));

const filled = (e: { degree: string; field: string; start: string; end: string; details: string }) => [e.degree, e.field, e.start, e.end, e.details].filter((v) => v.trim()).length;
const endYear = (e: { end: string }) => (/present|current|now/i.test(e.end) ? 9999 : Number(/\b(19|20)\d{2}\b/.exec(e.end)?.[0] ?? 0));

/**
 * The education to put on a resume: repeats of the same entry become one (the one with the most filled in), school-level
 * entries go once there is a degree, and the newest comes first.
 */
export function pickEducation<T extends { institution: string; degree: string; field: string; start: string; end: string; details: string }>(all: T[]): T[] {
  const kept: T[] = [];
  for (const e of all) {
    const at = kept.findIndex((k) => sameEducation(k, e));
    if (at === -1) kept.push(e);
    else if (filled(e) > filled(kept[at])) kept[at] = e;
  }
  const levels = kept.filter((e) => !isSchoolLevel(e));
  const list = levels.length > 0 ? levels : kept;
  return list.map((e, i) => ({ e, i })).sort((a, b) => endYear(b.e) - endYear(a.e) || a.i - b.i).map((x) => x.e);
}

/** The text a tombstone is matched on, per kind of item. */
export const removalKey = {
  employer: (name: string) => normalizeEmployer(name),
  role: (company: string, title: string) => `${normalizeEmployer(company)}|${normalizeTitle(title)}`,
  wording: (text: string) => normalizeText(text),
  skill: (name: string) => normalizeText(name),
  project: (name: string) => normalizeText(name),
  education: (institution: string, degree: string) => `${normalizeText(institution)}|${normalizeText(degree)}`,
  certification: (name: string) => normalizeText(name),
  achievement: (text: string) => normalizeText(text),
  motivation: (text: string) => normalizeText(text),
};

/** Whether the user deleted this before. A merge then proposes leaving it out. */
export function isRemoved(record: CareerRecord, kind: RecordItemKind, key: string): boolean {
  return record.removed.some((r) => r.kind === kind && r.key === key);
}
