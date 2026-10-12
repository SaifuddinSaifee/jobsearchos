import { describe, expect, it } from "vitest";
import { emptyProfile } from "@/lib/profile/schema";
import { chunkProfile, chunkText } from "@/lib/resume/chunk";

describe("chunkProfile", () => {
  it("makes one piece per job, keeping its bullets with its title and company", () => {
    const p = emptyProfile();
    p.summary = "Backend engineer.";
    p.experience = [
      { company: "Acme", title: "Staff Engineer", location: "Remote", start: "2021", end: "", current: true, bullets: ["Cut p95 latency by 40%", "Led a team of 5"] },
      { company: "Globex", title: "Engineer", location: "", start: "2018", end: "2021", current: false, bullets: ["Built the billing service"] },
    ];
    p.skills = [{ category: "Languages", items: ["Go", "TypeScript"] }];
    p.technologies = ["Postgres"];
    const chunks = chunkProfile(p);

    expect(chunks.map((c) => c.section)).toEqual(["summary", "experience", "experience", "skills"]);
    const acme = chunks[1];
    expect(acme.label).toBe("Staff Engineer at Acme");
    expect(acme.text).toContain("2021 to Present");
    expect(acme.text).toContain("- Cut p95 latency by 40%");
    expect(acme.text).toContain("- Led a team of 5");
    expect(chunks[3].text).toContain("Languages: Go, TypeScript");
    expect(chunks[3].text).toContain("Technologies: Postgres");
  });

  it("skips empty sections and keeps projects, education and certifications", () => {
    const p = emptyProfile();
    p.projects = [{ name: "Tiny DB", description: "A key-value store", technologies: ["Rust"], bullets: ["Wrote the WAL"], url: "" }];
    p.education = [{ institution: "State U", degree: "BSc", field: "Computer Science", start: "2014", end: "2018", details: "" }];
    p.certifications = [{ name: "CKA", issuer: "CNCF", date: "2022" }];
    const chunks = chunkProfile(p);
    expect(chunks.map((c) => c.section)).toEqual(["projects", "education", "certifications"]);
    expect(chunks[1].label).toBe("BSc in Computer Science, State U");
    expect(chunkProfile(emptyProfile())).toEqual([]);
  });

  it("splits a very long job into numbered parts that each stay under the limit", () => {
    const p = emptyProfile();
    p.experience = [{ company: "Acme", title: "Eng", location: "", start: "", end: "", current: false, bullets: Array.from({ length: 80 }, (_, i) => `Shipped feature number ${i} with a long enough description to add up`) }];
    const chunks = chunkProfile(p);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.text.length <= 1800)).toBe(true);
    expect(chunks[0].label).toBe("Eng at Acme (part 1)");
    expect(chunks.map((c) => c.text).join("\n")).toContain("feature number 79");
  });
});

describe("chunkText", () => {
  it("packs paragraphs together and labels each piece by its first words", () => {
    const chunks = chunkText("Jane Doe\nSenior engineer\n\nWorked at Acme on payments.\n\nWorked at Globex on billing.");
    expect(chunks).toHaveLength(1);
    expect(chunks[0].section).toBe("text");
    expect(chunks[0].label.startsWith("Jane Doe")).toBe(true);
  });

  it("starts a new piece when the next paragraph would overflow", () => {
    const para = "x".repeat(1000);
    expect(chunkText(`${para}\n\n${para}\n\n${para}`)).toHaveLength(3);
  });

  it("returns nothing for empty text", () => {
    expect(chunkText("  \n\n ")).toEqual([]);
  });
});
