import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { applyProposal, resolveDecisions } from "@/lib/career/apply";
import { extractFromProfile } from "@/lib/career/extract";
import { answerSchema, FACTS_PER_BULLET, factsToShow, makeGrouper, MAX_FACTS_SHOWN, readAnswer } from "@/lib/career/group";
import { buildProposal } from "@/lib/career/proposal";
import { groupProposal, groupRoleBullets } from "@/lib/career/regroup";
import { emptyRecord } from "@/lib/career/schema";
import { counter, employer, fact, profileWith, recordWith, role, SOURCE_A, SOURCE_B } from "./career-helpers";

const NOW = new Date(Date.UTC(2026, 9, 1));
type Chat = Parameters<typeof makeGrouper>[0];

/** A chat stub that answers with the given groups, and keeps what it was asked. */
function chatReturning(...answers: unknown[]) {
  const fn = vi.fn();
  for (const a of answers) {
    if (a instanceof Error) fn.mockRejectedValueOnce(a);
    else fn.mockResolvedValueOnce(a);
  }
  return fn as unknown as Chat & ReturnType<typeof vi.fn>;
}

const billing = role({
  facts: [
    fact("f1", [["w1", "Built the billing service"]]),
    fact("f2", [["w2", "Cut build times by 40%"]]),
  ],
});
const bullets = [
  { key: "k1", text: "Designed and shipped the billing platform" },
  { key: "k2", text: "Reduced CI duration by forty percent" },
  { key: "k3", text: "Organised the team offsite" },
];

describe("the answer schema", () => {
  it("only allows the aliases that were sent, so the model cannot return text", () => {
    const schema = answerSchema(["f1", "f2"], ["b1", "b2"]);
    expect(schema.safeParse({ groups: [{ bullet: "b1", fact: "f2", sameAs: "none" }] }).success).toBe(true);
    expect(schema.safeParse({ groups: [{ bullet: "b1", fact: "new", sameAs: "b2" }] }).success).toBe(true);
    expect(schema.safeParse({ groups: [{ bullet: "b9", fact: "f1", sameAs: "none" }] }).success).toBe(false);
    expect(schema.safeParse({ groups: [{ bullet: "b1", fact: "f7", sameAs: "none" }] }).success).toBe(false);
    expect(schema.safeParse({ groups: [{ bullet: "b1", fact: "Built the billing service", sameAs: "none" }] }).success).toBe(false);
    // Every field of the JSON schema is an enum, so there is no free text anywhere.
    const json = JSON.stringify(z.toJSONSchema(schema));
    expect(json).not.toContain('"type":"string"}');
    expect(json.match(/"enum"/g)).toHaveLength(3);
  });
});

describe("readAnswer", () => {
  const facts = billing.facts;
  it("maps aliases back to ids", () => {
    const out = readAnswer(
      [
        { bullet: "b1", fact: "f1", sameAs: "none" },
        { bullet: "b2", fact: "f2", sameAs: "none" },
        { bullet: "b3", fact: "new", sameAs: "none" },
      ],
      bullets,
      facts,
    );
    expect(out.get("k1")).toEqual({ factId: "f1", withKey: null });
    expect(out.get("k2")).toEqual({ factId: "f2", withKey: null });
    expect(out.get("k3")).toEqual({ factId: null, withKey: null });
  });

  it("makes bullets the model skipped new facts, and uses the first answer for a bullet it repeated", () => {
    const out = readAnswer(
      [
        { bullet: "b1", fact: "f1", sameAs: "none" },
        { bullet: "b1", fact: "f2", sameAs: "none" },
      ],
      bullets,
      facts,
    );
    expect(out.get("k1")?.factId).toBe("f1");
    expect(out.get("k2")).toEqual({ factId: null, withKey: null });
    expect(out.get("k3")).toEqual({ factId: null, withKey: null });
  });

  it("joins bullets that repeat each other, and follows them to an existing fact", () => {
    const out = readAnswer(
      [
        { bullet: "b1", fact: "new", sameAs: "none" },
        { bullet: "b2", fact: "new", sameAs: "b1" },
        { bullet: "b3", fact: "new", sameAs: "b2" },
      ],
      bullets,
      facts,
    );
    expect(out.get("k1")).toEqual({ factId: null, withKey: null });
    expect(out.get("k2")).toEqual({ factId: null, withKey: "k1" });
    expect(out.get("k3")).toEqual({ factId: null, withKey: "k1" });

    const toExisting = readAnswer(
      [
        { bullet: "b1", fact: "f1", sameAs: "none" },
        { bullet: "b2", fact: "new", sameAs: "b1" },
      ],
      bullets,
      facts,
    );
    expect(toExisting.get("k2")).toEqual({ factId: "f1", withKey: null });
  });

  it("survives a loop and a bullet that points at itself", () => {
    const out = readAnswer(
      [
        { bullet: "b1", fact: "new", sameAs: "b2" },
        { bullet: "b2", fact: "new", sameAs: "b1" },
        { bullet: "b3", fact: "new", sameAs: "b3" },
      ],
      bullets,
      facts,
    );
    expect(out.get("k3")).toEqual({ factId: null, withKey: null });
    expect(out.get("k1")).toBeDefined();
    expect(out.get("k2")).toBeDefined();
  });
});

describe("the grouper", () => {
  it("sends aliases and wordings, never ids, and reads the answer", async () => {
    const chat = chatReturning({
      groups: [
        { bullet: "b1", fact: "f1", sameAs: "none" },
        { bullet: "b2", fact: "f2", sameAs: "none" },
        { bullet: "b3", fact: "new", sameAs: "none" },
      ],
    });
    const out = await makeGrouper(chat)(billing, bullets);
    expect(out.get("k1")?.factId).toBe("f1");
    const [, input] = chat.mock.calls[0];
    expect(input.user).toContain('f1: "Built the billing service"');
    expect(input.user).toContain('b2: "Reduced CI duration by forty percent"');
    expect(input.user).not.toMatch(/\bk1\b/);
    expect(input.system).toMatch(/never write or change any text/);
  });

  it("retries once, then fails with a message", async () => {
    const ok = { groups: [{ bullet: "b1", fact: "f1", sameAs: "none" }] };
    const chat = chatReturning(new Error("bad json"), ok);
    expect((await makeGrouper(chat)(billing, bullets)).get("k1")?.factId).toBe("f1");
    expect(chat).toHaveBeenCalledTimes(2);

    const failing = chatReturning(new Error("one"), new Error("two"));
    await expect(makeGrouper(failing)(billing, bullets)).rejects.toThrow(/Could not group bullets.*two/);
  });

  it("does not call the model for a lone bullet in a role with no facts", async () => {
    const chat = chatReturning();
    const out = await makeGrouper(chat)(role({ facts: [] }), [bullets[0]]);
    expect(out.size).toBe(0);
    expect(chat).not.toHaveBeenCalled();
  });

  it("can group new bullets with each other when the role has no facts", async () => {
    const chat = chatReturning({
      groups: [
        { bullet: "b1", fact: "new", sameAs: "none" },
        { bullet: "b2", fact: "new", sameAs: "b1" },
      ],
    });
    const out = await makeGrouper(chat)(role({ facts: [] }), bullets.slice(0, 2));
    expect(out.get("k2")).toEqual({ factId: null, withKey: "k1" });
  });

  it("shows a big role only the facts closest to the new bullets", () => {
    const many = role({
      facts: Array.from({ length: MAX_FACTS_SHOWN + 40 }, (_, i) => fact(`f${i}`, [[`w${i}`, `Unrelated accomplishment number ${i} about gardening`]])),
    });
    many.facts.push(fact("target", [["wt", "Built the billing service for invoices"]]));
    const shown = factsToShow(many, [{ key: "k", text: "Designed the billing service for invoices" }]);
    expect(shown.length).toBeLessThanOrEqual(FACTS_PER_BULLET);
    expect(shown.some((f) => f.id === "target")).toBe(true);
    expect(factsToShow(billing, bullets)).toBe(billing.facts);
  });
});

describe("grouping a proposal", () => {
  const record = recordWith(employer("Acme", [billing], { id: "emp1" }));
  const incoming = () =>
    extractFromProfile(
      profileWith([{ company: "Acme", title: "Engineer", start: "Jan 2020", end: "Dec 2021", bullets: ["Built the billing service", ...bullets.map((b) => b.text)] }]),
    );
  const proposalFor = () => buildProposal({ version: 1, record }, incoming(), { sourceId: SOURCE_B, label: "B", targetRole: null }, NOW);

  it("leaves exact matches to the exact rules and sends only the rest to the model", async () => {
    const grouper = vi.fn(async (_r, open: { key: string; text: string }[]) => new Map(open.map((b) => [b.key, { factId: null, withKey: null }])));
    await groupProposal(proposalFor(), record, grouper);
    expect(grouper).toHaveBeenCalledOnce();
    expect(grouper.mock.calls[0][1].map((b) => b.text)).toEqual(bullets.map((b) => b.text));
  });

  it("puts the model's answers into the suggestions", async () => {
    const p = proposalFor();
    const [k1, k2, k3] = p.employers[0].roles[0].bullets.slice(1).map((b) => b.key);
    const grouper = async () =>
      new Map([
        [k1, { factId: "f1", withKey: null }],
        [k2, { factId: null, withKey: k3 }],
      ]);
    const grouped = await groupProposal(p, record, grouper);
    const out = grouped.employers[0].roles[0].bullets;
    expect(out[0].suggestion).toMatchObject({ to: "known", factId: "f1" });
    expect(out[1].suggestion).toEqual({ to: "fact", factId: "f1", why: "model" });
    expect(out[2].suggestion).toEqual({ to: "new", withKey: k3 });
    expect(out[3].suggestion).toEqual({ to: "new" });
  });

  it("does not call the model for a new role", async () => {
    const grouper = vi.fn();
    await groupProposal(
      buildProposal({ version: 0, record: emptyRecord() }, incoming(), { sourceId: SOURCE_B, label: "B", targetRole: null }, NOW),
      emptyRecord(),
      grouper,
    );
    expect(grouper).not.toHaveBeenCalled();
  });

  it("settles a role against another role of the record on request", async () => {
    const other = role({ id: "role2", facts: [fact("g1", [["x1", "Designed and shipped the billing platform"]])] });
    const p = proposalFor();
    const item = p.employers[0].roles[0];
    const bulletsOut = await groupRoleBullets(item, other, async () => new Map());
    expect(bulletsOut[1].suggestion).toMatchObject({ to: "known", factId: "g1" });
    expect(bulletsOut[0].suggestion).toEqual({ to: "new" });
  });
});

describe("bullets that join a new fact", () => {
  it("become one fact with both wordings, and follow their root when it is left out", () => {
    const x = extractFromProfile(profileWith([{ company: "Acme", bullets: ["Shipped billing", "Delivered the billing system"] }]));
    const proposal = buildProposal({ version: 0, record: emptyRecord() }, x, { sourceId: SOURCE_A, label: "A", targetRole: null }, NOW);
    const [b1, b2] = proposal.employers[0].roles[0].bullets;
    b2.suggestion = { to: "new", withKey: b1.key };

    const joined = applyProposal(emptyRecord(), resolveDecisions(proposal, {}, emptyRecord()), { sourceId: SOURCE_A, label: "A", newId: counter("n") }, null);
    expect(joined.record.employers[0].roles[0].facts).toHaveLength(1);
    expect(joined.record.employers[0].roles[0].facts[0].wordings.map((w) => w.text)).toEqual(["Shipped billing", "Delivered the billing system"]);
    expect(joined.summary).toMatchObject({ factsAdded: 1, wordingsAdded: 2 });

    // With the root left out, the dependent becomes a plain new fact.
    const resolved = resolveDecisions(proposal, { [b1.key]: { action: "reject" } }, emptyRecord());
    expect(resolved.employers[0].roles[0].bullets[1].target).toEqual({ to: "new" });
    const alone = applyProposal(emptyRecord(), resolved, { sourceId: SOURCE_A, label: "A", newId: counter("n") }, null);
    expect(alone.record.employers[0].roles[0].facts.map((f) => f.wordings[0].text)).toEqual(["Delivered the billing system"]);
  });

  it("join the existing fact when their root was placed on one", () => {
    const record = recordWith(employer("Acme", [billing], { id: "emp1" }));
    const x = extractFromProfile(profileWith([{ company: "Acme", title: "Engineer", bullets: ["Shipped billing", "Delivered the billing system"] }]));
    const proposal = buildProposal({ version: 1, record }, x, { sourceId: SOURCE_B, label: "B", targetRole: null }, NOW);
    const [b1, b2] = proposal.employers[0].roles[0].bullets;
    b1.suggestion = { to: "fact", factId: "f1", why: "model" };
    b2.suggestion = { to: "new", withKey: b1.key };
    const resolved = resolveDecisions(proposal, {}, record);
    expect(resolved.employers[0].roles[0].bullets[1].target).toMatchObject({ to: "fact", factId: "f1" });
    const out = applyProposal(record, resolved, { sourceId: SOURCE_B, label: "B", newId: counter("n") }, null);
    expect(out.record.employers[0].roles[0].facts[0].wordings.map((w) => w.text)).toEqual(["Built the billing service", "Shipped billing", "Delivered the billing system"]);
  });
});
