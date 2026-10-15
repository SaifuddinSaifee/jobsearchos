import { z } from "zod";
import { describe, expect, it, vi } from "vitest";

process.env.DATABASE_URL ??= "postgres://unused";
vi.mock("@/lib/llm/openai", () => ({ chatClient: () => ({}) }));

import {
  RESUME_BANNED_EXTRA,
  answerSchema,
  budgets,
  buildPrompt,
  checkWriting,
  pickFraming,
  planWriting,
  readWriting,
  skillTerm,
  tidy,
  type WriterAnswer,
} from "@/lib/resume-writer/write";
import { role } from "./career-helpers";
import { job, record, withMap } from "./resume-writer-helpers";

describe("pickFraming", () => {
  it("picks the framing with the job's angle, then the closest title", () => {
    const r = record().employers[0].roles[0];
    expect(pickFraming(r, "Product Manager")!.id).toBe("fPm");
    expect(pickFraming(r, "Senior Software Engineer")!.id).toBe("fEng");
    expect(pickFraming(role({ framings: [] }), "x")).toBeNull();
  });
});

describe("budgets", () => {
  it("gives the latest role the most, and fits the total", () => {
    expect(budgets(5, 14)).toEqual([4, 4, 3, 2, 1]);
    expect(budgets(5, 16)).toEqual([5, 4, 3, 2, 2]);
    expect(budgets(2, 14)).toEqual([5, 4]);
    expect(budgets(3, 8)).toEqual([3, 3, 2]);
    expect(budgets(2, 1)).toEqual([1, 1]);
    expect(budgets(0, 16)).toEqual([]);
  });
});

describe("planWriting", () => {
  const reqs = withMap([{ verdict: "met", refs: ["fact1"] }, { verdict: "met", refs: ["fact4", "skill1"] }]);
  const plan = planWriting(record(), job, reqs);

  it("takes the most recent roles, each under the framing that fits, with the wording that fits it", () => {
    expect(plan.roles.map((r) => [r.alias, r.employer, r.title, r.budget])).toEqual([
      ["e1", "Acme", "Product Manager", 5],
      ["e2", "Initech", "Engineer", 4],
    ]);
    expect(plan.roles[0].facts[0].texts).toEqual(["Built the billing service in TypeScript", "Launched self-serve billing for 2,000 merchants"]);
  });

  it("orders facts by the weight of what they answer, then as recorded", () => {
    expect(plan.roles[0].facts.map((f) => [f.alias, f.factId, f.weight])).toEqual([
      ["f1", "fact1", 5],
      ["f2", "fact2", 0],
      ["f3", "fact3", 0],
    ]);
    expect(plan.roles[1].facts[0]).toMatchObject({ alias: "f4", factId: "fact4", weight: 5 });
  });

  it("includes only projects that touch the job, every skill, and the certifications and education", () => {
    expect(plan.projects.map((p) => p.name)).toEqual(["Ledger toy"]);
    expect(plan.skills.map((s) => s.text)).toEqual(["SQL", "Figma"]);
    expect(plan.certifications.map((c) => c.alias)).toEqual(["c1"]);
    expect(plan.education).toHaveLength(1);
  });

  it("turns what the user has into numbered items, a skill when it is short", () => {
    const p = planWriting(record(), job, withMap([{ userHas: true, note: "led the launch" }, {}, {}]));
    expect(p.users).toEqual([{ alias: "u1", requirementId: "r1", text: "Experience launching payments products", note: "led the launch", skill: null, weight: 5 }]);
    const kw = planWriting(record(), job, [{ ...withMap()[0], kind: "keyword", text: "event-driven", use: "skill", userHas: true }]);
    expect(kw.users[0].skill).toBe("event-driven");
    // A field or a way of working the user ticked is worked in, but never listed as a skill; a condition is left out.
    const field = planWriting(record(), job, [{ ...withMap()[0], kind: "keyword", text: "Books apps", use: "domain", userHas: true }, { ...withMap()[0], id: "r2", text: "Relocate to San Francisco", use: "logistics", userHas: true }]);
    expect(field.users.map((u) => [u.text, u.skill])).toEqual([["Books apps", null]]);
  });

  it("reads a skill the user has as the technology it names, not the sentence", () => {
    expect(skillTerm({ text: "Experience with Kafka", kind: "must" }, ["Kafka", "Kubernetes"])).toBe("Kafka");
    expect(skillTerm({ text: "Familiarity with Kubernetes and Helm", kind: "nice" }, ["Kubernetes", "Kube"])).toBe("Kubernetes");
    expect(skillTerm({ text: "Strong SQL", kind: "must", use: "skill" }, [])).toBe("Strong SQL");
    expect(skillTerm({ text: "Strong SQL", kind: "must" }, [])).toBeNull();
    expect(skillTerm({ text: "Adaptability", kind: "keyword", use: "trait" }, [])).toBeNull();
    expect(skillTerm({ text: "Experience launching payments products", kind: "must" }, ["Kafka"])).toBeNull();
    const p = planWriting(record(), { ...job, technologies: ["Kafka"] }, [{ ...withMap()[0], text: "Experience with Kafka", userHas: true }]);
    expect(p.users[0].skill).toBe("Kafka");
    expect(buildPrompt(p, job, withMap()).user).toContain("u1: Kafka");
  });

  it("keeps only the facts that have wording for the chosen framing, and never a skills line", () => {
    const rec = record();
    const roleA = rec.employers[0].roles[0];
    // fact3 was only ever worded for the product framing, and fact2 is a skills line kept as a bullet.
    roleA.facts[2].wordings[0].framingId = "fPm";
    roleA.facts[1].wordings[0].text = "Technologies: TypeScript, Docker";
    const eng = planWriting(rec, { ...job, title: "Software Engineer" }, reqs);
    expect(eng.roles[0].title).toBe("Software Engineer");
    expect(eng.roles[0].facts.map((f) => f.factId)).toEqual(["fact1"]);
    expect(planWriting(rec, job, reqs).roles[0].facts.map((f) => f.factId)).toEqual(["fact1", "fact3"]);
  });

  it("falls back to all of a role's wording when none of it fits the framing, so the role is not lost", () => {
    const rec = record();
    for (const f of rec.employers[1].roles[0].facts) for (const w of f.wordings) w.framingId = "other";
    rec.employers[1].roles[0].framings = [];
    expect(planWriting(rec, job, reqs).roles[1].facts.map((f) => f.factId)).toEqual(["fact4"]);
  });

  it("puts one education, one of each certification and clean skills in the plan", () => {
    const rec = record();
    const tracked = { sources: [], provenance: rec.education[0].provenance };
    rec.education.push({ id: "e2", institution: "North Point School", degree: "ICSE Board", field: "", start: "", end: "2018", details: "", ...tracked }, { id: "e3", institution: "North Point School, India", degree: "ICSE Board", field: "", start: "", end: "2018", details: "", ...tracked });
    rec.certifications.push({ id: "cert2", name: "AWS Certified Solutions Architect", issuer: "Amazon", date: "", ...tracked }, { id: "cert3", name: "Google Cloud Essentials", issuer: "", date: "", ...tracked });
    rec.skills.push(
      { id: "s3", name: "AWS (EC2, S3, Lambda", category: "Cloud", ...tracked },
      { id: "s4", name: "TypeScript/JavaScript", category: "Languages", ...tracked },
      { id: "s5", name: "JavaScript/TypeScript", category: "Languages", ...tracked },
    );
    const p = planWriting(rec, job, reqs);
    expect(p.education.map((e) => e.institution)).toEqual(["State University"]);
    expect(p.certifications.map((c) => c.name)).toEqual(["AWS Solutions Architect", "Google Cloud Essentials"]);
    expect(p.skills.map((s) => s.text)).toEqual(["SQL", "Figma", "AWS (EC2, S3, Lambda)", "TypeScript/JavaScript"]);
  });

  it("chooses a long project by the requirements it answers and the job's words it contains", () => {
    const rec = record();
    rec.projects[1].wordings = [{ id: "pw", text: `${"Built a document collection platform. ".repeat(30)}Launched payments products for merchants and wrote SQL reports.`, framingId: null, form: "bullet", sources: [], provenance: rec.projects[1].provenance }];
    const p = planWriting(rec, job, withMap([{ verdict: "met", refs: ["proj2"] }]));
    expect(p.projects.map((x) => x.name)).toEqual(["Garden app", "Ledger toy"]);
  });

  it("follows the experience limits from the generation instructions", () => {
    const p = planWriting(record(), job, reqs, { styleRules: "", tone: "concise", sectionLimits: [{ section: "Experience", maxBullets: 7, maxChars: 150 }] });
    expect(p.totalBullets).toBe(7);
    expect(p.bulletChars).toBe(150);
    expect(p.roles.reduce((n, r) => n + r.budget, 0)).toBeLessThanOrEqual(7);
  });
});

describe("answers", () => {
  const plan = planWriting(record(), job, withMap([{ userHas: true, note: "AWS certified", refs: ["fact1"] }, {}, {}]));
  const answer = (over: Partial<WriterAnswer> = {}): WriterAnswer => ({
    summary: "Product manager who shipped billing to thousands of merchants.",
    roles: [
      { role: "e2", bullets: [{ facts: ["f4"], text: "Built reporting tools in SQL for the finance team" }] },
      {
        role: "e1",
        bullets: [
          { facts: ["f1", "u1"], text: "- Launched self-serve billing — 2,000 merchants, with the AWS stack" },
          { facts: ["f2"], text: "Cut build times by 40% across the platform team" },
        ],
      },
    ],
    projects: [{ project: "p1", bullets: [{ text: "Designed a double-entry ledger with SQL" }] }],
    skills: [{ category: "Data", items: ["s1", "s2", "s1"] }],
    certifications: ["c1"],
    ...over,
  });

  it("builds a schema that accepts only the ids that were sent", () => {
    const schema = answerSchema(plan);
    expect(schema.safeParse(answer()).success).toBe(true);
    expect(schema.safeParse(answer({ roles: [{ role: "e9", bullets: [{ facts: ["f1"], text: "Some long enough text" }] }] })).success).toBe(false);
    expect(schema.safeParse(answer({ roles: [{ role: "e1", bullets: [{ facts: ["f99"], text: "Some long enough text" }] }] })).success).toBe(false);
    expect(schema.safeParse(answer({ roles: [{ role: "e1", bullets: [{ facts: [], text: "Some long enough text" }] }] })).success).toBe(false);
    expect(schema.safeParse(answer({ certifications: ["c2"] })).success).toBe(false);
    expect(schema.safeParse(answer({ roles: [{ role: "e1", bullets: [{ facts: ["f1"], text: "x".repeat(600) }] }] })).success).toBe(false);
    expect(schema.safeParse(answer({ roles: [{ role: "e1", bullets: [{ facts: ["f1"], text: "x".repeat(400) }] }] })).success).toBe(true);
    expect(schema.safeParse(answer({ roles: [{ role: "e1", bullets: [{ facts: ["f1", "f2", "f3"], text: "Some long enough text" }] }] })).success).toBe(false);
  });

  it("takes a project bullet written as bare text, and still shows the model the object", () => {
    const schema = answerSchema(plan);
    const project = plan.projects[0].alias;
    const parsed = schema.safeParse({ summary: "PM.", roles: [], projects: [{ project, bullets: ["Built the billing prototype in a week", { text: "Shipped it to 40 merchants" }] }], skills: [], certifications: [] });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.projects[0].bullets).toEqual([{ text: "Built the billing prototype in a week" }, { text: "Shipped it to 40 merchants" }]);
    const shown = JSON.stringify(z.toJSONSchema(schema));
    expect(shown).toContain('"bullets":{"maxItems":2,"type":"array","items":{"type":"object","properties":{"text"');
  });

  it("drops projects and certifications that were not offered, instead of failing the whole draft", () => {
    const bare = planWriting({ ...record(), projects: [], certifications: [] }, job, withMap());
    const schema = answerSchema(bare);
    expect(schema.safeParse({ summary: "", roles: [], projects: [], skills: [], certifications: [] }).success).toBe(true);
    const stray = { summary: "PM.", roles: [], projects: [{ project: "p1", bullets: [{ text: "Built a thing nobody offered" }] }], skills: [], certifications: ["c9"] };
    expect(schema.safeParse(stray).success).toBe(true);
    const w = readWriting(stray, bare);
    expect(w.projects).toEqual([]);
    expect(w.certifications).toEqual([]);
  });

  it("reads the answer into a resume: plan order, ids kept, wording tidied, most relevant first", () => {
    const w = readWriting(answer(), plan);
    expect(w.roles.map((r) => r.plan.employer)).toEqual(["Acme", "Initech"]);
    const [first, second] = w.roles[0].bullets;
    expect(first.text).toBe("Launched self-serve billing - 2,000 merchants, with the AWS stack");
    expect(first).toMatchObject({ factIds: ["fact1"], userRequirementIds: ["r1"] });
    // It answers the job's heaviest requirement twice over (the fact it builds on, and what the user says they have).
    expect(first).toMatchObject({ relevance: 10 });
    expect(second).toMatchObject({ factIds: ["fact2"], userRequirementIds: [], relevance: 0 });
    expect(w.projects[0]).toMatchObject({ bullets: [{ text: "Designed a double-entry ledger with SQL", factIds: ["proj1"] }] });
    expect(w.skills).toEqual([{ category: "Data", items: ["SQL", "Figma"] }]);
    expect(w.certifications.map((c) => c.name)).toEqual(["AWS Solutions Architect"]);
    expect(w.education).toBe(plan.education);
  });

  it("keeps a role the model left out, with its strongest facts as they were worded", () => {
    const w = readWriting(answer({ roles: [{ role: "e1", bullets: [{ facts: ["f1"], text: "Launched self-serve billing" }] }] }), plan);
    expect(w.roles[1].bullets.map((b) => b.text)).toEqual(["Wrote internal reporting tools in SQL"]);
  });

  it("drops a repeated bullet and any beyond the role's budget", () => {
    const same = { facts: ["f1"], text: "Launched self-serve billing" };
    const w = readWriting(answer({ roles: [{ role: "e2", bullets: [same, { ...same, text: "launched self-serve billing." }] }] }), plan);
    expect(w.roles[1].bullets).toHaveLength(1);
  });

  it("finds wording the style rules rule out", () => {
    const w = readWriting(answer({ summary: "Passionate product manager who will leverage payments experience." }), plan);
    expect(checkWriting(w).sort()).toEqual(["leverage", "passionate"]);
    expect(checkWriting(readWriting(answer(), plan))).toEqual([]);
  });

  it("tidies list markers, long dashes and spaces", () => {
    expect(tidy("  •  Led a team – of five  engineers ")).toBe("Led a team - of five engineers");
  });
});

describe("ordering what was written", () => {
  const plan = planWriting(record(), job, withMap([{ verdict: "met", refs: ["fact1"] }, { verdict: "met", refs: ["fact4"] }, {}]));
  const base = (over: Partial<WriterAnswer> = {}): WriterAnswer => ({
    summary: "Product manager with payments experience.",
    roles: [
      {
        role: "e1",
        bullets: [
          { facts: ["f3"], text: "Mentored four junior engineers into senior roles" },
          { facts: ["f2"], text: "Cut build times by 40% across the platform team" },
          { facts: ["f1"], text: "Launched self-serve billing for 2,000 merchants" },
        ],
      },
    ],
    projects: [],
    skills: [],
    certifications: [],
    ...over,
  });

  it("puts the bullets that answer the most of the job first, and keeps the model's order for ties", () => {
    const w = readWriting(base(), plan);
    expect(w.roles[0].bullets.map((b) => b.text)).toEqual([
      "Launched self-serve billing for 2,000 merchants",
      "Mentored four junior engineers into senior roles",
      "Cut build times by 40% across the platform team",
    ]);
  });

  it("puts the skills the job asks for first on each line, and the line with the most of them first", () => {
    // SQL is what the job asks for; Figma is not.
    const items = readWriting(base({ skills: [{ category: "Tools", items: ["s2", "s1"] }] }), plan);
    expect(items.skills).toEqual([{ category: "Tools", items: ["SQL", "Figma"] }]);

    const lines = readWriting(base({ skills: [{ category: "Design", items: ["s2"] }, { category: "Data", items: ["s1"] }] }), plan);
    expect(lines.skills.map((s) => s.category)).toEqual(["Data", "Design"]);
  });

  it("rules out the extra phrases that read as machine or student wording", () => {
    const w = readWriting(base({ summary: "Results-driven manager ready for the next stage of my career." }), plan);
    expect(checkWriting(w).sort()).toEqual(["next stage of my career", "results-driven"]);
    expect(RESUME_BANNED_EXTRA).toContain("the combination of");
  });
});

describe("buildPrompt", () => {
  const plan = planWriting(record(), job, withMap([{ userHas: true, note: "AWS certified", verdict: "partial", refs: ["fact1"] }, { verdict: "met", refs: ["fact4"] }, {}]));

  it("sends the job, what it asks for, the record by id, and what the user has", () => {
    const { system, user } = buildPrompt(plan, job, withMap([{ userHas: true, note: "AWS certified" }]), { styleRules: "No jargon.", tone: "confident", sectionLimits: [] });
    expect(system).toContain("The candidate is qualified for this job");
    expect(user).toContain("Product Manager at Stripe, Remote");
    expect(user).toContain("r1 [Must have, the candidate has this]: Experience launching payments products");
    expect(user).toContain('e1: Product Manager at Acme, Jan 2021 - Present. Write up to 5 bullets.');
    expect(user).toContain('f1: "Built the billing service in TypeScript" | "Launched self-serve billing for 2,000 merchants"');
    expect(user).toContain("THE CANDIDATE SAYS THEY HAVE THIS\nu1: Experience launching payments products (their note: AWS certified)");
    expect(user).toContain("Tone: confident.");
    expect(user).toContain("No jargon.");
    expect(user).toContain("PROJECTS (include the ones that answer the job; up to 2 bullets each)\np1: Ledger toy.");
  });
});
