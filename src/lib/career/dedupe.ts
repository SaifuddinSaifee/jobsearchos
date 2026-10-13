import type { Fact, CareerRecord, Role, Wording, RecordItemKind } from "./schema";
import type { BulletSuggestion } from "./proposal-schema";
import type { ExtractedBullet } from "./extract";
import { normalizeEmployer, normalizeText, normalizeTitle, textSimilarity } from "./normalize";

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
  record.skills.find((s) => normalizeText(s.name) === normalizeText(name)) ?? null;

export const matchProject = (record: CareerRecord, name: string) =>
  record.projects.find((p) => normalizeText(p.name) === normalizeText(name)) ?? null;

export const matchCertification = (record: CareerRecord, name: string) =>
  record.certifications.find((c) => normalizeText(c.name) === normalizeText(name)) ?? null;

export const matchAchievement = (record: CareerRecord, text: string) =>
  record.achievements.find((a) => normalizeText(a.text) === normalizeText(text)) ?? null;

/** Same institution, and the same degree or one side has none. */
export function matchEducation(record: CareerRecord, institution: string, degree: string) {
  const inst = normalizeText(institution);
  const deg = normalizeText(degree);
  return (
    record.education.find((e) => {
      if (normalizeText(e.institution) !== inst) return false;
      const other = normalizeText(e.degree);
      return !deg || !other || deg === other;
    }) ?? null
  );
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
