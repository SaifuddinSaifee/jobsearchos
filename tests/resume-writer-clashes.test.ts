import { describe, expect, it } from "vitest";
import { findClashes, measuresIn, wordingsConflict } from "@/lib/resume-writer/clashes";
import { fact, role } from "./career-helpers";
import { framing } from "./resume-writer-helpers";

/** A fact whose wordings each belong to a telling of the role. */
const told = (id: string, wordings: [string, string, string][]) => {
  const f = fact(id, wordings.map(([wid, text]) => [wid, text]));
  return { ...f, wordings: f.wordings.map((w, i) => ({ ...w, framingId: wordings[i][2] })) };
};

describe("numbers the record disagrees on", () => {
  it("reads what a number measures from the words before it", () => {
    const [m] = measuresIn("Increased user activation by 45% by owning onboarding");
    expect(m.value).toBe("45");
    expect([...m.measure]).toEqual(expect.arrayContaining(["user", "activation"]));
  });

  it("finds two lines that give different numbers for the same thing", () => {
    expect(wordingsConflict("Increased user activation by 45%", "Boosted feature activation rate by 18%")).toBe(true);
    expect(wordingsConflict("Increased user activation by 45%", "Raised activation 45% after a redesign")).toBe(false);
    // A line that leaves the number out is not a disagreement.
    expect(wordingsConflict("Increased user activation by 45%", "Led the onboarding redesign that lifted activation")).toBe(false);
    // Different things measured are not a disagreement either.
    expect(wordingsConflict("Cut onboarding time by 60%", "Grew adoption by 30%")).toBe(false);
    // Counts are not results: two documents rounding an audience differently is not worth asking about.
    expect(wordingsConflict("Presented to 1,000+ developers", "Presented to 800 developers")).toBe(false);
    // The same result told at more length is not a disagreement.
    expect(wordingsConflict("Increased activation by 45% and discovery by 60%", "Increased activation by 45%")).toBe(false);
  });

  it("recommends the number most versions of the line give, and says why", () => {
    const r = role({
      id: "roleA",
      framings: [framing("fEng", "Fullstack Software Developer", "Engineering"), framing("fPm", "Product Manager", "Product")],
      facts: [
        told("act", [
          ["w1", "Increased user activation by 45% by owning the onboarding redesign", "fEng"],
          ["w2", "Increased user activation by 45%, cutting time-to-value", "fEng"],
          ["w3", "Translated findings into a redesign that boosted feature activation rate by 18%", "fPm"],
        ]),
        told("plain", [["p1", "Built admin panels with RBAC", "fEng"], ["p2", "Owned admin panels and RBAC", "fPm"]]),
      ],
    });
    const [clash, ...rest] = findClashes([{ employer: "Louper", role: r, framingId: "fPm" }]);
    expect(rest).toEqual([]);
    expect(clash).toMatchObject({ factId: "act", where: "Louper", measure: "activation", recommended: "w1" });
    expect(clash.options.map((o) => [o.wordingId, o.count])).toEqual([
      ["w1", 2],
      ["w3", 1],
    ]);
    expect(clash.reason).toBe("2 of your 3 versions of this line say it this way.");
  });

  it("breaks a tie toward the telling the resume uses", () => {
    const r = role({
      framings: [framing("fEng", "Engineer", "Engineering"), framing("fPm", "Product Manager", "Product")],
      facts: [told("t", [["a", "Cut query time by 66.7%", "fPm"], ["b", "Cut query time by 33%", "fEng"]])],
    });
    expect(findClashes([{ employer: "Psylief", role: r, framingId: "fEng" }])[0].recommended).toBe("b");
    expect(findClashes([{ employer: "Psylief", role: r, framingId: "fPm" }])[0].recommended).toBe("a");
  });
});
