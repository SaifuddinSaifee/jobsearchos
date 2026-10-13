import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { applyProposal, checkRefs, resolveDecisions } from "@/lib/career/apply";
import { answerSchema, makeClassifier, readClasses } from "@/lib/career/cover";
import { roleChoices } from "@/lib/career/role-choices";
import { applyEdit } from "@/lib/career/edit";
import { extractCoverLetter } from "@/lib/career/extract";
import { buildProposal } from "@/lib/career/proposal";
import { classifyProposalParagraphs } from "@/lib/career/regroup";
import { ProposalSchema } from "@/lib/career/proposal-schema";
import { CareerRecordSchema, emptyRecord } from "@/lib/career/schema";
import { textToDoc } from "@/lib/documents/convert/text-to-doc";
import { counter, employer, fact, recordWith, role, SOURCE_A, SOURCE_B } from "./career-helpers";

const NOW = new Date(Date.UTC(2026, 9, 1));
const LETTER = [
  "Dear Hiring Manager,",
  "I am excited to apply for the Product Manager role at Globex, because your mission to make logistics simple is the reason I moved into supply chain software.",
  "At Acme I led the launch of self-serve onboarding, working with design and engineering to cut time to first value from two weeks to two days.",
  "I look forward to hearing from you and have attached my resume for your review.",
  "Sincerely,",
  "Jane",
].join("\n\n");

const globex = { id: "11111111-1111-4111-8111-111111111111", name: "Globex" };
const record = recordWith(
  employer("Acme", [role({ id: "r1", title: "Product Manager", facts: [fact("f1", [["w1", "Launched self-serve onboarding"]])] })], { id: "e1" }),
);

describe("extractCoverLetter", () => {
  it("keeps the paragraphs word for word and skips greetings and sign-offs", () => {
    const x = extractCoverLetter(textToDoc(LETTER, { mode: "letter" }));
    expect(x.paragraphs.map((p) => p.text.slice(0, 20))).toEqual(["I am excited to appl", "At Acme I led the la", "I look forward to he"]);
    expect(x.paragraphs[1].text).toBe(LETTER.split("\n\n")[2]);
    expect(x.roles).toEqual([]);
  });

  it("reads bullets of a letter as paragraphs", () => {
    const x = extractCoverLetter(textToDoc("Highlights from my time at Acme and elsewhere:\n\n- Led the launch of self-serve onboarding across three markets\n- Hired and managed a team of six product designers", { mode: "letter" }));
    expect(x.paragraphs.map((p) => p.text)).toEqual([
      "Highlights from my time at Acme and elsewhere:",
      "Led the launch of self-serve onboarding across three markets",
      "Hired and managed a team of six product designers",
    ]);
  });
});

describe("classifying paragraphs", () => {
  it("only allows the labels and aliases that were sent", () => {
    const schema = answerSchema(["p1", "p2"], ["r1"]);
    expect(schema.safeParse({ items: [{ paragraph: "p1", kind: "story", role: "r1" }] }).success).toBe(true);
    expect(schema.safeParse({ items: [{ paragraph: "p3", kind: "story", role: "none" }] }).success).toBe(false);
    expect(schema.safeParse({ items: [{ paragraph: "p1", kind: "essay", role: "none" }] }).success).toBe(false);
    expect(schema.safeParse({ items: [{ paragraph: "p1", kind: "story", role: "r9" }] }).success).toBe(false);
    expect(JSON.stringify(z.toJSONSchema(schema)).match(/"enum"/g)).toHaveLength(3);
  });

  const paragraphs = [
    { key: "a", text: "one" },
    { key: "b", text: "two" },
    { key: "c", text: "three" },
  ];
  const roles = [{ id: "role-x", label: "Acme: Product Manager, 2020 - 2021" }];

  it("reads the answer: a role only counts for a story, and what is missing is boilerplate", () => {
    const out = readClasses(
      [
        { paragraph: "p1", kind: "story", role: "r1" },
        { paragraph: "p2", kind: "motivation_general", role: "r1" },
        { paragraph: "p1", kind: "boilerplate", role: "none" },
      ],
      paragraphs,
      roles,
    );
    expect(out.get("a")).toEqual({ kind: "story", roleId: "role-x" });
    expect(out.get("b")).toEqual({ kind: "motivation_general", roleId: null });
    expect(out.get("c")).toEqual({ kind: "boilerplate", roleId: null });
  });

  it("sends aliases and the text, retries once, and fails with a message", async () => {
    const answer = { items: [{ paragraph: "p1", kind: "story", role: "r1" }] };
    const chat = vi.fn().mockRejectedValueOnce(new Error("bad json")).mockResolvedValueOnce(answer);
    const out = await makeClassifier(chat as never)(paragraphs, roles);
    expect(out.get("a")).toEqual({ kind: "story", roleId: "role-x" });
    expect(chat).toHaveBeenCalledTimes(2);
    const [, input] = chat.mock.calls[0];
    expect(input.user).toContain("r1: Acme: Product Manager, 2020 - 2021");
    expect(input.user).toContain('p2: "two"');
    expect(input.user).not.toContain("role-x");
    expect(input.system).toMatch(/never write or change any text/);

    const failing = vi.fn().mockRejectedValue(new Error("down"));
    await expect(makeClassifier(failing as never)(paragraphs, roles)).rejects.toThrow(/Could not read the cover letter.*down/);
  });

  it("lists the roles of the record, newest first", () => {
    const rec = recordWith(
      employer("Old Co", [role({ id: "old", title: "Analyst", start: "Jan 2010", end: "Dec 2011" })], { id: "e1" }),
      employer("New Co", [role({ id: "new", title: "Lead", start: "Jan 2022", end: "", current: true })], { id: "e2" }),
    );
    expect(roleChoices(rec).map((r) => r.id)).toEqual(["new", "old"]);
    expect(roleChoices(rec)[0].label).toBe("New Co: Lead, Jan 2022 - Present");
  });
});

describe("a cover letter in a proposal", () => {
  const build = (company: { id: string | null; name: string } | null = globex) =>
    buildProposal({ version: 1, record }, extractCoverLetter(textToDoc(LETTER, { mode: "letter" })), { sourceId: SOURCE_B, label: "Letter to Globex", targetRole: "Product Manager", company }, NOW);

  it("starts with every paragraph left out, until it has been read", () => {
    const p = build();
    expect(ProposalSchema.safeParse(p).success).toBe(true);
    expect(p.paragraphs).toHaveLength(3);
    expect(p.paragraphs.every((x) => x.suggestion.kind === "boilerplate")).toBe(true);
    const resolved = resolveDecisions(p, {}, record);
    expect(resolved.paragraphs.every((x) => !x.included)).toBe(true);
    expect(applyProposal(record, resolved, { sourceId: SOURCE_B, label: "L", newId: counter("n") }, null).record).toEqual(record);
  });

  async function classified(company: { id: string | null; name: string } | null = globex) {
    const p = build(company);
    const [why, story, bye] = p.paragraphs.map((x) => x.key);
    const classify = async () =>
      new Map([
        [why, { kind: "motivation_company" as const, roleId: null }],
        [story, { kind: "story" as const, roleId: "r1" }],
        [bye, { kind: "boilerplate" as const, roleId: null }],
      ]);
    const grouper = async (_r: unknown, stories: { key: string }[]) => new Map(stories.map((s) => [s.key, { factId: "f1", withKey: null }]));
    return { p: await classifyProposalParagraphs(p, record, classify, grouper), keys: { why, story, bye } };
  }

  it("takes the model's labels, and settles a story against the facts of its role", async () => {
    const { p } = await classified();
    expect(p.paragraphs.map((x) => x.suggestion)).toEqual([
      { kind: "motivation_company", roleId: null, factId: null },
      { kind: "story", roleId: "r1", factId: "f1" },
      { kind: "boilerplate", roleId: null, factId: null },
    ]);
  });

  it("makes a reason for this company a general one when the letter names no company", async () => {
    const { p } = await classified(null);
    expect(p.paragraphs[0].suggestion.kind).toBe("motivation_general");
  });

  it("drops a story whose role is not in the record", async () => {
    const p = build();
    const out = await classifyProposalParagraphs(
      p,
      record,
      async () => new Map([[p.paragraphs[1].key, { kind: "story" as const, roleId: "ghost" }]]),
      async () => new Map(),
    );
    expect(out.paragraphs[1].suggestion).toEqual({ kind: "story", roleId: null, factId: null });
  });

  it("applies stories as paragraph wordings and reasons as motivations, word for word", async () => {
    const { p } = await classified();
    const resolved = resolveDecisions(p, {}, record);
    expect(checkRefs(record, resolved)).toEqual([]);
    const { record: next, summary } = applyProposal(record, resolved, { sourceId: SOURCE_B, label: "Letter", newId: counter("n") }, "Product Manager");
    expect(CareerRecordSchema.safeParse(next).success).toBe(true);

    const story = next.employers[0].roles[0].facts[0].wordings[1];
    expect(story).toMatchObject({ form: "paragraph", text: LETTER.split("\n\n")[2], sources: [{ sourceId: SOURCE_B, blockId: null }] });
    expect(next.motivations).toEqual([
      expect.objectContaining({ text: LETTER.split("\n\n")[1], scope: "company", companyId: globex.id, companyName: "Globex" }),
    ]);
    expect(summary).toMatchObject({ storiesAdded: 1, otherItemsAdded: 1, factsAdded: 0 });
  });

  it("puts a story in a new fact when it repeats none", async () => {
    const p = build();
    const out = await classifyProposalParagraphs(
      p,
      record,
      async () => new Map([[p.paragraphs[1].key, { kind: "story" as const, roleId: "r1" }]]),
      async () => new Map(),
    );
    const { record: next, summary } = applyProposal(record, resolveDecisions(out, {}, record), { sourceId: SOURCE_B, label: "L", newId: counter("n") }, null);
    expect(next.employers[0].roles[0].facts).toHaveLength(2);
    expect(summary).toMatchObject({ storiesAdded: 1, factsAdded: 1 });
  });

  it("does not add the same story or reason twice", async () => {
    const { p } = await classified();
    const once = applyProposal(record, resolveDecisions(p, {}, record), { sourceId: SOURCE_B, label: "L", newId: counter("n") }, null).record;
    const again = applyProposal(once, resolveDecisions(p, {}, once), { sourceId: SOURCE_A, label: "L2", newId: counter("m") }, null);
    expect(again.record.motivations).toHaveLength(1);
    expect(again.record.motivations[0].sources.map((s) => s.sourceId)).toEqual([SOURCE_B, SOURCE_A]);
    expect(again.record.employers[0].roles[0].facts[0].wordings).toHaveLength(2);
    expect(again.summary.storiesAdded).toBe(0);
  });

  it("follows what the user chose for a paragraph", async () => {
    const { p, keys } = await classified();
    const decisions = {
      [keys.bye]: { action: "change" as const, paragraph: { kind: "motivation_general" as const, roleId: null, factId: null } },
      [keys.story]: { action: "change" as const, paragraph: { kind: "story" as const, roleId: "r1", factId: null } },
      [keys.why]: { action: "reject" as const },
    };
    const resolved = resolveDecisions(p, decisions, record);
    const { record: next } = applyProposal(record, resolved, { sourceId: SOURCE_B, label: "L", newId: counter("n") }, null);
    expect(next.motivations.map((m) => m.text)).toEqual([LETTER.split("\n\n")[3]]);
    expect(next.motivations[0]).toMatchObject({ scope: "general", companyId: null, companyName: "" });
    expect(next.employers[0].roles[0].facts).toHaveLength(2);
  });

  it("leaves out a story that has no role, and flags one whose role has gone", async () => {
    const { p, keys } = await classified();
    const noRole = resolveDecisions(p, { [keys.story]: { action: "change", paragraph: { kind: "story", roleId: null, factId: null } } }, record);
    expect(noRole.paragraphs.find((x) => x.item.key === keys.story)?.included).toBe(false);
    expect(checkRefs(emptyRecord(), resolveDecisions(p, {}, emptyRecord()))).toEqual(["r1"]);
  });

  it("proposes leaving out a reason the user deleted", async () => {
    const { p } = await classified();
    const once = applyProposal(record, resolveDecisions(p, {}, record), { sourceId: SOURCE_B, label: "L", newId: counter("n") }, null).record;
    const deleted = applyEdit(once, { op: "deleteItem", kind: "motivation", itemId: once.motivations[0].id }, { newId: counter("d"), now: NOW }).record;
    expect(deleted.motivations).toEqual([]);
    const again = buildProposal({ version: 3, record: deleted }, extractCoverLetter(textToDoc(LETTER, { mode: "letter" })), { sourceId: SOURCE_A, label: "L", targetRole: null, company: globex }, NOW);
    expect(again.paragraphs[0].removedBefore).toBe(true);
    expect(again.paragraphs[1].removedBefore).toBe(false);
  });
});
