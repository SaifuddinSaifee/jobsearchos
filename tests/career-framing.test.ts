import { describe, expect, it } from "vitest";
import { wordingFitsFraming, wordingsForFraming } from "@/lib/career/framing";
import { mergeProvenance } from "@/lib/career/schema";
import { fact, role, SOURCE_A, SOURCE_B } from "./career-helpers";

describe("wordings for a framing", () => {
  const r = role({
    facts: [
      fact("f1", [["w1", "Built the billing service", ["b1"]]]),
      fact("f2", [["w2", "Cut build times by 40%", ["b2"]]]),
      fact("f3", [["w3", "Launched onboarding", ["b3"]]]),
    ],
  });
  // First framing was told by source A; the second (Product) by source B.
  r.framings.push({ id: "fr2", title: "Product Manager", angle: "Product", targetRoles: [], sources: [{ sourceId: SOURCE_B, blockId: null }], provenance: mergeProvenance() });
  r.framings[0].sources = [{ sourceId: SOURCE_A, blockId: null }];
  r.facts[0].wordings[0].framingId = "fr1";
  r.facts[1].wordings[0].framingId = "fr1";
  r.facts[2].wordings[0].framingId = "fr2";
  r.facts[2].wordings[0].sources = [{ sourceId: SOURCE_B, blockId: "b3" }];

  it("includes what was written for the framing", () => {
    expect(wordingsForFraming(r, "fr1").map((w) => w.id)).toEqual(["w1", "w2"]);
  });

  it("also includes a wording that a source of the framing used", () => {
    r.facts[1].wordings[0].sources.push({ sourceId: SOURCE_B, blockId: "x" });
    expect(wordingsForFraming(r, "fr2").map((w) => w.id)).toEqual(["w2", "w3"]);
  });

  it("lets a wording with no framing fit every framing", () => {
    const loose = { ...r.facts[0].wordings[0], framingId: null, sources: [] };
    expect(wordingFitsFraming(r, loose, "fr1")).toBe(true);
    expect(wordingFitsFraming(r, loose, "fr2")).toBe(true);
  });

  it("is false for a framing the role does not have", () => {
    expect(wordingFitsFraming(r, r.facts[0].wordings[0], "gone")).toBe(false);
  });
});
