import { describe, expect, it } from "vitest";
import { matchEmployer, matchRole, guessAngle } from "@/lib/career/match";
import { classifyBullet, isRemoved, removalKey } from "@/lib/career/dedupe";
import { normalizeEmployer, normalizeTitle, titleSimilarity } from "@/lib/career/normalize";
import { emptyRecord } from "@/lib/career/schema";
import { employer, fact, role } from "./career-helpers";

const NOW = new Date(Date.UTC(2026, 9, 1));
const q = (title: string, start: string, end: string, current = false) => ({ title, start, end, current });

describe("matchEmployer", () => {
  const acme = employer("Acme Inc.", [], { id: "e1", names: ["Acme Inc.", "ACME Labs"] });
  it("matches ignoring case, punctuation and company suffixes", () => {
    expect(matchEmployer([acme], "acme", null)?.id).toBe("e1");
    expect(matchEmployer([acme], "ACME, LLC", null)?.id).toBe("e1");
  });
  it("matches google llc with google", () => {
    const g = employer("Google", [], { id: "g" });
    expect(matchEmployer([g], "Google LLC", null)?.id).toBe("g");
  });
  it("matches any spelling seen before", () => {
    expect(matchEmployer([acme], "Acme Labs", null)?.id).toBe("e1");
  });
  it("matches a linked company by id even when the name differs", () => {
    const cid = "11111111-1111-4111-8111-111111111111";
    const linked = employer("Alphabet", [], { id: "a", companyId: cid });
    expect(matchEmployer([linked], "Google", cid)?.id).toBe("a");
  });
  it("is null for a new employer or an empty name", () => {
    expect(matchEmployer([acme], "Beta", null)).toBeNull();
    expect(matchEmployer([acme], "  ", null)).toBeNull();
  });
});

describe("normalizing titles", () => {
  it("spells out abbreviations", () => {
    expect(normalizeTitle("Sr. PM")).toBe("senior product manager");
    expect(titleSimilarity("Sr. Software Engineer", "Senior Software Engineer")).toBe(1);
  });
  it("normalizes employer names like the companies directory", () => {
    expect(normalizeEmployer("Foo & Bar, Inc.")).toBe(normalizeEmployer("foo and bar"));
  });
});

describe("matchRole", () => {
  const acme = employer("Acme", [role({ id: "r1", title: "Product Manager", start: "Jan 2020", end: "Dec 2021" })]);

  it("is a new role when the employer is new", () => {
    expect(matchRole(null, q("PM", "2020", "2021"), NOW).match).toEqual({ kind: "new", note: null });
  });

  it("is the same role for the same title and dates", () => {
    const { match } = matchRole(acme, q("Product Manager", "Feb 2020", "Nov 2021"), NOW);
    expect(match).toMatchObject({ kind: "same", role: { id: "r1" }, framing: { id: "fr1" } });
  });

  it("treats a title written with an abbreviation as the same", () => {
    expect(matchRole(acme, q("PM", "Jan 2020", "Dec 2021"), NOW).match.kind).toBe("same");
  });

  it("proposes a framing for another title in the same period", () => {
    const { match } = matchRole(acme, q("Software Engineer", "Jan 2020", "Dec 2021"), NOW);
    expect(match).toMatchObject({ kind: "framing", role: { id: "r1" } });
  });

  it("keeps a promotion with a one month overlap as a new role", () => {
    const { match } = matchRole(acme, q("Senior Product Manager", "Dec 2021", "Dec 2023"), NOW);
    expect(match.kind).toBe("new");
    expect(match).toMatchObject({ note: expect.stringContaining("overlap slightly") });
  });

  it("treats a boomerang return under the same title as a new role", () => {
    const { match } = matchRole(acme, q("Product Manager", "Jan 2024", "", true), NOW);
    expect(match.kind).toBe("new");
  });

  it("needs more than a coincidence for fuzzy years", () => {
    const e = employer("Acme", [role({ id: "r1", title: "Analyst", start: "2018", end: "2020" })]);
    // 2020 ends in December in a bare year, so a role starting mid 2020 overlaps by a few months only.
    expect(matchRole(e, q("Engineer", "Oct 2020", "2022"), NOW).match.kind).toBe("new");
  });

  it("matches a role with unreadable dates only on the same title", () => {
    expect(matchRole(acme, q("Product Manager", "sometime", ""), NOW).match.kind).toBe("same");
    expect(matchRole(acme, q("Software Engineer", "sometime", ""), NOW).match.kind).toBe("new");
  });

  it("matches an open role against a role that is still going", () => {
    const open = employer("Acme", [role({ id: "r2", title: "Engineer", start: "Jan 2022", end: "", current: true })]);
    expect(matchRole(open, q("Engineer", "Mar 2022", "", true), NOW).match.kind).toBe("same");
    expect(matchRole(open, q("Designer", "Mar 2022", "", true), NOW).match.kind).toBe("framing");
  });

  it("lists every role as a candidate, closest in time first", () => {
    const e = employer("Acme", [
      role({ id: "old", title: "A", start: "Jan 2010", end: "Dec 2011" }),
      role({ id: "near", title: "B", start: "Jan 2020", end: "Dec 2021" }),
    ]);
    expect(matchRole(e, q("C", "Jan 2020", "Dec 2021"), NOW).candidates.map((r) => r.id)).toEqual(["near", "old"]);
  });
});

describe("guessAngle", () => {
  it.each([
    ["Senior Product Manager", "Product"],
    ["Software Engineer", "Engineering"],
    ["Product Designer", "Design"],
    ["Data Analyst", "Data"],
    ["Growth Marketer", "Marketing"],
    ["Account Executive", "Sales"],
    ["Technical Program Manager", "Program"],
    ["Wizard", ""],
  ])("%s is %s", (title, angle) => {
    expect(guessAngle(title)).toBe(angle);
  });
});

describe("classifyBullet", () => {
  const r = role({
    facts: [
      fact("f1", [["w1", "Led the launch of self-serve onboarding", ["b1"]]]),
      fact("f2", [["w2", "Reduced churn by 12%", ["b2"]]]),
    ],
  });

  it("is new for a new role", () => {
    expect(classifyBullet(null, { blockId: null, text: "x" })).toEqual({ to: "new" });
  });
  it("knows exact text", () => {
    expect(classifyBullet(r, { blockId: null, text: "  Reduced churn by 12%  " })).toEqual({ to: "known", factId: "f2", wordingId: "w2" });
  });
  it("treats case and punctuation differences as the same fact with a new wording", () => {
    expect(classifyBullet(r, { blockId: null, text: "reduced churn by 12" })).toEqual({ to: "fact", factId: "f2", why: "near" });
  });
  it("links an edited copy of the same editor block", () => {
    const got = classifyBullet(r, { blockId: "b1", text: "Led launch of self-serve onboarding flow" });
    expect(got).toEqual({ to: "fact", factId: "f1", why: "lineage" });
  });
  it("does not link a reused block id whose text is unrelated", () => {
    expect(classifyBullet(r, { blockId: "b1", text: "Managed a team of nine engineers" })).toEqual({ to: "new" });
  });
  it("is new for text it has not seen", () => {
    expect(classifyBullet(r, { blockId: "zz", text: "Negotiated vendor contracts" })).toEqual({ to: "new" });
  });
});

describe("tombstones", () => {
  it("finds what the user removed by its normalized key", () => {
    const rec = { ...emptyRecord(), removed: [{ kind: "wording" as const, key: removalKey.wording("Did a thing."), at: "2026-01-01" }] };
    expect(isRemoved(rec, "wording", removalKey.wording("did a THING"))).toBe(true);
    expect(isRemoved(rec, "wording", removalKey.wording("Other"))).toBe(false);
    expect(isRemoved(rec, "skill", removalKey.skill("Did a thing"))).toBe(false);
  });
});
