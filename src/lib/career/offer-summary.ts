import { normalizeText } from "./normalize";
import type { Proposal } from "./proposal-schema";
import type { CareerRecord } from "./schema";

// What a document would add to the career record, counted for free: from the proposal as it stands before any model
// call (exact and near matches only). Client-safe, so the editor and the record tab can put it into words.

export type OfferSummary = {
  /** Bullets of roles: already in the record word for word, worded differently from a fact there, or new. */
  bullets: { total: number; inRecord: number; reworded: number; fresh: number };
  newEmployers: number;
  newRoles: { title: string; company: string; dates: string }[];
  /** Roles the record has under another title (a new framing). */
  newFramings: number;
  newSkills: number;
  newProjects: number;
  newEducation: number;
  newCertifications: number;
  newAchievements: number;
  /** Cover letter paragraphs, and how many are already in the record word for word. */
  paragraphs: { total: number; inRecord: number };
  /** A resume with no sections yet: nothing could be counted, and the AI reads it when it is added. */
  needsReading: boolean;
};

export function emptySummary(): OfferSummary {
  return {
    bullets: { total: 0, inRecord: 0, reworded: 0, fresh: 0 },
    newEmployers: 0,
    newRoles: [],
    newFramings: 0,
    newSkills: 0,
    newProjects: 0,
    newEducation: 0,
    newCertifications: 0,
    newAchievements: 0,
    paragraphs: { total: 0, inRecord: 0 },
    needsReading: false,
  };
}

const span = (start: string, end: string, current: boolean) => [start, current ? "Present" : end].filter(Boolean).join(" to ");

/**
 * Counts what a proposal would add. Anything the user removed from the record before is not counted as new, since
 * it would start out left out. A cover letter paragraph counts as in the record only when its exact text is already
 * there (as a story or a reason for applying): sorting the rest takes the model.
 */
export function summarizeProposal(proposal: Proposal, record: CareerRecord): OfferSummary {
  const s = emptySummary();
  for (const e of proposal.employers) {
    if (e.removedBefore) continue;
    const liveRoles = e.roles.filter((r) => !r.removedBefore);
    if (e.suggestion.to === "new" && liveRoles.length > 0) s.newEmployers++;
    for (const r of liveRoles) {
      if (r.suggestion.to === "new") s.newRoles.push({ title: r.title, company: e.name, dates: span(r.start, r.end, r.current) });
      else if (r.suggestion.to === "framing") s.newFramings++;
      for (const b of r.bullets) {
        if (b.removedBefore) continue;
        s.bullets.total++;
        if (b.suggestion.to === "known") s.bullets.inRecord++;
        else if (b.suggestion.to === "fact") s.bullets.reworded++;
        else s.bullets.fresh++;
      }
    }
  }
  const fresh = (list: { removedBefore: boolean; suggestion: { to: string } }[]) => list.filter((i) => !i.removedBefore && i.suggestion.to === "new").length;
  s.newSkills = fresh(proposal.skills);
  s.newProjects = fresh(proposal.projects);
  s.newEducation = fresh(proposal.education);
  s.newCertifications = fresh(proposal.certifications);
  s.newAchievements = fresh(proposal.achievements);

  const known = new Set<string>();
  for (const e of record.employers) for (const r of e.roles) for (const f of r.facts) for (const w of f.wordings) known.add(normalizeText(w.text));
  for (const m of record.motivations) known.add(normalizeText(m.text));
  for (const p of proposal.paragraphs) {
    if (p.removedBefore) continue;
    s.paragraphs.total++;
    if (known.has(normalizeText(p.text))) s.paragraphs.inRecord++;
  }
  return s;
}

/** Whether adding would bring anything worth asking about. Dates and notes alone are not. */
export function hasSomethingNew(s: OfferSummary): boolean {
  return (
    s.needsReading ||
    s.bullets.reworded + s.bullets.fresh > 0 ||
    s.newRoles.length > 0 ||
    s.newFramings > 0 ||
    s.newSkills + s.newProjects + s.newEducation + s.newCertifications + s.newAchievements > 0 ||
    s.paragraphs.total > s.paragraphs.inRecord
  );
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const list = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/**
 * The summary in words, for example "2 of 4 bullets are already in your record. New: 2 bullets, a job (Engineer at
 * Initech, 2019 to 2020) and 1 skill."
 */
export function describeSummary(s: OfferSummary, kind: "resume" | "cover_letter"): string {
  if (s.needsReading) return "This resume has no sections yet, so the AI will read it when you add it.";
  if (kind === "cover_letter") {
    const { total, inRecord } = s.paragraphs;
    const head =
      inRecord > 0
        ? `${inRecord} of ${count(total, "paragraph is", "paragraphs are")} already in your record.`
        : total === 1
          ? "Its one paragraph is not in your record yet."
          : `None of its ${total} paragraphs are in your record yet.`;
    if (inRecord === total) return head;
    return `${head} The AI sorts ${inRecord > 0 ? "the rest" : total === 1 ? "it" : "them"} into stories and reasons for applying when you add it.`;
  }

  const items: string[] = [];
  if (s.bullets.fresh > 0) items.push(count(s.bullets.fresh, "bullet", "bullets"));
  for (const r of s.newRoles) items.push(`a job (${[r.title || "Role", r.company].join(" at ")}${r.dates ? `, ${r.dates}` : ""})`);
  if (s.newFramings > 0) items.push(s.newFramings === 1 ? "a title for a job you have" : `${s.newFramings} titles for jobs you have`);
  if (s.newSkills > 0) items.push(count(s.newSkills, "skill", "skills"));
  if (s.newProjects > 0) items.push(count(s.newProjects, "project", "projects"));
  if (s.newEducation > 0) items.push(count(s.newEducation, "education entry", "education entries"));
  if (s.newCertifications > 0) items.push(count(s.newCertifications, "certification", "certifications"));
  if (s.newAchievements > 0) items.push(count(s.newAchievements, "achievement", "achievements"));

  const { total, inRecord, reworded } = s.bullets;
  const parts = [
    total === 0
      ? "No bullets to compare."
      : inRecord === 0
        ? total === 1
          ? "Its one bullet is not in your record word for word."
          : `None of its ${total} bullets are in your record word for word.`
        : `${inRecord} of ${count(total, "bullet is", "bullets are")} already in your record.`,
  ];
  if (reworded > 0) parts.push(`${count(reworded, "is", "are")} worded differently from a fact you have.`);
  if (items.length > 0) parts.push(`New: ${list(items)}.`);
  return parts.join(" ");
}
