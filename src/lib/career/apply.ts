import type { IdGen } from "@/lib/documents/build";
import { formatDates, mergeDates } from "./dates";
import { normalizeEmployer, normalizeText, normalizeTitle } from "./normalize";
import type {
  AchievementItem,
  BulletItem,
  BulletSuggestion,
  CertificationItem,
  Decisions,
  EducationItem,
  EmployerItem,
  ParagraphChoice,
  ParagraphItem,
  EmployerSuggestion,
  ProjectItem,
  Proposal,
  RoleItem,
  RoleSuggestion,
  SimpleSuggestion,
  SkillItem,
} from "./proposal-schema";
import {
  mergeProvenance,
  type CareerRecord,
  type Employer,
  type Fact,
  type Framing,
  type Role,
  type SourceRef,
  type Wording,
} from "./schema";

// Turning a proposal and the user's decisions into the next record. Pure: the same inputs give the same record.
// The rule that matters most is that existing text is never changed: a merge only adds sources and new items, and
// fills empty fields. Anything the user edited by hand is left alone.

// ---- Resolving decisions ----

export type ResolvedBullet = { item: BulletItem; target: BulletSuggestion; included: boolean };
export type ResolvedRole = {
  item: RoleItem;
  target: RoleSuggestion;
  angle: string;
  included: boolean;
  bullets: ResolvedBullet[];
};
export type ResolvedEmployer = { item: EmployerItem; target: EmployerSuggestion; included: boolean; roles: ResolvedRole[] };
export type ResolvedSimple<T> = { item: T; target: SimpleSuggestion; included: boolean };

export type ResolvedParagraph = { item: ParagraphItem; choice: ParagraphChoice; included: boolean };

export type Resolved = {
  employers: ResolvedEmployer[];
  skills: ResolvedSimple<SkillItem>[];
  projects: ResolvedSimple<ProjectItem>[];
  education: ResolvedSimple<EducationItem>[];
  certifications: ResolvedSimple<CertificationItem>[];
  achievements: ResolvedSimple<AchievementItem>[];
  paragraphs: ResolvedParagraph[];
};

type Flagged = { key: string; removedBefore: boolean };

const simpleId = (t: SimpleSuggestion) => (t.to === "existing" ? t.id : undefined);
const employerId = (t: EmployerSuggestion) => (t.to === "existing" ? t.employerId : undefined);
const roleId = (t: RoleSuggestion) => (t.to === "new" ? undefined : t.roleId);
const factId = (t: BulletSuggestion) => (t.to === "new" ? undefined : t.factId);

/** No decision means "as suggested", except that something the user deleted before starts out left out. */
function isIncluded(item: Flagged, decisions: Decisions): boolean {
  const d = decisions[item.key];
  if (!d) return !item.removedBefore;
  return d.action !== "reject";
}

/**
 * The effective plan: each item's suggestion (or the user's change to it), whether it is included, and with links
 * to things that are no longer valid cleared. A role moved to "new role" cannot keep bullets pointing at facts of
 * the old one, so those become new facts. Shared by the review screen and by the server when applying.
 */
export function resolveDecisions(proposal: Proposal, decisions: Decisions, record: CareerRecord): Resolved {
  const simple = <T extends Flagged & { suggestion: SimpleSuggestion }>(item: T): ResolvedSimple<T> => ({
    item,
    target: decisions[item.key]?.simple ?? item.suggestion,
    included: isIncluded(item, decisions),
  });

  const employers = proposal.employers.map((e): ResolvedEmployer => {
    const employerTarget = decisions[e.key]?.employer ?? e.suggestion;
    const employerIncluded = isIncluded(e, decisions);
    const wantedEmployerId = employerId(employerTarget);
    const employer = wantedEmployerId ? record.employers.find((x) => x.id === wantedEmployerId) : undefined;

    const roles = e.roles.map((r): ResolvedRole => {
      let roleTarget = decisions[r.key]?.role ?? r.suggestion;
      // A role can only join a role of the employer it is going under.
      const wanted = roleId(roleTarget);
      if (wanted && (employerTarget.to === "new" || (employer && !employer.roles.some((x) => x.id === wanted)))) {
        roleTarget = { to: "new" };
      }
      const targetRoleId = roleId(roleTarget);
      const targetRole = targetRoleId && employer ? employer.roles.find((x) => x.id === targetRoleId) : undefined;
      const roleIncluded = employerIncluded && isIncluded(r, decisions);

      const bullets = r.bullets.map((b): ResolvedBullet => {
        let target = decisions[b.key]?.bullet ?? b.suggestion;
        if (roleTarget.to === "new") target = target.to === "new" ? target : { to: "new" };
        else if (target.to !== "new" && targetRole) {
          const wanted = target;
          const fact = targetRole.facts.find((f) => f.id === wanted.factId);
          const wordingOk = wanted.to === "known" ? fact?.wordings.some((w) => w.id === wanted.wordingId) : true;
          if (!fact || !wordingOk) target = { to: "new" };
        }
        return { item: b, target, included: roleIncluded && isIncluded(b, decisions) };
      });
      // "Same new fact as that bullet" only holds while that bullet is in; otherwise it follows what that bullet does.
      for (const b of bullets) {
        if (b.target.to !== "new" || !b.target.withKey) continue;
        const withKey = b.target.withKey;
        const ref = bullets.find((x) => x.item.key === withKey && x !== b);
        if (!ref || !ref.included) b.target = { to: "new" };
        else if (ref.target.to === "fact") b.target = { to: "fact", factId: ref.target.factId, why: "model" };
        else if (ref.target.to === "known") b.target = { to: "fact", factId: ref.target.factId, why: "model" };
        else if (ref.target.withKey) b.target = { to: "new" };
      }
      return { item: r, target: roleTarget, angle: decisions[r.key]?.angle ?? r.angleGuess, included: roleIncluded, bullets };
    });
    return { item: e, target: employerTarget, included: employerIncluded, roles };
  });

  const paragraphs = proposal.paragraphs.map((p): ResolvedParagraph => {
    let choice = decisions[p.key]?.paragraph ?? p.suggestion;
    // A story is about one role of the record, and can only join a fact of that role.
    if (choice.kind !== "story") choice = { kind: choice.kind, roleId: null, factId: null };
    else if (choice.factId) {
      const wanted = choice.factId;
      const role = record.employers.flatMap((e) => e.roles).find((r) => r.id === choice.roleId);
      if (role && !role.facts.some((f) => f.id === wanted)) choice = { ...choice, factId: null };
    }
    // Boilerplate is never kept, and a story with no role has nowhere to go.
    const usable = choice.kind !== "boilerplate" && (choice.kind !== "story" || choice.roleId !== null);
    return { item: p, choice, included: usable && isIncluded(p, decisions) };
  });

  return {
    employers,
    paragraphs,
    skills: proposal.skills.map(simple),
    projects: proposal.projects.map(simple),
    education: proposal.education.map(simple),
    certifications: proposal.certifications.map(simple),
    achievements: proposal.achievements.map(simple),
  };
}

// ---- Checking references ----

/** Ids the included items point at that the record no longer has. Empty means the proposal still applies. */
export function checkRefs(record: CareerRecord, resolved: Resolved): string[] {
  const missing: string[] = [];
  const employers = new Map(record.employers.map((e) => [e.id, e]));
  for (const e of resolved.employers) {
    if (!e.included) continue;
    const wantedEmployer = employerId(e.target);
    const employer = wantedEmployer ? employers.get(wantedEmployer) : undefined;
    if (wantedEmployer && !employer) missing.push(wantedEmployer);
    for (const r of e.roles) {
      const wantedRole = roleId(r.target);
      if (!r.included || !wantedRole) continue;
      const role = employer?.roles.find((x) => x.id === wantedRole);
      if (!role) {
        missing.push(wantedRole);
        continue;
      }
      for (const b of r.bullets) {
        const wantedFact = factId(b.target);
        if (b.included && wantedFact && !role.facts.some((f) => f.id === wantedFact)) missing.push(wantedFact);
      }
    }
  }
  const roles = record.employers.flatMap((e) => e.roles);
  for (const p of resolved.paragraphs) {
    if (!p.included || p.choice.kind !== "story" || !p.choice.roleId) continue;
    const wantedRole = p.choice.roleId;
    const role = roles.find((r) => r.id === wantedRole);
    if (!role) missing.push(wantedRole);
    else if (p.choice.factId && !role.facts.some((f) => f.id === p.choice.factId)) missing.push(p.choice.factId);
  }
  const lists: [{ id: string }[], ResolvedSimple<Flagged & { suggestion: SimpleSuggestion }>[]][] = [
    [record.skills, resolved.skills],
    [record.projects, resolved.projects],
    [record.education, resolved.education],
    [record.certifications, resolved.certifications],
    [record.achievements, resolved.achievements],
  ];
  for (const [existing, items] of lists) {
    for (const s of items) {
      const wanted = simpleId(s.target);
      if (s.included && wanted && !existing.some((x) => x.id === wanted)) missing.push(wanted);
    }
  }
  return missing;
}

// ---- Applying ----

export type ApplyContext = { sourceId: string; label: string; newId: IdGen };

export type ApplySummary = {
  employersAdded: number;
  rolesAdded: number;
  framingsAdded: number;
  factsAdded: number;
  wordingsAdded: number;
  /** Cover letter paragraphs added as stories under a role. */
  storiesAdded: number;
  /** Bullets that were already in the record, so only their source was added. */
  alreadyKnown: number;
  otherItemsAdded: number;
};

const sameRef = (a: SourceRef, b: SourceRef) => a.sourceId === b.sourceId && a.blockId === b.blockId;

function addRef(list: SourceRef[], ref: SourceRef) {
  if (!list.some((r) => sameRef(r, ref))) list.push(ref);
}

const userEdited = (p: { user: string[] }, ...fields: string[]) => fields.some((f) => p.user.includes(f));

function findFramingByTitle(role: Role, title: string): Framing | undefined {
  const key = normalizeTitle(title);
  return role.framings.find((f) => normalizeTitle(f.title) === key);
}

function addNote(role: Role, note: string) {
  if (!role.dateNotes.includes(note)) role.dateNotes.push(note);
}

/** Applies the included items of a resolved proposal on top of the record and returns the new record. */
export function applyProposal(
  record: CareerRecord,
  resolved: Resolved,
  ctx: ApplyContext,
  targetRole: string | null,
): { record: CareerRecord; summary: ApplySummary } {
  const next = structuredClone(record);
  const summary: ApplySummary = {
    employersAdded: 0,
    rolesAdded: 0,
    framingsAdded: 0,
    factsAdded: 0,
    wordingsAdded: 0,
    storiesAdded: 0,
    alreadyKnown: 0,
    otherItemsAdded: 0,
  };
  const employerRef: SourceRef = { sourceId: ctx.sourceId, blockId: null };

  for (const re of resolved.employers) {
    if (!re.included) continue;
    const wantedEmployer = employerId(re.target);
    let employer: Employer | undefined = wantedEmployer ? next.employers.find((e) => e.id === wantedEmployer) : undefined;
    // A second role of the same new employer in this proposal joins the one created a moment ago.
    employer ??= next.employers.find(
      (e) => e.provenance.origin === "merge" && e.sources.some((s) => sameRef(s, employerRef)) && normalizeEmployer(e.name) === normalizeEmployer(re.item.name),
    );
    if (!employer) {
      employer = {
        id: ctx.newId(),
        name: re.item.name,
        companyId: re.item.companyId,
        names: [re.item.name],
        roles: [],
        sources: [],
        provenance: mergeProvenance(),
      };
      next.employers.push(employer);
      summary.employersAdded++;
    } else {
      if (!employer.names.some((n) => normalizeEmployer(n) === normalizeEmployer(re.item.name))) employer.names.push(re.item.name);
      if (!employer.companyId && re.item.companyId && !userEdited(employer.provenance, "companyId")) {
        employer.companyId = re.item.companyId;
      }
    }
    addRef(employer.sources, employerRef);

    for (const rr of re.roles) {
      if (!rr.included) continue;
      applyRole(employer, rr, ctx, targetRole, summary);
    }
  }

  for (const s of resolved.skills) {
    if (!s.included) continue;
    const wanted = simpleId(s.target);
    const found = wanted ? next.skills.find((x) => x.id === wanted) : undefined;
    const ref = { sourceId: ctx.sourceId, blockId: s.item.blockId };
    if (found) addRef(found.sources, ref);
    else if (!next.skills.some((x) => normalizeText(x.name) === normalizeText(s.item.name))) {
      next.skills.push({ id: ctx.newId(), name: s.item.name, category: s.item.category, sources: [ref], provenance: mergeProvenance() });
      summary.otherItemsAdded++;
    }
  }

  for (const p of resolved.projects) {
    if (!p.included) continue;
    const ref = { sourceId: ctx.sourceId, blockId: p.item.blockId };
    const wanted = simpleId(p.target);
    let project = wanted ? next.projects.find((x) => x.id === wanted) : undefined;
    project ??= next.projects.find((x) => normalizeText(x.name) === normalizeText(p.item.name));
    if (!project) {
      project = {
        id: ctx.newId(),
        name: p.item.name,
        description: p.item.description,
        url: p.item.url,
        technologies: p.item.technologies,
        wordings: [],
        sources: [],
        provenance: mergeProvenance(),
      };
      next.projects.push(project);
      summary.otherItemsAdded++;
    } else {
      if (!project.description && p.item.description && !userEdited(project.provenance, "description")) project.description = p.item.description;
      if (!project.url && p.item.url && !userEdited(project.provenance, "url")) project.url = p.item.url;
      for (const t of p.item.technologies) {
        if (!project.technologies.some((x) => normalizeText(x) === normalizeText(t))) project.technologies.push(t);
      }
    }
    addRef(project.sources, ref);
    for (const b of p.item.bullets) {
      const existing = project.wordings.find((w) => w.text.trim() === b.text.trim());
      const bref = { sourceId: ctx.sourceId, blockId: b.blockId };
      if (existing) addRef(existing.sources, bref);
      else project.wordings.push(newWording(ctx, b.text, null, bref));
    }
  }

  for (const e of resolved.education) {
    if (!e.included) continue;
    const ref = { sourceId: ctx.sourceId, blockId: e.item.blockId };
    const wanted = simpleId(e.target);
    const found =
      (wanted ? next.education.find((x) => x.id === wanted) : undefined) ??
      next.education.find(
        (x) =>
          normalizeText(x.institution) === normalizeText(e.item.institution) &&
          (!x.degree || !e.item.degree || normalizeText(x.degree) === normalizeText(e.item.degree)),
      );
    if (found) {
      addRef(found.sources, ref);
      if (!found.field && e.item.field && !userEdited(found.provenance, "field")) found.field = e.item.field;
      if (!found.details && e.item.details && !userEdited(found.provenance, "details")) found.details = e.item.details;
    } else {
      next.education.push({
        id: ctx.newId(),
        institution: e.item.institution,
        degree: e.item.degree,
        field: e.item.field,
        start: e.item.start,
        end: e.item.end,
        details: e.item.details,
        sources: [ref],
        provenance: mergeProvenance(),
      });
      summary.otherItemsAdded++;
    }
  }

  for (const c of resolved.certifications) {
    if (!c.included) continue;
    const ref = { sourceId: ctx.sourceId, blockId: c.item.blockId };
    const wanted = simpleId(c.target);
    const found =
      (wanted ? next.certifications.find((x) => x.id === wanted) : undefined) ??
      next.certifications.find((x) => normalizeText(x.name) === normalizeText(c.item.name));
    if (found) {
      addRef(found.sources, ref);
      if (!found.issuer && c.item.issuer && !userEdited(found.provenance, "issuer")) found.issuer = c.item.issuer;
      if (!found.date && c.item.date && !userEdited(found.provenance, "date")) found.date = c.item.date;
    } else {
      next.certifications.push({
        id: ctx.newId(),
        name: c.item.name,
        issuer: c.item.issuer,
        date: c.item.date,
        sources: [ref],
        provenance: mergeProvenance(),
      });
      summary.otherItemsAdded++;
    }
  }

  for (const a of resolved.achievements) {
    if (!a.included) continue;
    const ref = { sourceId: ctx.sourceId, blockId: a.item.blockId };
    const wanted = simpleId(a.target);
    const found =
      (wanted ? next.achievements.find((x) => x.id === wanted) : undefined) ??
      next.achievements.find((x) => normalizeText(x.text) === normalizeText(a.item.text));
    if (found) addRef(found.sources, ref);
    else {
      next.achievements.push({ id: ctx.newId(), text: a.item.text, sources: [ref], provenance: mergeProvenance() });
      summary.otherItemsAdded++;
    }
  }

  for (const p of resolved.paragraphs) {
    if (!p.included) continue;
    const ref: SourceRef = { sourceId: ctx.sourceId, blockId: p.item.blockId };
    const text = p.item.text;
    if (p.choice.kind === "story") {
      const wantedRole = p.choice.roleId;
      const role = next.employers.flatMap((e) => e.roles).find((r) => r.id === wantedRole);
      if (!role) continue;
      const same = role.facts.flatMap((f) => f.wordings).find((w) => w.text.trim() === text.trim());
      if (same) {
        addRef(same.sources, ref);
        summary.alreadyKnown++;
        continue;
      }
      const wording: Wording = { ...newWording(ctx, text, null, ref), form: "paragraph" };
      const wantedFact = p.choice.factId;
      const fact = wantedFact ? role.facts.find((f) => f.id === wantedFact) : undefined;
      if (fact) fact.wordings.push(wording);
      else {
        role.facts.push({ id: ctx.newId(), wordings: [wording], provenance: mergeProvenance() });
        summary.factsAdded++;
      }
      summary.storiesAdded++;
    } else {
      const found = next.motivations.find((m) => normalizeText(m.text) === normalizeText(text));
      if (found) {
        addRef(found.sources, ref);
        continue;
      }
      const company = p.choice.kind === "motivation_company";
      next.motivations.push({
        id: ctx.newId(),
        text,
        scope: company ? "company" : "general",
        companyId: company ? p.item.companyId : null,
        companyName: company ? p.item.companyName : "",
        sources: [ref],
        provenance: mergeProvenance(),
      });
      summary.otherItemsAdded++;
    }
  }

  return { record: next, summary };
}

function newWording(ctx: ApplyContext, text: string, framingId: string | null, ref: SourceRef): Wording {
  return {
    id: ctx.newId(),
    text,
    framingId,
    form: "bullet",
    sources: [ref],
    provenance: mergeProvenance(),
  };
}

function applyRole(employer: Employer, rr: ResolvedRole, ctx: ApplyContext, targetRole: string | null, summary: ApplySummary) {
  const item = rr.item;
  const ref: SourceRef = { sourceId: ctx.sourceId, blockId: item.blockId };
  const dates = { start: item.start, end: item.end, current: item.current };

  const wantedRole = roleId(rr.target);
  let role: Role | undefined = wantedRole ? employer.roles.find((r) => r.id === wantedRole) : undefined;

  if (!role) {
    role = {
      id: ctx.newId(),
      start: item.start,
      end: item.end,
      current: item.current,
      location: item.location,
      dateNotes: [],
      framings: [],
      facts: [],
      sources: [],
      provenance: mergeProvenance(),
    };
    employer.roles.push(role);
    summary.rolesAdded++;
  } else {
    // Dates widen to cover both sources unless the user set them; a disagreement becomes a note, never a block.
    const merged = mergeDates({ start: role.start, end: role.end, current: role.current }, dates);
    if (!userEdited(role.provenance, "start", "end", "current")) {
      role.start = merged.dates.start;
      role.end = merged.dates.end;
      role.current = merged.dates.current;
    }
    if (merged.conflict) addNote(role, `"${ctx.label}" says ${item.datesText || formatDates(dates)}`);
    if (!role.location && item.location && !userEdited(role.provenance, "location")) role.location = item.location;
  }
  addRef(role.sources, ref);

  let framing: Framing | undefined;
  if (rr.target.to === "same" && rr.target.framingId) {
    const wantedFraming = rr.target.framingId;
    framing = role.framings.find((f) => f.id === wantedFraming);
  }
  framing ??= findFramingByTitle(role, item.title);
  if (!framing) {
    framing = {
      id: ctx.newId(),
      title: item.title,
      angle: rr.angle,
      targetRoles: [],
      sources: [],
      provenance: mergeProvenance(),
    };
    role.framings.push(framing);
    summary.framingsAdded++;
  } else if (!framing.angle && rr.angle && !userEdited(framing.provenance, "angle")) {
    framing.angle = rr.angle;
  }
  addRef(framing.sources, ref);
  if (targetRole && !framing.targetRoles.some((t) => normalizeText(t) === normalizeText(targetRole))) {
    framing.targetRoles.push(targetRole);
  }

  // Facts created in this pass, by the key of the bullet that made them, so a bullet can join one.
  const created = new Map<string, Fact>();
  const ordered = [...rr.bullets.filter((b) => !(b.target.to === "new" && b.target.withKey)), ...rr.bullets.filter((b) => b.target.to === "new" && b.target.withKey)];
  for (const rb of ordered) {
    if (!rb.included) continue;
    const bref: SourceRef = { sourceId: ctx.sourceId, blockId: rb.item.blockId };
    const text = rb.item.text;

    // Looked up again on the record being written, so the same text is never added twice.
    const same = role.facts.flatMap((f) => f.wordings).find((w) => w.text.trim() === text.trim());
    if (same) {
      addRef(same.sources, bref);
      summary.alreadyKnown++;
      continue;
    }
    const wantedFact = factId(rb.target);
    const joined = rb.target.to === "new" && rb.target.withKey ? created.get(rb.target.withKey) : undefined;
    const fact: Fact | undefined = joined ?? (wantedFact ? role.facts.find((f) => f.id === wantedFact) : undefined);
    if (fact) {
      fact.wordings.push(newWording(ctx, text, framing.id, bref));
    } else {
      const made: Fact = {
        id: ctx.newId(),
        wordings: [newWording(ctx, text, framing.id, bref)],
        provenance: mergeProvenance(),
      };
      role.facts.push(made);
      created.set(rb.item.key, made);
      summary.factsAdded++;
    }
    summary.wordingsAdded++;
  }
}
