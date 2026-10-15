import { describe, expect, it } from "vitest";
import { recordToMarkdown } from "@/lib/career/markdown";
import { emptyRecord, type CareerRecord } from "@/lib/career/schema";

const tracked = { sources: [], provenance: { origin: "merge" as const, user: [] } };
const wording = (id: string, text: string, framingId: string | null = null, form: "bullet" | "paragraph" = "bullet") => ({ id, text, framingId, form, ...tracked });

function record(): CareerRecord {
  return {
    ...emptyRecord(),
    employers: [
      {
        id: "e1",
        name: "Acme",
        companyId: null,
        names: ["Acme"],
        ...tracked,
        roles: [
          {
            id: "r1",
            start: "Jan 2020",
            end: "",
            current: true,
            location: "Remote",
            dateNotes: ['Resume "Old" says Feb 2020'],
            ...tracked,
            framings: [
              { id: "fr1", title: "Backend Engineer", angle: "Engineering", targetRoles: ["Platform"], ...tracked },
              { id: "fr2", title: "Product Engineer", angle: "", targetRoles: [], ...tracked },
            ],
            facts: [
              {
                id: "f1",
                provenance: { origin: "merge", user: [] },
                wordings: [wording("w1", "Cut p95 latency by 40%", "fr1"), wording("w2", "Made the API faster")],
              },
              { id: "f2", provenance: { origin: "merge", user: [] }, wordings: [wording("w3", "Line one\nLine two", null, "paragraph")] },
            ],
          },
        ],
      },
    ],
    skills: [
      { id: "s1", name: "TypeScript", category: "Languages", ...tracked },
      { id: "s2", name: "Go", category: "Languages", ...tracked },
      { id: "s3", name: "Mentoring", category: "", ...tracked },
    ],
    education: [{ id: "ed1", institution: "State U", degree: "BSc", field: "CS", start: "2012", end: "2016", details: "", ...tracked }],
    certifications: [{ id: "c1", name: "CKA", issuer: "CNCF", date: "2023", ...tracked }],
    motivations: [{ id: "m1", text: "I like payments", scope: "company", companyId: null, companyName: "Stripe", ...tracked }],
    removed: [{ kind: "skill", key: "cobol", at: "2026-01-01" }],
  };
}

describe("recordToMarkdown", () => {
  const md = recordToMarkdown(record(), { version: 7, exportedOn: "2026-10-15" });

  it("starts with a title and the version", () => {
    expect(md.startsWith("# Career record\n\nExported 2026-10-15, version 7.\n")).toBe(true);
  });

  it("lists employer, role dates and every wording", () => {
    expect(md).toContain("### Acme");
    expect(md).toContain("#### Backend Engineer, Jan 2020 - Present");
    expect(md).toContain("Location: Remote");
    expect(md).toContain("- Cut p95 latency by 40% (Backend Engineer)");
    expect(md).toContain("  - Also worded: Made the API faster");
  });

  it("keeps framings, date notes and multi-line stories together", () => {
    expect(md).toContain("- Backend Engineer; angle: Engineering; target roles: Platform");
    expect(md).toContain("- Product Engineer");
    expect(md).toContain('Resume "Old" says Feb 2020');
    expect(md).toContain("- Line one\n  Line two (story)");
  });

  it("groups skills by category and writes the other sections", () => {
    expect(md).toContain("- Languages: TypeScript, Go");
    expect(md).toContain("- Mentoring");
    expect(md).toContain("- State U; BSc, CS; 2012 - 2016");
    expect(md).toContain("- CKA; CNCF; 2023");
    expect(md).toContain("- I like payments (Stripe)");
  });

  it("leaves out ids and removed items", () => {
    expect(md).not.toContain("cobol");
    expect(md).not.toMatch(/\bf1\b|\bw1\b/);
  });

  it("is just a title for an empty record", () => {
    expect(recordToMarkdown(emptyRecord(), { version: null, exportedOn: "2026-10-15" })).toBe("# Career record\n\nExported 2026-10-15.\n");
  });
});
