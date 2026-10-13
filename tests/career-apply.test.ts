import { describe, expect, it } from "vitest";
import { applyProposal, checkRefs, resolveDecisions } from "@/lib/career/apply";
import { extractFromProfile, type SourceExtract } from "@/lib/career/extract";
import { assertTextFromSource, buildProposal } from "@/lib/career/proposal";
import { ProposalSchema, type Decisions } from "@/lib/career/proposal-schema";
import { CareerRecordSchema, emptyRecord, type CareerRecord } from "@/lib/career/schema";
import { counter, profileWith, SOURCE_A, SOURCE_B } from "./career-helpers";

const NOW = new Date(Date.UTC(2026, 9, 1));
const newId = counter("id");

type Merge = { record: CareerRecord; version: number };

/** One review round: build the proposal against `from`, apply it with `decisions`, return the next record. */
function merge(
  from: Merge,
  extract: SourceExtract,
  opts: { sourceId?: string; label?: string; targetRole?: string | null; decisions?: Decisions } = {},
) {
  const sourceId = opts.sourceId ?? SOURCE_A;
  const proposal = buildProposal(
    { version: from.version, record: from.record },
    extract,
    { sourceId, label: opts.label ?? "Resume A", targetRole: opts.targetRole ?? null },
    NOW,
  );
  expect(ProposalSchema.safeParse(proposal).success).toBe(true);
  const resolved = resolveDecisions(proposal, opts.decisions ?? {}, from.record);
  expect(checkRefs(from.record, resolved)).toEqual([]);
  const { record, summary } = applyProposal(from.record, resolved, { sourceId, label: opts.label ?? "Resume A", newId }, opts.targetRole ?? null);
  expect(CareerRecordSchema.safeParse(record).success).toBe(true);
  return { next: { record, version: from.version + 1 }, proposal, resolved, summary };
}

const empty: Merge = { record: emptyRecord(), version: 0 };

const engineer = () =>
  extractFromProfile(
    profileWith([
      { company: "Acme", title: "Software Engineer", location: "Pune", start: "Jan 2020", end: "Dec 2021", bullets: ["Built the billing service", "Cut build times by 40%"] },
    ]),
  );

const pm = () =>
  extractFromProfile(
    profileWith([
      { company: "Acme Inc.", title: "Product Manager", start: "Jan 2020", end: "Dec 2021", bullets: ["Launched self-serve onboarding", "Cut build times by 40%"] },
    ]),
  );

describe("building a record from nothing", () => {
  it("proposes everything as new and applies it", () => {
    const x = engineer();
    x.skills = [{ blockId: null, category: "Languages", name: "Go" }];
    x.education = [{ blockId: null, institution: "State U", degree: "BSc", field: "", start: "", end: "", details: "" }];
    x.achievements = [{ blockId: null, text: "Won an award" }];
    const { next, proposal, summary } = merge(empty, x);

    expect(proposal.employers[0]).toMatchObject({ name: "Acme", suggestion: { to: "new" } });
    expect(proposal.employers[0].roles[0].suggestion).toEqual({ to: "new" });
    expect(summary).toMatchObject({ employersAdded: 1, rolesAdded: 1, framingsAdded: 1, factsAdded: 2, wordingsAdded: 2 });

    const [acme] = next.record.employers;
    expect(acme.names).toEqual(["Acme"]);
    expect(acme.roles[0]).toMatchObject({ start: "Jan 2020", end: "Dec 2021", location: "Pune" });
    expect(acme.roles[0].framings[0]).toMatchObject({ title: "Software Engineer", angle: "Engineering" });
    expect(acme.roles[0].facts.map((f) => f.wordings[0].text)).toEqual(["Built the billing service", "Cut build times by 40%"]);
    expect(acme.roles[0].facts[0].wordings[0].framingId).toBe(acme.roles[0].framings[0].id);
    expect(next.record.skills[0]).toMatchObject({ name: "Go", category: "Languages" });
    expect(next.record.education[0].institution).toBe("State U");
    expect(next.record.achievements[0].text).toBe("Won an award");
  });

  it("records where each thing came from", () => {
    const { next } = merge(empty, engineer(), { sourceId: SOURCE_A });
    const role = next.record.employers[0].roles[0];
    expect(role.sources).toEqual([{ sourceId: SOURCE_A, blockId: null }]);
    expect(role.facts[0].wordings[0].sources).toEqual([{ sourceId: SOURCE_A, blockId: null }]);
  });
});

describe("a second resume for the same job", () => {
  it("is proposed as a framing, and applied as one role with two framings sharing facts", () => {
    const first = merge(empty, engineer()).next;
    const second = merge(first, pm(), { sourceId: SOURCE_B, label: "Resume B", targetRole: "Product Manager" });

    const role = second.proposal.employers[0].roles[0];
    expect(second.proposal.employers[0].suggestion).toMatchObject({ to: "existing" });
    expect(role.suggestion).toMatchObject({ to: "framing" });
    // The shared bullet is already known, the other one is new.
    expect(role.bullets[1].suggestion).toMatchObject({ to: "known" });
    expect(role.bullets[0].suggestion).toEqual({ to: "new" });

    const acme = second.next.record.employers;
    expect(acme).toHaveLength(1);
    // "Acme Inc." is the same employer once normalized, so it adds no new spelling.
    expect(acme[0].names).toEqual(["Acme"]);
    expect(acme[0].roles).toHaveLength(1);
    const r = acme[0].roles[0];
    expect(r.framings.map((f) => [f.title, f.angle])).toEqual([["Software Engineer", "Engineering"], ["Product Manager", "Product"]]);
    expect(r.framings[1].targetRoles).toEqual(["Product Manager"]);
    expect(r.facts).toHaveLength(3);
    const shared = r.facts.find((f) => f.wordings.some((w) => w.text === "Cut build times by 40%"))!;
    expect(shared.wordings).toHaveLength(1);
    expect(shared.wordings[0].sources.map((s) => s.sourceId).sort()).toEqual([SOURCE_A, SOURCE_B]);
    expect(second.summary).toMatchObject({ rolesAdded: 0, framingsAdded: 1, factsAdded: 1, alreadyKnown: 1 });
  });

  it("applies the angle the user typed", () => {
    const first = merge(empty, engineer()).next;
    const proposal = buildProposal({ version: 1, record: first.record }, pm(), { sourceId: SOURCE_B, label: "B", targetRole: null }, NOW);
    const key = proposal.employers[0].roles[0].key;
    const { next } = merge(first, pm(), { sourceId: SOURCE_B, decisions: { [key]: { action: "accept", angle: "Growth" } } });
    expect(next.record.employers[0].roles[0].framings[1].angle).toBe("Growth");
  });

  it("keeps it a separate role when the user changes the suggestion", () => {
    const first = merge(empty, engineer()).next;
    const proposal = buildProposal({ version: 1, record: first.record }, pm(), { sourceId: SOURCE_B, label: "B", targetRole: null }, NOW);
    const roleItem = proposal.employers[0].roles[0];
    const { next, resolved, summary } = merge(first, pm(), {
      sourceId: SOURCE_B,
      decisions: { [roleItem.key]: { action: "change", role: { to: "new" } } },
    });
    expect(next.record.employers[0].roles).toHaveLength(2);
    expect(summary.rolesAdded).toBe(1);
    // Bullets that pointed at the old role's facts can no longer do so.
    expect(resolved.employers[0].roles[0].bullets.map((b) => b.target.to)).toEqual(["new", "new"]);
    expect(summary.factsAdded).toBe(2);
  });
});

describe("employers under another name", () => {
  it("joins the employer the user picks and remembers the spelling", () => {
    const first = merge(empty, engineer()).next;
    const x = extractFromProfile(profileWith([{ company: "Acme Labs", title: "Software Engineer", bullets: ["Built the billing service"] }]));
    const proposal = buildProposal({ version: 1, record: first.record }, x, { sourceId: SOURCE_B, label: "B", targetRole: null }, NOW);
    expect(proposal.employers[0].suggestion).toEqual({ to: "new" });
    const { next } = merge(first, x, {
      sourceId: SOURCE_B,
      decisions: { [proposal.employers[0].key]: { action: "change", employer: { to: "existing", employerId: first.record.employers[0].id } } },
    });
    expect(next.record.employers).toHaveLength(1);
    expect(next.record.employers[0].names).toEqual(["Acme", "Acme Labs"]);
    // The second source now matches by the remembered spelling.
    const again = buildProposal({ version: 2, record: next.record }, x, { sourceId: SOURCE_B, label: "B", targetRole: null }, NOW);
    expect(again.employers[0].suggestion).toMatchObject({ to: "existing" });
  });

  it("makes a role new when its employer is changed to a new one", () => {
    const first = merge(empty, engineer()).next;
    const proposal = buildProposal({ version: 1, record: first.record }, engineer(), { sourceId: SOURCE_B, label: "B", targetRole: null }, NOW);
    expect(proposal.employers[0].roles[0].suggestion).toMatchObject({ to: "same" });
    const resolved = resolveDecisions(proposal, { [proposal.employers[0].key]: { action: "change", employer: { to: "new" } } }, first.record);
    expect(resolved.employers[0].roles[0].target).toEqual({ to: "new" });
    expect(resolved.employers[0].roles[0].bullets.every((b) => b.target.to === "new")).toBe(true);
  });
});

describe("applying twice", () => {
  it("never adds the same wording again", () => {
    const first = merge(empty, engineer()).next;
    const again = merge(first, engineer(), { sourceId: SOURCE_B, label: "Copy" });
    expect(again.summary).toMatchObject({ rolesAdded: 0, factsAdded: 0, wordingsAdded: 0, alreadyKnown: 2 });
    const facts = again.next.record.employers[0].roles[0].facts;
    expect(facts.every((f) => f.wordings.length === 1)).toBe(true);
    expect(facts[0].wordings[0].sources).toHaveLength(2);
  });

  it("does not duplicate when the same proposal text arrives in one pass", () => {
    const x = engineer();
    x.roles[0].bullets.push({ blockId: null, text: "Built the billing service" });
    const { next } = merge(empty, x);
    expect(next.record.employers[0].roles[0].facts).toHaveLength(2);
  });

  it("reuses one employer when two of its roles are in the same source", () => {
    const x = extractFromProfile(
      profileWith([
        { company: "Acme", title: "Analyst", start: "Jan 2018", end: "Dec 2019", bullets: ["A"] },
        { company: "Acme", title: "Manager", start: "Jan 2020", end: "Dec 2021", bullets: ["B"] },
      ]),
    );
    const { proposal, next } = merge(empty, x);
    expect(proposal.employers).toHaveLength(1);
    expect(next.record.employers).toHaveLength(1);
    expect(next.record.employers[0].roles).toHaveLength(2);
  });
});

describe("your edits win", () => {
  it("keeps dates the user set and adds a note instead", () => {
    const first = merge(empty, engineer()).next;
    const edited = structuredClone(first.record);
    const role = edited.employers[0].roles[0];
    role.start = "Mar 2020";
    role.provenance = { origin: "user", user: ["start"] };

    const x = engineer();
    x.roles[0].start = "Jan 2020";
    const { next, proposal } = merge({ record: edited, version: 2 }, x, { sourceId: SOURCE_B, label: "Resume B" });
    const got = next.record.employers[0].roles[0];
    expect(got.start).toBe("Mar 2020");
    expect(got.dateNotes).toEqual(['"Resume B" says Jan 2020 - Dec 2021']);
    expect(proposal.employers[0].roles[0].dateNote).toContain("Your record has Mar 2020");
  });

  it("widens dates it owns and notes a precise disagreement without blocking", () => {
    const first = merge(empty, engineer()).next;
    const x = engineer();
    x.roles[0].start = "Mar 2019";
    x.roles[0].end = "Jun 2021";
    x.roles[0].datesText = "Mar 2019 - Jun 2021";
    const { next } = merge(first, x, { sourceId: SOURCE_B, label: "Resume B" });
    const role = next.record.employers[0].roles[0];
    expect(role).toMatchObject({ start: "Mar 2019", end: "Dec 2021" });
    expect(role.dateNotes).toEqual(['"Resume B" says Mar 2019 - Jun 2021']);
  });

  it("never rewrites an existing wording", () => {
    const first = merge(empty, engineer()).next;
    const before = JSON.stringify(first.record.employers[0].roles[0].facts.map((f) => f.wordings.map((w) => w.text)));
    const x = engineer();
    x.roles[0].bullets[0].text = "built the billing service!";
    const { next } = merge(first, x, { sourceId: SOURCE_B });
    const texts = next.record.employers[0].roles[0].facts.map((f) => f.wordings.map((w) => w.text));
    expect(JSON.stringify(texts.map((t) => t.slice(0, 1)))).toBe(before);
    expect(texts[0]).toEqual(["Built the billing service", "built the billing service!"]);
  });

  it("leaves a linked company alone once the user set it", () => {
    const first = merge(empty, engineer()).next;
    const edited = structuredClone(first.record);
    edited.employers[0].provenance = { origin: "user", user: ["companyId"] };
    const cid = "11111111-1111-4111-8111-111111111111";
    const proposal = buildProposal({ version: 2, record: edited }, engineer(), { sourceId: SOURCE_B, label: "B", targetRole: null }, NOW, new Map([["acme", cid]]));
    expect(proposal.employers[0].companyId).toBe(cid);
    const resolved = resolveDecisions(proposal, {}, edited);
    const { record } = applyProposal(edited, resolved, { sourceId: SOURCE_B, label: "B", newId }, null);
    expect(record.employers[0].companyId).toBeNull();
  });
});

describe("tombstones and rejections", () => {
  it("starts a removed wording left out, and leaves it out of the record", () => {
    const first = merge(empty, engineer()).next;
    const edited = structuredClone(first.record);
    edited.employers[0].roles[0].facts.splice(0, 1);
    edited.removed.push({ kind: "wording", key: "built the billing service", at: "2026-01-01" });

    const x = engineer();
    const { proposal, resolved, next } = merge({ record: edited, version: 2 }, x, { sourceId: SOURCE_B });
    expect(proposal.employers[0].roles[0].bullets[0].removedBefore).toBe(true);
    expect(resolved.employers[0].roles[0].bullets[0].included).toBe(false);
    const texts = next.record.employers[0].roles[0].facts.flatMap((f) => f.wordings.map((w) => w.text));
    expect(texts).not.toContain("Built the billing service");
  });

  it("brings a removed item back when the user accepts it", () => {
    const first = merge(empty, engineer()).next;
    const edited = structuredClone(first.record);
    edited.employers[0].roles[0].facts.splice(0, 1);
    edited.removed.push({ kind: "wording", key: "built the billing service", at: "2026-01-01" });
    const proposal = buildProposal({ version: 2, record: edited }, engineer(), { sourceId: SOURCE_B, label: "B", targetRole: null }, NOW);
    const key = proposal.employers[0].roles[0].bullets[0].key;
    const { next } = merge({ record: edited, version: 2 }, engineer(), { sourceId: SOURCE_B, decisions: { [key]: { action: "accept" } } });
    const texts = next.record.employers[0].roles[0].facts.flatMap((f) => f.wordings.map((w) => w.text));
    expect(texts).toContain("Built the billing service");
  });

  it("adds nothing for a rejected employer", () => {
    const proposal = buildProposal({ version: 0, record: emptyRecord() }, engineer(), { sourceId: SOURCE_A, label: "A", targetRole: null }, NOW);
    const { next } = merge(empty, engineer(), { decisions: { [proposal.employers[0].key]: { action: "reject" } } });
    expect(next.record.employers).toEqual([]);
  });

  it("adds nothing for a rejected bullet or skill", () => {
    const x = engineer();
    x.skills = [{ blockId: null, category: "Languages", name: "Go" }];
    const proposal = buildProposal({ version: 0, record: emptyRecord() }, x, { sourceId: SOURCE_A, label: "A", targetRole: null }, NOW);
    const { next } = merge(empty, x, {
      decisions: {
        [proposal.employers[0].roles[0].bullets[0].key]: { action: "reject" },
        [proposal.skills[0].key]: { action: "reject" },
      },
    });
    expect(next.record.employers[0].roles[0].facts).toHaveLength(1);
    expect(next.record.skills).toEqual([]);
  });
});

describe("moving a bullet between facts", () => {
  it("adds the wording to the fact the user picked", () => {
    const first = merge(empty, engineer()).next;
    const factId = first.record.employers[0].roles[0].facts[0].id;
    const x = engineer();
    x.roles[0].bullets = [{ blockId: null, text: "Owned the billing platform end to end" }];
    const proposal = buildProposal({ version: 1, record: first.record }, x, { sourceId: SOURCE_B, label: "B", targetRole: null }, NOW);
    const key = proposal.employers[0].roles[0].bullets[0].key;
    const { next } = merge(first, x, {
      sourceId: SOURCE_B,
      decisions: { [key]: { action: "change", bullet: { to: "fact", factId, why: "model" } } },
    });
    const facts = next.record.employers[0].roles[0].facts;
    expect(facts).toHaveLength(2);
    expect(facts[0].wordings.map((w) => w.text)).toEqual(["Built the billing service", "Owned the billing platform end to end"]);
  });
});

describe("stale proposals", () => {
  it("reports ids that the record no longer has", () => {
    const first = merge(empty, engineer()).next;
    const proposal = buildProposal({ version: 1, record: first.record }, pm(), { sourceId: SOURCE_B, label: "B", targetRole: null }, NOW);
    const resolved = resolveDecisions(proposal, {}, first.record);
    expect(checkRefs(first.record, resolved)).toEqual([]);
    const missing = checkRefs(emptyRecord(), resolved);
    expect(missing).toContain(first.record.employers[0].id);
  });

  it("reports a fact that was deleted while the role is still there", () => {
    const first = merge(empty, engineer()).next;
    const proposal = buildProposal({ version: 1, record: first.record }, pm(), { sourceId: SOURCE_B, label: "B", targetRole: null }, NOW);
    const resolved = resolveDecisions(proposal, {}, first.record);
    const edited = structuredClone(first.record);
    const gone = edited.employers[0].roles[0].facts.pop()!;
    expect(checkRefs(edited, resolved)).toEqual([gone.id]);
  });

  it("ignores missing ids on items that are left out", () => {
    const first = merge(empty, engineer()).next;
    const proposal = buildProposal({ version: 1, record: first.record }, pm(), { sourceId: SOURCE_B, label: "B", targetRole: null }, NOW);
    const resolved = resolveDecisions(proposal, { [proposal.employers[0].key]: { action: "reject" } }, first.record);
    expect(checkRefs(emptyRecord(), resolved)).toEqual([]);
  });
});

describe("the text guard", () => {
  it("throws when a proposal holds text that is not in the source", () => {
    const x = engineer();
    const proposal = buildProposal({ version: 0, record: emptyRecord() }, x, { sourceId: SOURCE_A, label: "A", targetRole: null }, NOW);
    proposal.employers[0].roles[0].bullets[0].text = "Built the billing service, and more";
    expect(() => assertTextFromSource(proposal, x)).toThrow(/not from the source/);
  });

  it("passes for text that is word for word in the source", () => {
    const x = engineer();
    const proposal = buildProposal({ version: 0, record: emptyRecord() }, x, { sourceId: SOURCE_A, label: "A", targetRole: null }, NOW);
    expect(() => assertTextFromSource(proposal, x)).not.toThrow();
  });
});

describe("warnings and keys", () => {
  it("warns about dates that cannot be read and roles without a company", () => {
    const x = extractFromProfile(profileWith([{ company: "", title: "Wizard", start: "once upon a time", end: "" }]));
    const proposal = buildProposal({ version: 0, record: emptyRecord() }, x, { sourceId: SOURCE_A, label: "A", targetRole: null }, NOW);
    expect(proposal.warnings.join("\n")).toMatch(/no company/);
    expect(proposal.warnings.join("\n")).toMatch(/Dates could not be read/);
    expect(proposal.employers[0].name).toBe("Unknown employer");
    expect(proposal.employers[0].roles[0].datesReadable).toBe(false);
  });

  it("gives every item a unique key that stays the same when the source is read again", () => {
    const x = engineer();
    x.roles[0].bullets.push({ blockId: null, text: "Built the billing service" });
    const a = buildProposal({ version: 0, record: emptyRecord() }, x, { sourceId: SOURCE_A, label: "A", targetRole: null }, NOW);
    const b = buildProposal({ version: 0, record: emptyRecord() }, x, { sourceId: SOURCE_A, label: "A", targetRole: null }, NOW);
    const keys = (p: typeof a) => p.employers.flatMap((e) => [e.key, ...e.roles.flatMap((r) => [r.key, ...r.bullets.map((bb) => bb.key)])]);
    expect(keys(a)).toEqual(keys(b));
    expect(new Set(keys(a)).size).toBe(keys(a).length);
  });
});
