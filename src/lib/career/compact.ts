import type { IdGen } from "@/lib/documents/build";
import { numbersIn } from "@/lib/resume-writer/proof";
import type { Clusterer } from "./cluster";
import type { CompactionAnswers, CompactionPart, CompactionQuestion, CompactionResult } from "./compact-schema";
import { certKey, removalKey, sameEducation } from "./dedupe";
import type { Describer } from "./describe";
import { conflictingMetrics, coveredBy, factLine, fitSlots, isEmptyFact, saysPhrase, slotsOf, strongest, technologiesIn } from "./facts";
import { recordToMarkdown } from "./markdown";
import { hash8, normalizeText, skillKey, splitOutsideBrackets, textKey } from "./normalize";
import { recordForPrompt } from "./prompt";
import { mergeProvenance, type CareerRecord, type Detail, type Fact, type Role, type SourceRef } from "./schema";

// Tidying the whole career record once: repeats taken out in code, facts that tell the same work joined (model, ids
// only), each fact given one statement and its details (model, checked in code), and one wording kept per slot. The
// result is a proposed record for the user to review; nothing is saved until they apply it.

export type CompactDeps = { cluster: Clusterer; describe: Describer; newId: IdGen };

/** A project bullet is folded into another only when this share of its words is in it. */
export const PROJECT_COVERAGE = 0.6;

const addRef = (list: SourceRef[], ref: SourceRef) => {
  if (!list.some((r) => r.sourceId === ref.sourceId && r.blockId === ref.blockId)) list.push(ref);
};
const addRefs = (to: SourceRef[], from: SourceRef[]) => from.forEach((r) => addRef(to, r));

const roleLabel = (employer: string, role: Role) => [employer, role.framings[0]?.title].filter(Boolean).join(", ");
const exportSize = (record: CareerRecord) => recordToMarkdown(record, { version: null, exportedOn: "" }).length;

/** How many fields of an entry are filled in, to keep the fullest of two copies. */
const filled = (o: Record<string, unknown>) => Object.values(o).filter((v) => typeof v === "string" && v.trim()).length;

/** Keeps the first of each group of repeats, as the fullest copy, with every copy's sources. Returns how many were left. */
function dedupe<T extends { sources: SourceRef[] }>(list: T[], same: (a: T, b: T) => boolean): T[] {
  const kept: T[] = [];
  for (const item of list) {
    const at = kept.findIndex((k) => same(k, item));
    if (at === -1) {
      kept.push(item);
      continue;
    }
    const held = kept[at];
    const fuller = filled(item as Record<string, unknown>) > filled(held as Record<string, unknown>) ? { ...item, id: (held as { id?: string }).id ?? (item as { id?: string }).id } : held;
    addRefs(fuller.sources, held.sources);
    addRefs(fuller.sources, item.sources);
    kept[at] = fuller;
  }
  return kept;
}

/** Repeats of skills, education, certifications and achievements, and the "Technologies:" lines stored as facts. No model. */
export function cleanUp(record: CareerRecord, newId: IdGen): CompactionResult["cleanup"] {
  const count = (before: number, after: number) => ({ before, after });
  const skills = record.skills.length;
  const education = record.education.length;
  const certifications = record.certifications.length;
  const achievements = record.achievements.length;
  let technologyLines = 0;

  for (const employer of record.employers) {
    for (const role of employer.roles) {
      for (const fact of role.facts) {
        // A wording repeated with other case or punctuation is one wording.
        const byKey = new Map<string, Fact["wordings"][number]>();
        fact.wordings = fact.wordings.filter((w) => {
          const key = `${w.framingId ?? ""}|${w.form}|${textKey(w.text)}`;
          const held = byKey.get(key);
          if (!held) return byKey.set(key, w), true;
          addRefs(held.sources, w.sources);
          return false;
        });
        const lines = fact.wordings.map((w) => technologiesIn(w.text));
        if (fact.wordings.length === 0 || lines.some((l) => l === null)) continue;
        technologyLines += fact.wordings.length;
        for (const names of lines) {
          for (const name of names ?? []) {
            if (!role.technologies.some((t) => skillKey(t) === skillKey(name))) role.technologies.push(name);
            if (!record.skills.some((s) => skillKey(s.name) === skillKey(name))) {
              record.skills.push({ id: newId(), name, category: "Technologies", sources: [...fact.sources], provenance: mergeProvenance() });
            }
          }
        }
        fact.wordings = [];
        fact.statement = "";
      }
      role.facts = role.facts.filter((f) => !isEmptyFact(f));
    }
  }

  record.skills = mendBrackets(record.skills);
  // A skill read as one name that lists several ("n8n, Zapier, LLM APIs (OpenAI, Anthropic)") becomes one per name.
  record.skills = record.skills.flatMap((s) => {
    const names = splitOutsideBrackets(s.name);
    return names.length <= 1 ? [s] : names.map((name) => ({ ...s, id: newId(), name, sources: [...s.sources] }));
  });
  record.skills = dedupe(record.skills, (a, b) => skillKey(a.name) === skillKey(b.name));
  record.education = dedupe(record.education, (a, b) => sameEducation(a, b));
  record.certifications = dedupe(record.certifications, (a, b) => certKey(a.name, a.issuer) === certKey(b.name, b.issuer));
  record.achievements = dedupe(record.achievements, (a, b) => normalizeText(a.text) === normalizeText(b.text));
  return {
    skills: count(skills, record.skills.length),
    education: count(education, record.education.length),
    certifications: count(certifications, record.certifications.length),
    achievements: count(achievements, record.achievements.length),
    technologyLines,
  };
}

const depth = (name: string) => (name.match(/\(/g) ?? []).length - (name.match(/\)/g) ?? []).length;

/**
 * Skills that an old reading split inside brackets ("LLM APIs (OpenAI", "Anthropic", "Ollama)") joined back into one,
 * from the skills that follow in the same category, until the brackets close.
 */
export function mendBrackets<T extends { name: string; category: string; sources: SourceRef[] }>(skills: T[]): T[] {
  const out: T[] = [];
  for (let i = 0; i < skills.length; i++) {
    let skill = skills[i];
    let j = i;
    while (depth(skill.name) > 0 && j + 1 < skills.length && skills[j + 1].category === skill.category && j - i < 8) {
      const next = skills[++j];
      skill = { ...skill, name: `${skill.name}, ${next.name}`, sources: [...skill.sources] };
      addRefs(skill.sources, next.sources);
    }
    if (depth(skill.name) !== 0) {
      out.push(skills[i]);
      continue;
    }
    out.push(skill);
    i = j;
  }
  return out;
}

/** Joins facts of one role into the first of them: every wording, detail, source and seen text. */
export function joinFacts(role: Role, ids: string[]): void {
  const [into, ...rest] = ids.map((id) => role.facts.find((f) => f.id === id)).filter((f): f is Fact => !!f);
  if (!into) return;
  for (const f of rest) {
    for (const w of f.wordings) if (!into.wordings.some((x) => x.text.trim() === w.text.trim())) into.wordings.push(w);
    for (const d of f.details) if (!into.details.some((x) => x.kind === d.kind && normalizeText(x.text) === normalizeText(d.text))) into.details.push(d);
    addRefs(into.sources, f.sources);
    for (const k of f.seen) if (!into.seen.includes(k)) into.seen.push(k);
    for (const u of f.provenance.user) if (!into.provenance.user.includes(u)) into.provenance.user.push(u);
    if (f.provenance.origin === "user") into.provenance.origin = "user";
    if (!into.statement.trim()) into.statement = f.statement;
  }
  const gone = new Set(rest.map((f) => f.id));
  role.facts = role.facts.filter((f) => !gone.has(f.id));
}

/** Gives a fact the statement and details written for it. A statement the user wrote is kept. */
function describeFact(fact: Fact, written: { statement: string; details: { kind: Detail["kind"]; text: string; measures: string }[]; findings: string[] }, newId: IdGen): string[] {
  for (const d of written.details) {
    if (fact.details.some((x) => x.kind === d.kind && normalizeText(x.text) === normalizeText(d.text))) continue;
    const sources: SourceRef[] = [];
    for (const w of fact.wordings) if (saysPhrase(w.text, d.text)) addRefs(sources, w.sources);
    fact.details.push({ id: newId(), kind: d.kind, text: d.text, measures: d.measures, sources, provenance: mergeProvenance() });
  }
  if (fact.provenance.user.includes("statement")) return [];
  if (written.findings.length > 0) return written.findings;
  fact.statement = written.statement;
  return [];
}

/** Each measure of a fact given with two or more values, as a question. */
export function questionsFor(fact: Fact, where: string): CompactionQuestion[] {
  return conflictingMetrics(fact.details, fact.wordings).map((group) => ({
    id: `${fact.id}:${hash8(normalizeText(group[0].measures))}`,
    factId: fact.id,
    where,
    fact: factLine(fact),
    measures: group[0].measures,
    options: group.map((d) => ({ detailId: d.id, text: d.text })),
  }));
}

/**
 * One model step for one role or project. If it fails (after the step's own retry), that part is left as it is rather
 * than failing the whole tidy: its facts are not joined, or keep no statement, and the review says so.
 */
async function attempt<T>(step: () => Promise<T>, fallback: T, where: string): Promise<T> {
  try {
    return await step();
  } catch (err) {
    if (err instanceof Error && err.message === "Stopped") throw err;
    console.error(`[career] tidy step failed for ${where}:`, err instanceof Error ? err.message : err);
    return fallback;
  }
}

/** Works out the tidied record. Calls the model once per role and project to join repeats, and once per few facts to describe them. */
export async function compactRecord(current: { version: number; record: CareerRecord }, deps: CompactDeps): Promise<CompactionResult> {
  const record = structuredClone(current.record);
  const sizeBefore = exportSize(current.record);
  const before = new Map(record.employers.flatMap((e) => e.roles.map((r) => [r.id, { facts: r.facts.length, wordings: r.facts.reduce((n, f) => n + f.wordings.length, 0) }] as const)));
  const projectsBefore = new Map(record.projects.map((p) => [p.id, p.wordings.length]));

  const cleanup = cleanUp(record, deps.newId);
  // One prefix for every call of the run, so each call after the first reads the record from the provider's cache.
  const prefix = recordForPrompt(record);

  const roles: CompactionPart[] = [];
  const questions: CompactionQuestion[] = [];
  const unwritten: CompactionResult["unwritten"] = [];

  for (const employer of record.employers) {
    for (const role of employer.roles) {
      const where = roleLabel(employer.name, role);
      if (role.facts.length >= 2) {
        const groups = await attempt(() => deps.cluster(role.facts.map((f) => ({ key: f.id, text: factLine(f) })), prefix, "facts"), [], where);
        for (const ids of groups) joinFacts(role, ids);
      }
      const inputs = role.facts.filter((f) => f.wordings.length > 0).map((f) => ({ key: f.id, wordings: f.wordings.map((w) => w.text) }));
      const described = await attempt(() => deps.describe(inputs, prefix), null, where);
      for (const fact of role.facts) {
        const written = described?.get(fact.id);
        const findings = written ? describeFact(fact, written, deps.newId) : described ? [] : ["The model could not be reached for this role."];
        if (findings.length > 0 && !fact.statement.trim()) unwritten.push({ factId: fact.id, where, findings });
        fitSlots(fact, slotsOf(role.framings));
        questions.push(...questionsFor(fact, where));
      }
      const was = before.get(role.id) ?? { facts: 0, wordings: 0 };
      roles.push({ id: role.id, label: where, factsBefore: was.facts, factsAfter: role.facts.length, wordingsBefore: was.wordings, wordingsAfter: role.facts.reduce((n, f) => n + f.wordings.length, 0) });
    }
  }

  const projects: CompactionPart[] = [];
  for (const project of record.projects) {
    for (const w of project.wordings) {
      const key = textKey(w.text);
      if (!project.seen.includes(key)) project.seen.push(key);
    }
    // Repeats with other case or punctuation first, then the bullets the model finds tell the same work.
    const byKey = new Map<string, (typeof project.wordings)[number]>();
    project.wordings = project.wordings.filter((w) => {
      const held = byKey.get(textKey(w.text));
      if (!held) return byKey.set(textKey(w.text), w), true;
      addRefs(held.sources, w.sources);
      return false;
    });
    const groups = project.wordings.length >= 2 ? await attempt(() => deps.cluster(project.wordings.map((w) => ({ key: w.id, text: w.text })), prefix, "bullets"), [], project.name) : [];
    for (const ids of groups) {
      const group = project.wordings.filter((w) => ids.includes(w.id));
      const first = strongest(group);
      if (!first) continue;
      // A project bullet has no fact to keep what it says, so one is folded in only when most of its words are in a
      // bullet that stays; otherwise it stays too.
      const kept = [first];
      for (const w of [...group].sort((a, b) => b.text.length - a.text.length)) {
        if (w === first) continue;
        const into = kept.find((k) => coveredBy(w.text, k.text) >= PROJECT_COVERAGE);
        if (into) addRefs(into.sources, w.sources);
        else kept.push(w);
      }
      project.wordings = project.wordings.filter((w) => kept.includes(w) || !ids.includes(w.id));
    }
    const was = projectsBefore.get(project.id) ?? 0;
    projects.push({ id: project.id, label: project.name, factsBefore: was, factsAfter: project.wordings.length, wordingsBefore: was, wordingsAfter: project.wordings.length });
  }

  return {
    baseVersion: current.version,
    record,
    roles,
    projects,
    cleanup,
    questions,
    unwritten,
    size: { before: sizeBefore, after: exportSize(record) },
  };
}

/**
 * The record to save: the tidied record with the user's answers. For each answered question the chosen value is
 * kept; the other values are removed as details (and remembered as removed), wordings that give them are dropped
 * where the fact keeps another line, and a statement that gives one has it replaced by the chosen value.
 */
export function applyAnswers(result: CompactionResult, answers: CompactionAnswers, now: Date = new Date()): CareerRecord {
  const record = structuredClone(result.record);
  const facts = new Map(record.employers.flatMap((e) => e.roles.flatMap((r) => r.facts.map((f) => [f.id, f] as const))));
  for (const q of result.questions) {
    const keep = answers[q.id];
    const fact = facts.get(q.factId);
    const chosen = fact?.details.find((d) => d.id === keep);
    if (!fact || !chosen) continue;
    const losing = fact.details.filter((d) => q.options.some((o) => o.detailId === d.id) && d.id !== keep);
    for (const d of losing) {
      fact.details = fact.details.filter((x) => x.id !== d.id);
      const key = removalKey.detail(d.text);
      if (!record.removed.some((r) => r.kind === "detail" && r.key === key)) record.removed.push({ kind: "detail", key, at: now.toISOString() });
      const left = fact.wordings.filter((w) => !givesValue(w.text, d.text));
      if (left.length > 0 || fact.statement.trim()) fact.wordings = left;
      if (givesValue(fact.statement, d.text)) fact.statement = fact.statement.replace(d.text, chosen.text);
    }
  }
  return record;
}

/** Whether a text gives the value a detail states: the detail's words, or, for a bare number, that number. */
function givesValue(text: string, detail: string): boolean {
  if (saysPhrase(text, detail) || text.includes(detail)) return true;
  const nums = numbersIn(detail);
  return nums.length > 0 && nums.every((n) => numbersIn(text).includes(n)) && normalizeText(detail).split(" ").length <= 2;
}
