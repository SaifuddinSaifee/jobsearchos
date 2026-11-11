import type { DocJSON } from "@/lib/documents/build";
import { newId } from "@/lib/documents/build";
import { CONTACT_SEP, profileToDoc } from "@/lib/documents/convert/profile-to-doc";
import type { Profile } from "@/lib/profile/schema";
import type { WrittenBullet, WrittenResume } from "./write";

// The written resume as an editor document. Employers, titles, dates, schools and certifications come from the record
// (by way of the plan), never from the model. Every bullet is remembered with the facts it was written from.

/** A way of working, not a place: "Remote", "Hybrid", "Open to relocate". */
const WORK_MODE = /^(?:remote|hybrid|on-?site|in office|anywhere|open to (?:relocat\w*|remote)|willing to relocate)$/i;

/**
 * The header's location. How the candidate meets the job's conditions goes there when they said ("Open to relocating to
 * Toronto"). When the job sets a location and they did not answer, a location that is only a way of working ("Remote")
 * is left out: next to a phone number from another country it reads as evasive, and the number already says where they
 * are. A real place is always kept.
 */
export function headerLocation(location: string, mention: string, locationAsked: boolean): string {
  const place = location.trim();
  const modeOnly = place !== "" && place.split(/\s*[|,/;]\s*/).filter(Boolean).every((p) => WORK_MODE.test(p));
  const kept = modeOnly && (locationAsked || mention) ? "" : place;
  return [kept, mention.trim()].filter(Boolean).join(CONTACT_SEP);
}

/** The resume as the structured profile that `profileToDoc` knows how to lay out. */
export function resumeToProfile(w: WrittenResume, contact: Profile["contact"]): Profile {
  return {
    contact: { ...contact, location: headerLocation(contact.location, w.mention ?? "", w.locationAsked ?? false) },
    summary: w.summary,
    experience: w.roles.map((r) => ({
      company: r.plan.employer,
      title: r.plan.title,
      location: r.plan.location,
      start: r.plan.start,
      end: r.plan.end,
      current: r.plan.current,
      bullets: r.bullets.map((b) => b.text),
    })),
    // The Interests line sits with the skills, the way resumes usually carry it.
    skills: w.interests ? [...w.skills, { category: "Interests", items: [w.interests] }] : w.skills,
    technologies: [],
    projects: w.projects.map((p) => ({
      name: p.plan.name,
      description: p.plan.description,
      technologies: p.plan.technologies,
      url: p.plan.url,
      bullets: p.bullets.map((b) => b.text),
    })),
    education: w.education.map((e) => ({ institution: e.institution, degree: e.degree, field: e.field, start: e.start, end: e.end, details: e.details })),
    certifications: w.certifications.map((c) => ({ name: c.name, issuer: c.issuer, date: c.date })),
    achievements: w.achievements,
  };
}

/** The bullet ids of each entry (role or project) of a section, in order. */
function entryBulletIds(doc: DocJSON, sectionKind: string): string[][] {
  const section = (doc.content ?? []).find((n) => n.type === "section" && n.attrs?.kind === sectionKind);
  return (section?.content ?? [])
    .filter((n) => n.type === "role" || n.type === "project")
    .map((entry) =>
      (entry.content ?? [])
        .filter((c) => c.type === "bulletList")
        .flatMap((list) => (list.content ?? []).map((b) => String(b.attrs?.id ?? "")))
        .filter(Boolean),
    );
}

/** What a bullet was written from: the facts, and `req:<id>` for something the user said they have. */
export const bulletSources = (b: WrittenBullet): string[] => [...b.factIds, ...b.userRequirementIds.map((id) => `req:${id}`)];

/**
 * The editor document for a written resume, and which facts each bullet came from, by the bullet's block id. The ids
 * are read back from the document in order, so they stay right whatever `profileToDoc` does with them.
 */
export function buildResumeDoc(w: WrittenResume, contact: Profile["contact"], id = newId): { doc: DocJSON; bulletFacts: Record<string, string[]> } {
  const doc = profileToDoc(resumeToProfile(w, contact), id);
  const bulletFacts: Record<string, string[]> = {};
  const remember = (ids: string[][], entries: { bullets: WrittenBullet[] }[]) =>
    entries.forEach((entry, i) => entry.bullets.forEach((b, j) => ids[i]?.[j] && (bulletFacts[ids[i][j]] = bulletSources(b))));
  remember(entryBulletIds(doc, "experience"), w.roles);
  remember(entryBulletIds(doc, "projects"), w.projects);
  return { doc, bulletFacts };
}
