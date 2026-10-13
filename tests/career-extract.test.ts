import { describe, expect, it } from "vitest";
import { emptyProfile } from "@/lib/profile/schema";
import { profileToDoc } from "@/lib/documents/convert/profile-to-doc";
import { extractFromDoc, extractFromProfile } from "@/lib/career/extract";
import type { DocJSON } from "@/lib/documents/build";
import { counter, profileWith } from "./career-helpers";

function find(n: DocJSON, type: string): DocJSON {
  if (n.type === type) return n;
  for (const c of n.content ?? []) {
    const hit = (c.type === type ? c : null) ?? findOrNull(c, type);
    if (hit) return hit;
  }
  throw new Error(`no ${type}`);
}
function findOrNull(n: DocJSON, type: string): DocJSON | null {
  try {
    return find(n, type);
  } catch {
    return null;
  }
}

function resume() {
  const p = profileWith([
    { company: "Acme", title: "Product Manager", location: "Pune", start: "Jan 2020", end: "Dec 2021", bullets: ["Launched onboarding", "Cut churn by 12%"] },
    { company: "Beta", title: "Engineer", start: "Jan 2022", end: "", current: true, bullets: ["Built the API"] },
  ]);
  p.skills = [{ category: "Languages", items: ["TypeScript", "Go"] }];
  p.technologies = ["Postgres"];
  p.projects = [{ name: "Tool", description: "A thing", technologies: ["Rust"], bullets: ["Shipped v1"], url: "https://example.com" }];
  p.education = [{ institution: "State U", degree: "BSc in Physics", field: "", start: "2012", end: "2016", details: "" }];
  p.achievements = ["Won an award"];
  return p;
}

describe("extractFromDoc", () => {
  it("keeps the block ids of roles, bullets, projects and skills lines", () => {
    const doc = profileToDoc(resume(), counter("id"));
    const x = extractFromDoc(doc);

    expect(x.roles).toHaveLength(2);
    const [pm, eng] = x.roles;
    expect(pm).toMatchObject({ title: "Product Manager", company: "Acme", location: "Pune", start: "Jan 2020", end: "Dec 2021", current: false });
    expect(pm.blockId).toMatch(/^id\d+$/);
    expect(pm.bullets.map((b) => b.text)).toEqual(["Launched onboarding", "Cut churn by 12%"]);
    expect(pm.bullets.every((b) => b.blockId && b.blockId !== pm.blockId)).toBe(true);
    expect(new Set(pm.bullets.map((b) => b.blockId)).size).toBe(2);
    expect(eng).toMatchObject({ current: true, end: "" });

    expect(x.projects[0]).toMatchObject({ name: "Tool", url: "https://example.com", technologies: ["Rust"] });
    expect(x.projects[0].bullets[0]).toMatchObject({ text: "Shipped v1" });
    expect(x.projects[0].blockId).toBeTruthy();
  });

  it("splits skills lines into skills that share the line's block id", () => {
    const x = extractFromDoc(profileToDoc(resume(), counter("id")));
    const ts = x.skills.find((s) => s.name === "TypeScript")!;
    const go = x.skills.find((s) => s.name === "Go")!;
    expect(ts.category).toBe("Languages");
    expect(ts.blockId).toBeTruthy();
    expect(ts.blockId).toBe(go.blockId);
  });

  it("reads a technologies line as skills in the Technologies category", () => {
    const p = profileWith([]);
    p.technologies = ["Postgres", "Redis"];
    const x = extractFromDoc(profileToDoc(p, counter("id")));
    expect(x.skills.map((s) => [s.category, s.name])).toEqual([["Technologies", "Postgres"], ["Technologies", "Redis"]]);
  });

  it("reads education and achievements", () => {
    const x = extractFromDoc(profileToDoc(resume(), counter("id")));
    expect(x.education[0]).toMatchObject({ institution: "State U", degree: "BSc", field: "Physics", start: "2012", end: "2016" });
    expect(x.achievements.map((a) => a.text)).toEqual(["Won an award"]);
  });

  it("flattens nested bullets and gives each its own id", () => {
    const doc = profileToDoc(profileWith([{ bullets: ["Parent"] }]), counter("id"));
    const list = find(find(doc, "role"), "bulletList");
    list.content![0].content!.push({
      type: "bulletList",
      content: [{ type: "bullet", attrs: { id: "nested" }, content: [{ type: "paragraph", content: [{ type: "text", text: "Child" }] }] }],
    });
    const x = extractFromDoc(doc);
    expect(x.roles[0].bullets.map((b) => b.text)).toEqual(["Parent", "Child"]);
    expect(x.roles[0].bullets[1].blockId).toBe("nested");
  });

  it("strips a LinkedIn duration tail from the dates", () => {
    const doc = profileToDoc(profileWith([{ start: "Jan 2022", end: "", current: true }]), counter("id"));
    const dates = find(doc, "roleDates");
    dates.content = [{ type: "text", text: "Jan 2022 - Present (2 yrs 3 mos)" }];
    const x = extractFromDoc(doc);
    expect(x.roles[0]).toMatchObject({ start: "Jan 2022", current: true, datesText: "Jan 2022 - Present" });
  });

  it("gives an empty extract for a document with no structure", () => {
    expect(extractFromDoc(profileToDoc(emptyProfile(), counter("id")))).toEqual({
      roles: [], projects: [], skills: [], education: [], certifications: [], achievements: [], paragraphs: [],
    });
  });
});

describe("extractFromProfile", () => {
  it("has the same pieces with no block ids", () => {
    const x = extractFromProfile(resume());
    expect(x.roles[0]).toMatchObject({ blockId: null, title: "Product Manager", datesText: "Jan 2020 - Dec 2021" });
    expect(x.roles[0].bullets.every((b) => b.blockId === null)).toBe(true);
    expect(x.roles[1].datesText).toBe("Jan 2022 - Present");
    expect(x.skills.map((s) => s.name)).toEqual(["TypeScript", "Go", "Postgres"]);
    expect(x.education[0].institution).toBe("State U");
  });
});
