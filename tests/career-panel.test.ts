import { describe, expect, it } from "vitest";
import { findPanelRole, type PanelQuery } from "@/lib/career/panel";
import { mergeProvenance } from "@/lib/career/schema";
import { employer, fact, recordWith, role, SOURCE_A, SOURCE_B } from "./career-helpers";

const NOW = new Date(Date.UTC(2026, 9, 1));

const acme = role({
  id: "r1",
  title: "Software Engineer",
  start: "Jan 2020",
  end: "Dec 2021",
  facts: [
    fact("f1", [["w1", "Built the billing service"]]),
    fact("f2", [["w2", "Launched self-serve onboarding"]]),
  ],
});
acme.framings.push({ id: "fr2", title: "Product Manager", angle: "Product", targetRoles: [], sources: [{ sourceId: SOURCE_B, blockId: "pm-role" }], provenance: mergeProvenance() });
acme.facts[0].wordings[0].framingId = "fr1";
acme.facts[1].wordings[0].framingId = "fr2";
acme.facts[1].wordings[0].sources = [{ sourceId: SOURCE_B, blockId: "pm-bullet" }];
acme.sources = [
  { sourceId: SOURCE_A, blockId: "eng-role" },
  { sourceId: SOURCE_B, blockId: "pm-role" },
];
const record = recordWith(employer("Acme", [acme], { id: "e1" }), employer("Beta", [role({ id: "r2", title: "Analyst", start: "Jan 2015", end: "Dec 2016" })], { id: "e2" }));

const q = (over: Partial<PanelQuery> = {}): PanelQuery => ({ documentSourceIds: [], roleBlockId: null, company: "Acme", title: "Software Engineer", dates: "Jan 2020 - Dec 2021", ...over });

describe("finding the role under the cursor", () => {
  it("matches the exact block a document was read from", () => {
    const out = findPanelRole(record, q({ documentSourceIds: [SOURCE_B], roleBlockId: "pm-role", company: "Someone else", title: "Product Manager" }), NOW)!;
    expect(out).toMatchObject({ roleId: "r1", how: "block", employer: "Acme", matchedFramingId: "fr2", title: "Product Manager" });
  });

  it("ignores a block id that belongs to another document", () => {
    expect(findPanelRole(record, q({ documentSourceIds: ["other"], roleBlockId: "pm-role", company: "Nobody" }), NOW)).toBeNull();
  });

  it("falls back to employer, title and dates", () => {
    const out = findPanelRole(record, q(), NOW)!;
    expect(out).toMatchObject({ roleId: "r1", how: "text", matchedFramingId: "fr1", title: "Software Engineer", dates: "Jan 2020 - Dec 2021" });
  });

  it("finds the role by another spelling of the employer", () => {
    expect(findPanelRole(record, q({ company: "ACME Inc.", title: "Software Engineer" }), NOW)).toMatchObject({ roleId: "r1", matchedFramingId: "fr1" });
  });

  it("matches a title with an abbreviation", () => {
    expect(findPanelRole(record, q({ title: "Software Eng" }), NOW)).toMatchObject({ roleId: "r1", matchedFramingId: "fr1" });
  });

  it("finds the role when the title is new but the period is the same, with no framing matched", () => {
    const out = findPanelRole(record, q({ title: "Platform Lead" }), NOW)!;
    expect(out).toMatchObject({ roleId: "r1", matchedFramingId: null });
    expect(out.facts.flatMap((f) => f.wordings).every((w) => w.fits)).toBe(true);
  });

  it("is null for an employer or a period the record does not have", () => {
    expect(findPanelRole(record, q({ company: "Globex" }), NOW)).toBeNull();
    expect(findPanelRole(record, q({ title: "" }), NOW)).toBeNull();
    expect(findPanelRole(record, q({ title: "Engineer", dates: "Jan 2010 - Dec 2011" }), NOW)).toBeNull();
  });

  it("puts the wordings that fit the framing first and marks the others", () => {
    const eng = findPanelRole(record, q(), NOW)!;
    expect(eng.facts.map((f) => f.id)).toEqual(["f1", "f2"]);
    expect(eng.facts.flatMap((f) => f.wordings).map((w) => [w.id, w.fits])).toEqual([["w1", true], ["w2", false]]);

    const pm = findPanelRole(record, q({ title: "Product Manager" }), NOW)!;
    expect(pm.facts.map((f) => f.id)).toEqual(["f2", "f1"]);
    expect(pm.facts[0].wordings[0]).toMatchObject({ id: "w2", fits: true, framing: "Product" });
    expect(pm.facts[1].wordings[0]).toMatchObject({ id: "w1", fits: false, framing: "Engineering" });
  });

  it("does not name framings for a role that has only one", () => {
    const only = recordWith(employer("Beta", [role({ id: "r2", title: "Analyst", start: "Jan 2015", end: "Dec 2016", facts: [fact("g", [["x", "Did a thing"]])] })], { id: "e2" }));
    const out = findPanelRole(only, q({ company: "Beta", title: "Analyst", dates: "Jan 2015 - Dec 2016" }), NOW)!;
    expect(out.facts[0].wordings[0].framing).toBe("");
  });

  it("carries stories as paragraph wordings", () => {
    const withStory = structuredClone(record);
    withStory.employers[0].roles[0].facts[0].wordings.push({ id: "s1", text: "A story", framingId: null, form: "paragraph", sources: [], provenance: mergeProvenance() });
    const out = findPanelRole(withStory, q(), NOW)!;
    expect(out.facts[0].wordings[1]).toMatchObject({ id: "s1", form: "paragraph", fits: true });
  });
});
