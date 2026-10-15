import { describe, expect, it, vi } from "vitest";

process.env.DATABASE_URL ??= "postgres://unused";
vi.mock("@/lib/llm/openai", () => ({ chatClient: () => ({}) }));

import { docToProfile } from "@/lib/documents/convert/doc-to-profile";
import { plainText } from "@/lib/documents/read";
import { buildResumeDoc, resumeToProfile } from "@/lib/resume-writer/build";
import { planWriting, readWriting, type WriterAnswer, type WrittenResume } from "@/lib/resume-writer/write";
import { job, record, withMap } from "./resume-writer-helpers";
import { counter } from "./career-helpers";

const contact = { name: "Sam Example", email: "sam@example.com", phone: "", location: "Remote", links: [] };

const answer: WriterAnswer = {
  summary: "Product manager who shipped billing to thousands of merchants.",
  roles: [
    {
      role: "e1",
      bullets: [
        { facts: ["f1"], text: "Launched self-serve billing for 2,000 merchants" },
        { facts: ["f2"], text: "Cut build times by 40% across the platform team" },
        { facts: ["f3"], text: "Mentored four junior engineers into senior roles" },
      ],
    },
    { role: "e2", bullets: [{ facts: ["f4"], text: "Built reporting tools in SQL for the finance team" }] },
  ],
  projects: [{ project: "p1", bullets: [{ text: "Designed a double-entry ledger with SQL" }] }],
  skills: [{ category: "Data", items: ["s1"] }],
  certifications: ["c1"],
};

const written = (): WrittenResume => readWriting(answer, planWriting(record(), job, withMap([{ verdict: "met", refs: ["fact1"] }, { verdict: "met", refs: ["fact4"] }, {}])));

describe("buildResumeDoc", () => {
  const { doc, bulletFacts } = buildResumeDoc(written(), contact, counter("b"));
  const profile = docToProfile(doc);

  it("lays out the header, the record's own roles and dates, and the written bullets", () => {
    expect(profile.contact.name).toBe("Sam Example");
    expect(profile.summary).toContain("Product manager");
    expect(profile.experience.map((e) => [e.company, e.title, e.start, e.current])).toEqual([
      ["Acme", "Product Manager", "Jan 2021", true],
      ["Initech", "Engineer", "Jun 2018", false],
    ]);
    expect(profile.experience[0].bullets).toEqual([
      "Launched self-serve billing for 2,000 merchants",
      "Cut build times by 40% across the platform team",
      "Mentored four junior engineers into senior roles",
    ]);
    expect(profile.projects[0].name).toBe("Ledger toy");
    expect(profile.education[0].institution).toBe("State University");
    expect(profile.certifications[0].name).toContain("AWS Solutions Architect");
    expect(profile.skills).toEqual([{ category: "Data", items: ["SQL"] }]);
  });

  it("remembers the facts each bullet was written from, by block id", () => {
    const ids = Object.keys(bulletFacts);
    expect(ids).toHaveLength(5);
    const experience = (doc.content ?? []).find((n) => n.type === "section" && n.attrs?.kind === "experience")!;
    const first = experience.content!.find((n) => n.type === "role")!.content!.find((n) => n.type === "bulletList")!.content![0];
    expect(plainText(first)).toBe("Launched self-serve billing for 2,000 merchants");
    expect(bulletFacts[first.attrs!.id as string]).toEqual(["fact1"]);
    expect(Object.values(bulletFacts)).toContainEqual(["proj1"]);
  });

  it("marks what the user asked for", () => {
    const w = written();
    w.roles[0].bullets[0] = { ...w.roles[0].bullets[0], userRequirementIds: ["r1"] };
    const { bulletFacts: facts } = buildResumeDoc(w, contact, counter("c"));
    expect(Object.values(facts)).toContainEqual(["fact1", "req:r1"]);
  });

  it("is the same profile whatever the ids", () => {
    expect(resumeToProfile(written(), contact).experience[1].bullets).toEqual(["Built reporting tools in SQL for the finance team"]);
  });
});
