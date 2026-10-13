import { describe, expect, it } from "vitest";
import { applyProposal, resolveDecisions } from "@/lib/career/apply";
import { applyEdit, EditError } from "@/lib/career/edit";
import { EditOpSchema, type EditOp } from "@/lib/career/edit-schema";
import { extractFromProfile } from "@/lib/career/extract";
import { buildProposal } from "@/lib/career/proposal";
import { CareerRecordSchema, emptyRecord, type CareerRecord } from "@/lib/career/schema";
import { counter, profileWith, SOURCE_A, SOURCE_B } from "./career-helpers";

const NOW = new Date(Date.UTC(2026, 9, 1));
const ctx = () => ({ newId: counter("e"), now: NOW });

/** Builds a record the same way the app does: by merging a source into an empty one. */
function merged(...roles: Parameters<typeof profileWith>[0]): CareerRecord {
  const x = extractFromProfile(profileWith(roles));
  x.skills = [{ blockId: null, category: "Languages", name: "Go" }];
  x.achievements = [{ blockId: null, text: "Won an award" }];
  const proposal = buildProposal({ version: 0, record: emptyRecord() }, x, { sourceId: SOURCE_A, label: "Resume A", targetRole: null }, NOW);
  const resolved = resolveDecisions(proposal, {}, emptyRecord());
  return applyProposal(emptyRecord(), resolved, { sourceId: SOURCE_A, label: "Resume A", newId: counter("m") }, null).record;
}

const base = () =>
  merged({ company: "Acme", title: "Engineer", start: "Jan 2020", end: "Dec 2021", bullets: ["Built the billing service", "Cut build times by 40%"] });

function edit(record: CareerRecord, op: EditOp) {
  const out = applyEdit(record, op, ctx());
  expect(CareerRecordSchema.safeParse(out.record).success).toBe(true);
  return out;
}

describe("wordings and facts", () => {
  it("edits a wording and marks it as the user's", () => {
    const r = base();
    const w = r.employers[0].roles[0].facts[0].wordings[0];
    const { record, note } = edit(r, { op: "editWording", wordingId: w.id, text: "Built and ran the billing service" });
    const got = record.employers[0].roles[0].facts[0].wordings[0];
    expect(got.text).toBe("Built and ran the billing service");
    expect(got.provenance.user).toEqual(["text"]);
    expect(got.sources).toEqual(w.sources);
    expect(note).toBe("Edited a wording at Acme");
    expect(r.employers[0].roles[0].facts[0].wordings[0].text).toBe("Built the billing service");
  });

  it("adds a wording to a fact, for a framing of the role", () => {
    const r = base();
    const fact = r.employers[0].roles[0].facts[0];
    const framingId = r.employers[0].roles[0].framings[0].id;
    const { record } = edit(r, { op: "addWording", factId: fact.id, text: "Owned billing", framingId });
    const added = record.employers[0].roles[0].facts[0].wordings[1];
    expect(added).toMatchObject({ text: "Owned billing", framingId, provenance: { origin: "user" } });
  });

  it("moves a wording to another fact, or makes it a fact of its own", () => {
    const r = base();
    const [a, b] = r.employers[0].roles[0].facts;
    const moved = edit(r, { op: "moveWording", wordingId: a.wordings[0].id, toFactId: b.id });
    expect(moved.record.employers[0].roles[0].facts).toHaveLength(1);
    expect(moved.record.employers[0].roles[0].facts[0].wordings).toHaveLength(2);

    const two = edit(moved.record, { op: "moveWording", wordingId: a.wordings[0].id, toFactId: null });
    expect(two.record.employers[0].roles[0].facts).toHaveLength(2);
  });

  it("refuses to move a wording into another role's fact", () => {
    const r = merged(
      { company: "Acme", title: "A", start: "Jan 2010", end: "Dec 2011", bullets: ["One"] },
      { company: "Acme", title: "B", start: "Jan 2015", end: "Dec 2016", bullets: ["Two"] },
    );
    const [r1, r2] = r.employers[0].roles;
    expect(() => applyEdit(r, { op: "moveWording", wordingId: r1.facts[0].wordings[0].id, toFactId: r2.facts[0].id }, ctx())).toThrow(EditError);
  });

  it("merges two facts, keeping every wording", () => {
    const r = base();
    const [a, b] = r.employers[0].roles[0].facts;
    const { record } = edit(r, { op: "mergeFacts", factId: a.id, intoFactId: b.id });
    const facts = record.employers[0].roles[0].facts;
    expect(facts).toHaveLength(1);
    expect(facts[0].wordings.map((w) => w.text).sort()).toEqual(["Built the billing service", "Cut build times by 40%"]);
  });

  it("adds a fact by hand", () => {
    const r = base();
    const { record } = edit(r, { op: "addFact", roleId: r.employers[0].roles[0].id, text: "Ran the on-call rota", framingId: null });
    const facts = record.employers[0].roles[0].facts;
    expect(facts).toHaveLength(3);
    expect(facts[2].provenance.origin).toBe("user");
  });

  it("deletes a wording and a fact, and leaves tombstones", () => {
    const r = base();
    const [a, b] = r.employers[0].roles[0].facts;
    const one = edit(r, { op: "deleteWording", wordingId: a.wordings[0].id });
    expect(one.record.employers[0].roles[0].facts).toHaveLength(1);
    expect(one.record.removed).toEqual([{ kind: "wording", key: "built the billing service", at: NOW.toISOString() }]);

    const two = edit(one.record, { op: "deleteFact", factId: b.id });
    expect(two.record.employers[0].roles[0].facts).toEqual([]);
    expect(two.record.removed.map((x) => x.key)).toContain("cut build times by 40");
  });

  it("does not add the same tombstone twice", () => {
    const r = merged(
      { company: "Acme", title: "A", start: "Jan 2010", end: "Dec 2011", bullets: ["Shipped the thing"] },
      { company: "Beta", title: "B", start: "Jan 2015", end: "Dec 2016", bullets: ["Shipped the thing."] },
    );
    const first = r.employers[0].roles[0].facts[0];
    const second = r.employers[1].roles[0].facts[0];
    const once = edit(r, { op: "deleteFact", factId: first.id }).record;
    const twice = edit(once, { op: "deleteFact", factId: second.id }).record;
    expect(twice.removed).toHaveLength(1);
  });

  it("reports ids that are gone", () => {
    expect(() => applyEdit(base(), { op: "editWording", wordingId: "nope", text: "x" }, ctx())).toThrow(/no longer in your record/);
  });
});

describe("roles and framings", () => {
  it("edits dates, which become the user's and clear old disagreements", () => {
    const r = base();
    r.employers[0].roles[0].dateNotes = ['"Resume B" says Mar 2020'];
    const { record } = edit(r, { op: "editRole", roleId: r.employers[0].roles[0].id, start: "Mar 2020", location: "Remote" });
    const role = record.employers[0].roles[0];
    expect(role).toMatchObject({ start: "Mar 2020", location: "Remote", dateNotes: [] });
    expect(role.provenance.user.sort()).toEqual(["location", "start"]);
  });

  it("a role that is current has no end", () => {
    const r = base();
    const { record } = edit(r, { op: "editRole", roleId: r.employers[0].roles[0].id, current: true });
    expect(record.employers[0].roles[0]).toMatchObject({ current: true, end: "" });
  });

  it("adds and edits a framing", () => {
    const r = base();
    const roleId = r.employers[0].roles[0].id;
    const added = edit(r, { op: "addFraming", roleId, title: "Tech Lead", angle: "Engineering" });
    const framing = added.record.employers[0].roles[0].framings[1];
    expect(framing).toMatchObject({ title: "Tech Lead", angle: "Engineering", provenance: { origin: "user" } });
    const edited = edit(added.record, { op: "editFraming", framingId: framing.id, angle: "Leadership" });
    expect(edited.record.employers[0].roles[0].framings[1]).toMatchObject({ angle: "Leadership" });
    expect(edited.record.employers[0].roles[0].framings[1].provenance.user).toEqual(["angle"]);
  });

  it("splits a framing, with its wordings, into a role of its own", () => {
    const r = base();
    const role = r.employers[0].roles[0];
    const withFraming = edit(r, { op: "addFraming", roleId: role.id, title: "Product Manager", angle: "Product" }).record;
    const pm = withFraming.employers[0].roles[0].framings[1];
    const fact = withFraming.employers[0].roles[0].facts[0];
    const withPm = edit(withFraming, { op: "addWording", factId: fact.id, text: "Led the billing roadmap", framingId: pm.id }).record;

    const { record } = edit(withPm, { op: "splitFraming", framingId: pm.id });
    const [eng, split] = record.employers[0].roles;
    expect(eng.framings.map((f) => f.title)).toEqual(["Engineer"]);
    expect(split.framings.map((f) => f.title)).toEqual(["Product Manager"]);
    expect(split).toMatchObject({ start: "Jan 2020", end: "Dec 2021" });
    expect(split.facts.map((f) => f.wordings[0].text)).toEqual(["Led the billing roadmap"]);
    expect(eng.facts.flatMap((f) => f.wordings).map((w) => w.text)).not.toContain("Led the billing roadmap");
    expect(eng.facts).toHaveLength(2);
  });

  it("will not split the only framing", () => {
    const r = base();
    expect(() => applyEdit(r, { op: "splitFraming", framingId: r.employers[0].roles[0].framings[0].id }, ctx())).toThrow(EditError);
  });

  it("merges two roles of one employer", () => {
    const r = merged(
      { company: "Acme", title: "Analyst", start: "Jan 2018", end: "Dec 2019", bullets: ["One"] },
      { company: "Acme", title: "Manager", start: "Jan 2020", end: "Dec 2021", bullets: ["Two"] },
    );
    const [a, b] = r.employers[0].roles;
    const { record } = edit(r, { op: "mergeRoles", roleId: a.id, intoRoleId: b.id });
    const roles = record.employers[0].roles;
    expect(roles).toHaveLength(1);
    expect(roles[0]).toMatchObject({ start: "Jan 2018", end: "Dec 2021" });
    expect(roles[0].framings.map((f) => f.title)).toEqual(["Manager", "Analyst"]);
    expect(roles[0].facts).toHaveLength(2);
  });

  it("keeps dates the user set when merging", () => {
    const r = merged(
      { company: "Acme", title: "Analyst", start: "Jan 2018", end: "Dec 2019", bullets: ["One"] },
      { company: "Acme", title: "Manager", start: "Jan 2020", end: "Dec 2021", bullets: ["Two"] },
    );
    const [a, b] = r.employers[0].roles;
    const owned = edit(r, { op: "editRole", roleId: b.id, start: "Feb 2020" }).record;
    const { record } = edit(owned, { op: "mergeRoles", roleId: a.id, intoRoleId: b.id });
    expect(record.employers[0].roles[0].start).toBe("Feb 2020");
  });

  it("deletes a role with tombstones for its title and wordings", () => {
    const r = base();
    const { record } = edit(r, { op: "deleteRole", roleId: r.employers[0].roles[0].id });
    expect(record.employers[0].roles).toEqual([]);
    expect(record.removed.map((x) => x.kind).sort()).toEqual(["role", "wording", "wording"]);
  });
});

describe("employers, skills and other items", () => {
  it("renames an employer and remembers the old spelling", () => {
    const r = base();
    const { record } = edit(r, { op: "editEmployer", employerId: r.employers[0].id, name: "Acme Corporation" });
    expect(record.employers[0]).toMatchObject({ name: "Acme Corporation", names: ["Acme", "Acme Corporation"] });
    expect(record.employers[0].provenance.user).toEqual(["name"]);
  });

  it("deletes an employer with everything under it", () => {
    const r = base();
    const { record } = edit(r, { op: "deleteEmployer", employerId: r.employers[0].id });
    expect(record.employers).toEqual([]);
    expect(record.removed.map((x) => x.kind)).toContain("employer");
  });

  it("adds, edits and deletes a skill", () => {
    const r = base();
    const added = edit(r, { op: "addSkill", name: "Rust", category: "Languages" });
    expect(added.record.skills.map((s) => s.name)).toEqual(["Go", "Rust"]);
    expect(() => applyEdit(added.record, { op: "addSkill", name: "rust", category: "" }, ctx())).toThrow(/already/);
    const id = added.record.skills[1].id;
    const edited = edit(added.record, { op: "editSkill", skillId: id, category: "Systems" });
    expect(edited.record.skills[1]).toMatchObject({ category: "Systems", provenance: { user: ["category"] } });
    const gone = edit(edited.record, { op: "deleteItem", kind: "skill", itemId: id });
    expect(gone.record.skills.map((s) => s.name)).toEqual(["Go"]);
    expect(gone.record.removed).toEqual([{ kind: "skill", key: "rust", at: NOW.toISOString() }]);
  });

  it("adds, edits and deletes an achievement", () => {
    const r = base();
    const added = edit(r, { op: "addAchievement", text: "Spoke at a conference" });
    const id = added.record.achievements[1].id;
    const edited = edit(added.record, { op: "editAchievement", achievementId: id, text: "Spoke at PyCon" });
    expect(edited.record.achievements[1].text).toBe("Spoke at PyCon");
    const gone = edit(edited.record, { op: "deleteItem", kind: "achievement", itemId: id });
    expect(gone.record.achievements).toHaveLength(1);
  });

  it("validates operations", () => {
    expect(EditOpSchema.safeParse({ op: "editWording", wordingId: "x", text: "   " }).success).toBe(false);
    expect(EditOpSchema.safeParse({ op: "bogus" }).success).toBe(false);
    expect(EditOpSchema.safeParse({ op: "deleteItem", kind: "employer", itemId: "x" }).success).toBe(false);
  });
});

describe("a later merge respects the edits", () => {
  const second = (text: string) => extractFromProfile(profileWith([{ company: "Acme", title: "Engineer", start: "Jan 2020", end: "Dec 2021", bullets: [text] }]));

  function mergeInto(record: CareerRecord, x: ReturnType<typeof second>, decisions = {}) {
    const proposal = buildProposal({ version: 2, record }, x, { sourceId: SOURCE_B, label: "Resume B", targetRole: null }, NOW);
    const resolved = resolveDecisions(proposal, decisions, record);
    return { proposal, ...applyProposal(record, resolved, { sourceId: SOURCE_B, label: "Resume B", newId: counter("z") }, null) };
  }

  it("never overwrites an edited wording", () => {
    const r = base();
    const w = r.employers[0].roles[0].facts[0].wordings[0];
    const edited = edit(r, { op: "editWording", wordingId: w.id, text: "Built and ran the billing service" }).record;
    const { record } = mergeInto(edited, second("Built the billing service"));
    const texts = record.employers[0].roles[0].facts.flatMap((f) => f.wordings.map((x) => x.text));
    expect(texts).toContain("Built and ran the billing service");
    expect(texts).toContain("Built the billing service");
  });

  it("proposes leaving out what was deleted, and respects an explicit include", () => {
    const r = base();
    const w = r.employers[0].roles[0].facts[0].wordings[0];
    const deleted = edit(r, { op: "deleteWording", wordingId: w.id }).record;

    const out = mergeInto(deleted, second("Built the billing service"));
    const bullet = out.proposal.employers[0].roles[0].bullets[0];
    expect(bullet.removedBefore).toBe(true);
    expect(out.record.employers[0].roles[0].facts.flatMap((f) => f.wordings.map((x) => x.text))).not.toContain("Built the billing service");

    const back = mergeInto(deleted, second("Built the billing service"), { [bullet.key]: { action: "accept" } });
    expect(back.record.employers[0].roles[0].facts.flatMap((f) => f.wordings.map((x) => x.text))).toContain("Built the billing service");
  });

  it("keeps the dates the user edited", () => {
    const r = base();
    const edited = edit(r, { op: "editRole", roleId: r.employers[0].roles[0].id, start: "Mar 2020" }).record;
    const { record } = mergeInto(edited, second("Cut build times by 40%"));
    expect(record.employers[0].roles[0].start).toBe("Mar 2020");
    expect(record.employers[0].roles[0].dateNotes).toEqual(['"Resume B" says Jan 2020 - Dec 2021']);
  });

  it("keeps a renamed employer", () => {
    const r = base();
    const renamed = edit(r, { op: "editEmployer", employerId: r.employers[0].id, name: "Acme Corporation" }).record;
    const { record } = mergeInto(renamed, second("Cut build times by 40%"));
    expect(record.employers[0].name).toBe("Acme Corporation");
    expect(record.employers).toHaveLength(1);
  });
});
