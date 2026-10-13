import { dateConflict, guessAngle, matchEmployer, matchRole } from "./match";
import {
  classifyBullet,
  isRemoved,
  matchAchievement,
  matchCertification,
  matchEducation,
  matchProject,
  matchSkill,
  removalKey,
} from "./dedupe";
import { formatDates, toSpan } from "./dates";
import type { ExtractedRole, SourceExtract } from "./extract";
import { hash8, normalizeEmployer } from "./normalize";
import type { BulletItem, EmployerItem, Proposal, RoleItem, SimpleSuggestion } from "./proposal-schema";
import type { CareerRecord, Employer, Role } from "./schema";

export type SourceMeta = {
  sourceId: string;
  label: string;
  targetRole: string | null;
  /** The company a cover letter was written for (from the document or its job), if known. */
  company?: { id: string | null; name: string } | null;
};

/** Keys must be unique inside a proposal and the same whenever the same source is read again. */
function keyMaker() {
  const seen = new Set<string>();
  return (prefix: string, blockId: string | null, content: string): string => {
    const base = `${prefix}:${blockId ?? hash8(content)}`;
    let key = base;
    for (let n = 2; seen.has(key); n++) key = `${base}~${n}`;
    seen.add(key);
    return key;
  };
}

const simple = (found: { id: string } | null): SimpleSuggestion => (found ? { to: "existing", id: found.id } : { to: "new" });

/**
 * Turns what was read from a source into a proposal against the current record. Everything in it is a suggestion:
 * nothing changes until the user has reviewed it and it is applied. Throws if any text in the proposal is not
 * word for word in the source (see `assertTextFromSource`).
 */
export function buildProposal(
  current: { version: number; record: CareerRecord },
  extract: SourceExtract,
  source: SourceMeta,
  now: Date = new Date(),
  /** Companies directory rows by normalized employer name, so employers can be linked to their company page. */
  companyIds: ReadonlyMap<string, string> = new Map(),
): Proposal {
  const { record } = current;
  const key = keyMaker();
  const warnings: string[] = [];

  const byEmployer = new Map<string, { name: string; roles: ExtractedRole[] }>();
  for (const r of extract.roles) {
    const name = r.company.trim() || "Unknown employer";
    if (!r.company.trim()) warnings.push(`A role${r.title ? ` ("${r.title}")` : ""} has no company, so it is grouped as Unknown employer.`);
    const k = normalizeEmployer(name);
    const entry = byEmployer.get(k) ?? { name, roles: [] };
    entry.roles.push(r);
    byEmployer.set(k, entry);
  }

  const employers: EmployerItem[] = [];
  for (const [k, group] of byEmployer) {
    const linked = companyIds.get(k) ?? null;
    const existing = matchEmployer(record.employers, group.name, linked);
    employers.push({
      key: key("e", null, k),
      name: group.name,
      companyId: linked ?? existing?.companyId ?? null,
      suggestion: existing ? { to: "existing", employerId: existing.id } : { to: "new" },
      removedBefore: isRemoved(record, "employer", removalKey.employer(group.name)),
      roles: group.roles.map((r) => roleItem(r, existing, record, key, warnings, now)),
    });
  }

  const proposal: Proposal = {
    sourceId: source.sourceId,
    baseVersion: current.version,
    label: source.label,
    targetRole: source.targetRole,
    warnings,
    employers,
    skills: extract.skills.map((s) => ({
      key: key("s", s.blockId, `${s.category}|${s.name}`),
      blockId: s.blockId,
      category: s.category,
      name: s.name,
      suggestion: simple(matchSkill(record, s.name)),
      removedBefore: isRemoved(record, "skill", removalKey.skill(s.name)),
    })),
    projects: extract.projects.map((p) => ({
      key: key("p", p.blockId, p.name),
      blockId: p.blockId,
      name: p.name,
      description: p.description,
      url: p.url,
      technologies: p.technologies,
      bullets: p.bullets,
      suggestion: simple(matchProject(record, p.name)),
      removedBefore: isRemoved(record, "project", removalKey.project(p.name)),
    })),
    education: extract.education.map((e) => ({
      key: key("d", e.blockId, `${e.institution}|${e.degree}`),
      blockId: e.blockId,
      institution: e.institution,
      degree: e.degree,
      field: e.field,
      start: e.start,
      end: e.end,
      details: e.details,
      suggestion: simple(matchEducation(record, e.institution, e.degree)),
      removedBefore: isRemoved(record, "education", removalKey.education(e.institution, e.degree)),
    })),
    certifications: extract.certifications.map((c) => ({
      key: key("c", c.blockId, c.name),
      blockId: c.blockId,
      name: c.name,
      issuer: c.issuer,
      date: c.date,
      suggestion: simple(matchCertification(record, c.name)),
      removedBefore: isRemoved(record, "certification", removalKey.certification(c.name)),
    })),
    // Until a paragraph has been classified it is left out (boilerplate), so nothing unread ever reaches the record.
    paragraphs: extract.paragraphs.map((p) => ({
      key: key("t", p.blockId, p.text),
      blockId: p.blockId,
      text: p.text,
      suggestion: { kind: "boilerplate", roleId: null, factId: null },
      companyId: source.company?.id ?? null,
      companyName: source.company?.name ?? "",
      removedBefore: isRemoved(record, "wording", removalKey.wording(p.text)) || isRemoved(record, "motivation", removalKey.motivation(p.text)),
    })),
    achievements: extract.achievements.map((a) => ({
      key: key("a", a.blockId, a.text),
      blockId: a.blockId,
      text: a.text,
      suggestion: simple(matchAchievement(record, a.text)),
      removedBefore: isRemoved(record, "achievement", removalKey.achievement(a.text)),
    })),
  };

  assertTextFromSource(proposal, extract);
  return proposal;
}

function roleItem(
  r: ExtractedRole,
  employer: Employer | null,
  record: CareerRecord,
  key: (prefix: string, blockId: string | null, content: string) => string,
  warnings: string[],
  now: Date,
): RoleItem {
  const dates = { start: r.start, end: r.end, current: r.current };
  const readable = toSpan(dates) !== null;
  const label = `${r.title || "Role"} at ${r.company || "Unknown employer"}`;
  if (!readable) {
    warnings.push(
      r.datesText ? `Dates could not be read for ${label} ("${r.datesText}").` : `No dates for ${label}.`,
    );
  }

  const { match, candidates } = matchRole(employer, { ...dates, title: r.title }, now);
  let role: Role | null = null;
  let suggestion: RoleItem["suggestion"] = { to: "new" };
  let dateNote: string | null = null;
  if (match.kind === "same") {
    role = match.role;
    suggestion = { to: "same", roleId: match.role.id, framingId: match.framing?.id ?? null };
  } else if (match.kind === "framing") {
    role = match.role;
    suggestion = { to: "framing", roleId: match.role.id };
  } else {
    dateNote = match.note;
  }
  if (role && dateConflict(role, dates)) {
    dateNote = `Your record has ${formatDates(role)}; this source says ${r.datesText}.`;
  }

  const bullets: BulletItem[] = r.bullets.map((b) => ({
    key: key("b", b.blockId, b.text),
    blockId: b.blockId,
    text: b.text,
    suggestion: classifyBullet(role, b),
    removedBefore: isRemoved(record, "wording", removalKey.wording(b.text)),
  }));

  return {
    key: key("r", r.blockId, `${r.company}|${r.title}|${r.start}`),
    blockId: r.blockId,
    title: r.title,
    start: r.start,
    end: r.end,
    current: r.current,
    location: r.location,
    datesText: r.datesText,
    datesReadable: readable,
    angleGuess: guessAngle(r.title),
    suggestion,
    candidates: candidates.map((c) => c.id),
    dateNote,
    removedBefore: isRemoved(record, "role", removalKey.role(r.company, r.title)),
    bullets,
  };
}

/**
 * The merge may group text but never write it: every wording, skill and achievement in a proposal must be one of
 * the strings that were read from the source, byte for byte.
 */
export function assertTextFromSource(proposal: Proposal, extract: SourceExtract): void {
  const allowed = new Set<string>();
  for (const r of extract.roles) for (const b of r.bullets) allowed.add(b.text);
  for (const p of extract.projects) for (const b of p.bullets) allowed.add(b.text);
  for (const a of extract.achievements) allowed.add(a.text);
  for (const s of extract.skills) allowed.add(s.name);
  for (const p of extract.paragraphs) allowed.add(p.text);

  const check = (text: string, where: string) => {
    if (!allowed.has(text)) throw new Error(`Proposal text is not from the source (${where}): ${text.slice(0, 80)}`);
  };
  for (const e of proposal.employers) for (const r of e.roles) for (const b of r.bullets) check(b.text, "bullet");
  for (const p of proposal.projects) for (const b of p.bullets) check(b.text, "project bullet");
  for (const a of proposal.achievements) check(a.text, "achievement");
  for (const s of proposal.skills) check(s.name, "skill");
  for (const p of proposal.paragraphs) check(p.text, "paragraph");
}

