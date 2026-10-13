import type { IdGen } from "@/lib/documents/build";
import { mergeDates } from "./dates";
import { removalKey } from "./dedupe";
import type { EditOp } from "./edit-schema";
import { normalizeText } from "./normalize";
import type { CareerRecord, Fact, Framing, Provenance, RecordItemKind, Role, SourceRef, Wording } from "./schema";

// Applying one hand edit to the record. Pure. Anything the user touches is marked as theirs, so a later merge never
// overwrites it, and anything they delete leaves a tombstone, so a later merge proposes leaving it out.

export class EditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EditError";
  }
}

export type EditContext = { newId: IdGen; now: Date };

const userMade = (): Provenance => ({ origin: "user", user: [] });

function touch(p: Provenance, ...fields: string[]) {
  for (const f of fields) if (!p.user.includes(f)) p.user.push(f);
}

const addRef = (list: SourceRef[], ref: SourceRef) => {
  if (!list.some((r) => r.sourceId === ref.sourceId && r.blockId === ref.blockId)) list.push(ref);
};

function tombstone(record: CareerRecord, kind: RecordItemKind, key: string, ctx: EditContext) {
  if (!key || record.removed.some((r) => r.kind === kind && r.key === key)) return;
  record.removed.push({ kind, key, at: ctx.now.toISOString() });
}

type Located = { employer: CareerRecord["employers"][number]; role: Role };

function findRole(record: CareerRecord, roleId: string): Located {
  for (const employer of record.employers) {
    const role = employer.roles.find((r) => r.id === roleId);
    if (role) return { employer, role };
  }
  throw new EditError("That role is no longer in your record.");
}

function findFact(record: CareerRecord, factId: string): Located & { fact: Fact } {
  for (const employer of record.employers) {
    for (const role of employer.roles) {
      const fact = role.facts.find((f) => f.id === factId);
      if (fact) return { employer, role, fact };
    }
  }
  throw new EditError("That fact is no longer in your record.");
}

function findWording(record: CareerRecord, wordingId: string): Located & { fact: Fact; wording: Wording } {
  for (const employer of record.employers) {
    for (const role of employer.roles) {
      for (const fact of role.facts) {
        const wording = fact.wordings.find((w) => w.id === wordingId);
        if (wording) return { employer, role, fact, wording };
      }
    }
  }
  throw new EditError("That wording is no longer in your record.");
}

function findFraming(record: CareerRecord, framingId: string): Located & { framing: Framing } {
  for (const employer of record.employers) {
    for (const role of employer.roles) {
      const framing = role.framings.find((f) => f.id === framingId);
      if (framing) return { employer, role, framing };
    }
  }
  throw new EditError("That framing is no longer in your record.");
}

function roleTombstones(record: CareerRecord, employerName: string, role: Role, ctx: EditContext) {
  for (const f of role.framings) tombstone(record, "role", removalKey.role(employerName, f.title), ctx);
}

const firstTitle = (r: Role) => r.framings[0]?.title || "role";

function newWording(ctx: EditContext, textValue: string, framingId: string | null): Wording {
  return { id: ctx.newId(), text: textValue, framingId, form: "bullet", sources: [], provenance: userMade() };
}

/** Applies one edit and returns the next record and a short note for the version history. Throws `EditError` for stale ids. */
export function applyEdit(record: CareerRecord, op: EditOp, ctx: EditContext): { record: CareerRecord; note: string } {
  const next = structuredClone(record);
  let note = "";

  switch (op.op) {
    case "editWording": {
      const { employer, wording } = findWording(next, op.wordingId);
      wording.text = op.text;
      touch(wording.provenance, "text");
      note = `Edited a wording at ${employer.name}`;
      break;
    }
    case "addWording": {
      const { employer, fact, role } = findFact(next, op.factId);
      const framingId = op.framingId && role.framings.some((f) => f.id === op.framingId) ? op.framingId : null;
      fact.wordings.push(newWording(ctx, op.text, framingId));
      note = `Added a wording at ${employer.name}`;
      break;
    }
    case "moveWording": {
      const from = findWording(next, op.wordingId);
      from.fact.wordings = from.fact.wordings.filter((w) => w.id !== op.wordingId);
      if (op.toFactId === null) {
        from.role.facts.push({ id: ctx.newId(), wordings: [from.wording], provenance: userMade() });
      } else {
        const to = findFact(next, op.toFactId);
        if (to.role.id !== from.role.id) throw new EditError("A wording can only move to a fact of the same role.");
        to.fact.wordings.push(from.wording);
      }
      from.role.facts = from.role.facts.filter((f) => f.wordings.length > 0);
      note = `Moved a wording at ${from.employer.name}`;
      break;
    }
    case "deleteWording": {
      const { employer, role, fact, wording } = findWording(next, op.wordingId);
      fact.wordings = fact.wordings.filter((w) => w.id !== op.wordingId);
      role.facts = role.facts.filter((f) => f.wordings.length > 0);
      tombstone(next, "wording", removalKey.wording(wording.text), ctx);
      note = `Deleted a wording at ${employer.name}`;
      break;
    }
    case "addFact": {
      const { employer, role } = findRole(next, op.roleId);
      const framingId = op.framingId && role.framings.some((f) => f.id === op.framingId) ? op.framingId : null;
      role.facts.push({ id: ctx.newId(), wordings: [newWording(ctx, op.text, framingId)], provenance: userMade() });
      note = `Added a fact at ${employer.name}`;
      break;
    }
    case "mergeFacts": {
      if (op.factId === op.intoFactId) throw new EditError("Pick a different fact to merge into.");
      const from = findFact(next, op.factId);
      const into = findFact(next, op.intoFactId);
      if (from.role.id !== into.role.id) throw new EditError("Facts can only be merged within one role.");
      for (const w of from.fact.wordings) {
        const same = into.fact.wordings.find((x) => x.text.trim() === w.text.trim());
        if (same) for (const s of w.sources) addRef(same.sources, s);
        else into.fact.wordings.push(w);
      }
      from.role.facts = from.role.facts.filter((f) => f.id !== op.factId);
      note = `Merged two facts at ${from.employer.name}`;
      break;
    }
    case "deleteFact": {
      const { employer, role, fact } = findFact(next, op.factId);
      for (const w of fact.wordings) tombstone(next, "wording", removalKey.wording(w.text), ctx);
      role.facts = role.facts.filter((f) => f.id !== op.factId);
      note = `Deleted a fact at ${employer.name}`;
      break;
    }
    case "editRole": {
      const { employer, role } = findRole(next, op.roleId);
      if (op.start !== undefined) role.start = op.start;
      if (op.end !== undefined) role.end = op.end;
      if (op.current !== undefined) role.current = op.current;
      if (op.location !== undefined) role.location = op.location;
      if (role.current) role.end = "";
      const fields = [op.start !== undefined && "start", op.end !== undefined && "end", op.current !== undefined && "current", op.location !== undefined && "location"].filter(
        (f): f is string => typeof f === "string",
      );
      // The dates are now yours, so earlier disagreements between sources no longer apply.
      if (fields.some((f) => f !== "location")) role.dateNotes = [];
      touch(role.provenance, ...fields, ...(role.current && !fields.includes("end") ? ["end"] : []));
      note = `Edited dates at ${employer.name}`;
      break;
    }
    case "addFraming": {
      const { employer, role } = findRole(next, op.roleId);
      role.framings.push({ id: ctx.newId(), title: op.title, angle: op.angle, targetRoles: [], sources: [], provenance: userMade() });
      note = `Added a framing at ${employer.name}`;
      break;
    }
    case "editFraming": {
      const { employer, framing } = findFraming(next, op.framingId);
      if (op.title !== undefined) framing.title = op.title;
      if (op.angle !== undefined) framing.angle = op.angle;
      touch(framing.provenance, ...[op.title !== undefined && "title", op.angle !== undefined && "angle"].filter((f): f is string => typeof f === "string"));
      note = `Edited a framing at ${employer.name}`;
      break;
    }
    case "splitFraming": {
      const { employer, role, framing } = findFraming(next, op.framingId);
      if (role.framings.length < 2) throw new EditError("A role needs at least one framing, so there is nothing to split off.");
      const split: Role = {
        id: ctx.newId(),
        start: role.start,
        end: role.end,
        current: role.current,
        location: role.location,
        dateNotes: [],
        framings: [framing],
        facts: [],
        sources: structuredClone(framing.sources),
        provenance: userMade(),
      };
      role.framings = role.framings.filter((f) => f.id !== framing.id);
      // Wordings written for this framing go with it, each as a fact of its own in the new role.
      for (const fact of role.facts) {
        const moving = fact.wordings.filter((w) => w.framingId === framing.id);
        fact.wordings = fact.wordings.filter((w) => w.framingId !== framing.id);
        for (const w of moving) split.facts.push({ id: ctx.newId(), wordings: [w], provenance: structuredClone(fact.provenance) });
      }
      role.facts = role.facts.filter((f) => f.wordings.length > 0);
      employer.roles.push(split);
      note = `Split ${framing.title} into its own role at ${employer.name}`;
      break;
    }
    case "mergeRoles": {
      if (op.roleId === op.intoRoleId) throw new EditError("Pick a different role to merge into.");
      const from = findRole(next, op.roleId);
      const into = findRole(next, op.intoRoleId);
      if (from.employer.id !== into.employer.id) throw new EditError("Roles can only be merged within one employer.");
      const merged = mergeDates(
        { start: into.role.start, end: into.role.end, current: into.role.current },
        { start: from.role.start, end: from.role.end, current: from.role.current },
      );
      if (!into.role.provenance.user.some((f) => ["start", "end", "current"].includes(f))) {
        into.role.start = merged.dates.start;
        into.role.end = merged.dates.end;
        into.role.current = merged.dates.current;
      }
      if (!into.role.location && from.role.location) into.role.location = from.role.location;
      for (const n of from.role.dateNotes) if (!into.role.dateNotes.includes(n)) into.role.dateNotes.push(n);
      for (const s of from.role.sources) addRef(into.role.sources, s);
      for (const f of from.role.framings) {
        const same = into.role.framings.find((x) => normalizeText(x.title) === normalizeText(f.title));
        if (same) {
          for (const w of from.role.facts.flatMap((x) => x.wordings)) if (w.framingId === f.id) w.framingId = same.id;
          for (const s of f.sources) addRef(same.sources, s);
          for (const t of f.targetRoles) if (!same.targetRoles.includes(t)) same.targetRoles.push(t);
        } else into.role.framings.push(f);
      }
      into.role.facts.push(...from.role.facts);
      into.employer.roles = into.employer.roles.filter((r) => r.id !== op.roleId);
      note = `Merged two roles at ${into.employer.name}`;
      break;
    }
    case "deleteRole": {
      const { employer, role } = findRole(next, op.roleId);
      roleTombstones(next, employer.name, role, ctx);
      for (const w of role.facts.flatMap((f) => f.wordings)) tombstone(next, "wording", removalKey.wording(w.text), ctx);
      employer.roles = employer.roles.filter((r) => r.id !== op.roleId);
      note = `Deleted ${firstTitle(role)} at ${employer.name}`;
      break;
    }
    case "editEmployer": {
      const employer = next.employers.find((e) => e.id === op.employerId);
      if (!employer) throw new EditError("That employer is no longer in your record.");
      if (!employer.names.some((n) => normalizeText(n) === normalizeText(op.name))) employer.names.push(op.name);
      employer.name = op.name;
      touch(employer.provenance, "name");
      note = `Renamed ${employer.name}`;
      break;
    }
    case "deleteEmployer": {
      const employer = next.employers.find((e) => e.id === op.employerId);
      if (!employer) throw new EditError("That employer is no longer in your record.");
      tombstone(next, "employer", removalKey.employer(employer.name), ctx);
      for (const role of employer.roles) {
        roleTombstones(next, employer.name, role, ctx);
        for (const w of role.facts.flatMap((f) => f.wordings)) tombstone(next, "wording", removalKey.wording(w.text), ctx);
      }
      next.employers = next.employers.filter((e) => e.id !== op.employerId);
      note = `Deleted ${employer.name}`;
      break;
    }
    case "addSkill": {
      if (next.skills.some((s) => normalizeText(s.name) === normalizeText(op.name))) throw new EditError("That skill is already in your record.");
      next.skills.push({ id: ctx.newId(), name: op.name, category: op.category, sources: [], provenance: userMade() });
      note = `Added the skill ${op.name}`;
      break;
    }
    case "editSkill": {
      const skill = next.skills.find((s) => s.id === op.skillId);
      if (!skill) throw new EditError("That skill is no longer in your record.");
      if (op.name !== undefined) skill.name = op.name;
      if (op.category !== undefined) skill.category = op.category;
      touch(skill.provenance, ...[op.name !== undefined && "name", op.category !== undefined && "category"].filter((f): f is string => typeof f === "string"));
      note = `Edited the skill ${skill.name}`;
      break;
    }
    case "addAchievement": {
      next.achievements.push({ id: ctx.newId(), text: op.text, sources: [], provenance: userMade() });
      note = "Added an achievement";
      break;
    }
    case "editAchievement": {
      const a = next.achievements.find((x) => x.id === op.achievementId);
      if (!a) throw new EditError("That achievement is no longer in your record.");
      a.text = op.text;
      touch(a.provenance, "text");
      note = "Edited an achievement";
      break;
    }
    case "deleteItem": {
      const lists = {
        skill: [next.skills, (x: { name: string }) => removalKey.skill(x.name)],
        project: [next.projects, (x: { name: string }) => removalKey.project(x.name)],
        education: [next.education, (x: { institution: string; degree: string }) => removalKey.education(x.institution, x.degree)],
        certification: [next.certifications, (x: { name: string }) => removalKey.certification(x.name)],
        achievement: [next.achievements, (x: { text: string }) => removalKey.achievement(x.text)],
        motivation: [next.motivations, (x: { text: string }) => removalKey.motivation(x.text)],
      } as const;
      const [list, keyOf] = lists[op.kind] as unknown as [{ id: string }[], (x: never) => string];
      const item = list.find((x) => x.id === op.itemId);
      if (!item) throw new EditError("That item is no longer in your record.");
      tombstone(next, op.kind, keyOf(item as never), ctx);
      list.splice(list.indexOf(item), 1);
      note = `Deleted a ${op.kind}`;
      break;
    }
  }
  return { record: next, note };
}
