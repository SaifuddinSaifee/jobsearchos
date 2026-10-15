import { describe, expect, it, vi } from "vitest";

process.env.DATABASE_URL ??= "postgres://unused";
vi.mock("@/lib/llm/openai", () => ({ chatClient: () => ({}) }));

import { mergeProvenance, type CareerRecord } from "@/lib/career/schema";
import { buildRequirements, containsPhrase, indexSource, profileLines, recordHasExperience, type JobInput } from "@/lib/resume-writer/context";
import { answerSchema, freeMatches, makeMatcher, matchRequirements, matchScore, readAnswer, readUses, shortlist, type Matcher } from "@/lib/resume-writer/match";
import { employer, fact, recordWith, role } from "./career-helpers";

const job = (over: Partial<JobInput> = {}): JobInput => ({
  title: "Backend Engineer",
  company: "Stripe",
  location: "Remote",
  technologies: [],
  responsibilities: [],
  requirements: { required: [], preferred: [] },
  keywords: [],
  aboutCompany: "",
  companyProfile: null,
  ...over,
});

const record = (): CareerRecord => ({
  ...recordWith(
    employer("Acme", [
      role({
        title: "Software Engineer",
        facts: [
          fact("fact1", [["w1", "Built the billing service in TypeScript used by 2,000 merchants"]]),
          fact("fact2", [["w2", "Cut build times by 40% by caching Docker layers"]]),
        ],
      }),
    ]),
  ),
  skills: [{ id: "skill1", name: "Postgres", category: "Databases", sources: [], provenance: mergeProvenance() }],
  certifications: [{ id: "cert1", name: "AWS Solutions Architect", issuer: "Amazon", date: "2023", sources: [], provenance: mergeProvenance() }],
});

describe("buildRequirements", () => {
  it("lists must-haves, nice-to-haves, keywords and the company's values, with ids and weights", () => {
    const reqs = buildRequirements(
      job({
        requirements: { required: ["5+ years of backend experience", "Experience with payments systems"], preferred: ["Familiarity with Go"] },
        technologies: ["Kafka"],
        keywords: ["event sourcing"],
        companyProfile: { about: "", principles: "- Users first\n- Move with urgency and care" },
      }),
    );
    expect(reqs.map((r) => [r.id, r.kind, r.text, r.weight])).toEqual([
      ["r1", "must", "5+ years of backend experience", 5],
      ["r2", "must", "Experience with payments systems", 5],
      ["r3", "nice", "Familiarity with Go", 2],
      ["r4", "keyword", "Kafka", 2],
      ["r5", "keyword", "event sourcing", 2],
      ["r6", "company", "Users first", 1],
      ["r7", "company", "Move with urgency and care", 1],
    ]);
    expect(reqs.every((r) => r.verdict === "missing" && r.refs.length === 0 && !r.userHas)).toBe(true);
  });

  it("leaves out a keyword a requirement already says, and repeats", () => {
    const reqs = buildRequirements(
      job({
        requirements: { required: ["Strong TypeScript skills", "strong typescript skills."], preferred: [] },
        technologies: ["TypeScript", "Postgres"],
        keywords: ["postgres"],
      }),
    );
    expect(reqs.map((r) => r.text)).toEqual(["Strong TypeScript skills", "Postgres"]);
  });

  it("keeps the list short enough to read", () => {
    const many = Array.from({ length: 40 }, (_, i) => `Requirement number ${i}`);
    const reqs = buildRequirements(job({ requirements: { required: many, preferred: many.map((m) => `${m} nice`) }, technologies: many.map((m) => `tech ${m}`) }));
    expect(reqs.filter((r) => r.kind === "must")).toHaveLength(18);
    expect(reqs.filter((r) => r.kind === "nice")).toHaveLength(10);
    expect(reqs.filter((r) => r.kind === "keyword")).toHaveLength(14);
  });

  it("reads list items and short lines from a company profile, not headings or long prose", () => {
    const md = `# Principles\n\n1. Be direct and kind\n- **Own the outcome** every time\n\n${"Long paragraph. ".repeat(20)}`;
    expect(profileLines(md)).toEqual(["Be direct and kind", "Own the outcome every time"]);
  });

  it("matches whole words only", () => {
    expect(containsPhrase("we use postgres daily", "postgres")).toBe(true);
    expect(containsPhrase("postgresql daily", "postgres")).toBe(false);
  });
});

describe("indexSource", () => {
  it("indexes facts, skills and certifications with where they come from", () => {
    const items = indexSource(record());
    expect(items.map((i) => [i.kind, i.ref, i.label])).toEqual([
      ["fact", "fact1", "Software Engineer at Acme"],
      ["fact", "fact2", "Software Engineer at Acme"],
      ["skill", "skill1", "Skill, Databases"],
      ["certification", "cert1", "Certification"],
    ]);
    expect(items[0].text).toContain("billing service");
    expect(recordHasExperience(record())).toBe(true);
    expect(recordHasExperience(recordWith())).toBe(false);
  });
});

describe("freeMatches", () => {
  const reqs = buildRequirements(
    job({
      requirements: { required: ["Experience with Postgres in production environments at large scale"], preferred: ["Go"] },
      technologies: ["Postgres", "TypeScript", "Kafka", "AWS Solutions Architect"],
    }),
  );
  const found = freeMatches(reqs, indexSource(record()));

  it("settles short terms found in the record", () => {
    const byText = (t: string) => reqs.find((r) => r.text === t)!.id;
    expect(found.get(byText("TypeScript"))).toEqual(["fact1"]);
    expect(found.get(byText("AWS Solutions Architect"))).toEqual(["cert1"]);
    expect(found.has(byText("Kafka"))).toBe(false);
  });

  it("leaves long sentences and one or two letter words to the model", () => {
    expect(found.size).toBe(2);
  });
});

describe("answers", () => {
  const reqs = buildRequirements(job({ requirements: { required: ["Run services at scale", "Mentor engineers"], preferred: [] } }));
  const shown = indexSource(record());

  it("builds a schema that only accepts the ids that were sent", () => {
    const schema = answerSchema(["r1", "r2"], ["i1", "i2"], ["r1", "r2", "r3"]);
    const uses = [{ requirement: "r3", use: "skill" }];
    expect(schema.safeParse({ answers: [{ requirement: "r1", verdict: "met", evidence: ["i1"] }], uses }).success).toBe(true);
    expect(schema.safeParse({ answers: [{ requirement: "r9", verdict: "met", evidence: [] }], uses }).success).toBe(false);
    // r3 was settled without the model, so it has no answer but can be named in the uses.
    expect(schema.safeParse({ answers: [{ requirement: "r3", verdict: "met", evidence: [] }], uses }).success).toBe(false);
    expect(schema.safeParse({ answers: [], uses: [{ requirement: "r9", use: "skill" }] }).success).toBe(false);
    expect(schema.safeParse({ answers: [], uses: [{ requirement: "r1", use: "hobby" }] }).success).toBe(false);
    expect(schema.safeParse({ answers: [{ requirement: "r1", verdict: "met", evidence: ["i9"] }], uses }).success).toBe(false);
    expect(schema.safeParse({ answers: [{ requirement: "r1", verdict: "met", evidence: ["i1", "i2", "i1", "i2"] }], uses }).success).toBe(false);
  });

  it("turns aliases into record ids, keeps the first answer, and cannot show evidence it does not have", () => {
    const out = readAnswer(
      [
        { requirement: "r1", verdict: "met", evidence: ["i1", "i1", "i3"] },
        { requirement: "r1", verdict: "missing", evidence: [] },
        { requirement: "r2", verdict: "partial", evidence: [] },
        { requirement: "r7", verdict: "met", evidence: ["i1"] },
      ],
      reqs,
      shown,
    );
    expect(out.get("r1")).toEqual({ verdict: "met", refs: ["fact1", "skill1"] });
    expect(out.get("r2")).toEqual({ verdict: "missing", refs: [] });
    expect(out.has("r7")).toBe(false);
  });

  it("reads the uses, keeping the first for each requirement and dropping unknown ids", () => {
    const out = readUses([{ requirement: "r1", use: "skill" }, { requirement: "r1", use: "trait" }, { requirement: "r9", use: "domain" }], reqs);
    expect([...out]).toEqual([["r1", "skill"]]);
  });

  it("drops the evidence of a missing answer", () => {
    expect(readAnswer([{ requirement: "r1", verdict: "missing", evidence: ["i1"] }], reqs, shown).get("r1")).toEqual({ verdict: "missing", refs: [] });
  });
});

describe("matchRequirements", () => {
  const reqs = buildRequirements(
    job({
      requirements: { required: ["Run services at scale for thousands of customers", "Lead a team of ten engineers"], preferred: [] },
      technologies: ["TypeScript", "Rust"],
    }),
  );

  it("settles short terms itself and puts only the rest to the model, then fills in the evidence in words", async () => {
    const matcher = vi.fn<Matcher>(async (open) => {
      expect(open.map((r) => r.text)).toEqual(["Run services at scale for thousands of customers", "Lead a team of ten engineers", "Rust"]);
      return new Map([["r1", { verdict: "met" as const, refs: ["fact1"] }]]);
    });
    const out = await matchRequirements(reqs, indexSource(record()), matcher);
    expect(matcher).toHaveBeenCalledOnce();
    expect(out.map((r) => [r.text, r.verdict, r.refs])).toEqual([
      ["Run services at scale for thousands of customers", "met", ["fact1"]],
      ["Lead a team of ten engineers", "missing", []],
      ["TypeScript", "met", ["fact1"]],
      ["Rust", "missing", []],
    ]);
    expect(out[0].evidence).toEqual(["Software Engineer at Acme: Built the billing service in TypeScript used by 2,000 merchants"]);
  });

  it("scores the share of weight the source answers, partial for half, and counts what the user says they have", () => {
    const base = buildRequirements(job({ requirements: { required: ["A", "B"], preferred: ["C"] } }));
    expect(matchScore(base)).toBe(0);
    const some = [{ ...base[0], verdict: "met" as const }, { ...base[1], verdict: "partial" as const }, base[2]];
    expect(matchScore(some)).toBeCloseTo((5 + 2.5) / 12);
    expect(matchScore(some.map((r) => ({ ...r, userHas: true })))).toBe(1);
    expect(matchScore([])).toBe(0);
  });
});

describe("shortlist", () => {
  it("shows everything for a small record, and the closest items for a long one", () => {
    const small = indexSource(record());
    const reqs = buildRequirements(job({ requirements: { required: ["billing service at scale"], preferred: [] } }));
    expect(shortlist(reqs, small)).toHaveLength(small.length);

    const big = Array.from({ length: 200 }, (_, i) => ({ ref: `x${i}`, kind: "fact" as const, label: "Role", text: `Did unrelated thing ${i}`, normalized: `did unrelated thing ${i}` }));
    big.push({ ref: "hit", kind: "fact", label: "Role", text: "Built the billing service", normalized: "built the billing service" });
    const shown = shortlist(reqs, big);
    expect(shown.map((i) => i.ref)).toContain("hit");
    expect(shown.length).toBeLessThan(big.length);
  });
});

describe("makeMatcher", () => {
  const reqs = buildRequirements(job({ requirements: { required: ["Run services at scale", "Mentor engineers"], preferred: [] } }));
  const items = indexSource(record());

  it("asks the model once with ids, and reads its answer", async () => {
    const chat = vi.fn(async (...[, input]: [unknown, { user: string }, unknown?]) => {
      expect(input.user).toContain("i1 [Software Engineer at Acme]");
      expect(input.user).toContain("r2: Mentor engineers");
      return { answers: [{ requirement: "r1", verdict: "partial", evidence: ["i2"] }], uses: [{ requirement: "r1", use: "experience" }, { requirement: "r2", use: "trait" }] };
    });
    const out = await makeMatcher(chat as never)(reqs, items);
    expect(chat).toHaveBeenCalledOnce();
    expect(chat.mock.calls[0][2]).toMatchObject({ step: "match-requirements" });
    expect(out.get("r1")).toEqual({ verdict: "partial", refs: ["fact2"], use: "experience" });
    expect(out.get("r2")).toEqual({ verdict: "missing", refs: [], use: "trait" });
  });

  it("also says what the requirements settled without it are, in the same call", async () => {
    const all = buildRequirements(job({ requirements: { required: ["Run services at scale"], preferred: [] }, technologies: ["TypeScript"] }));
    const chat = vi.fn(async (...[, input]: [unknown, { user: string }, unknown?]) => {
      expect(input.user).toContain("r2: TypeScript [already found in the record: only say what it is]");
      return { answers: [], uses: [{ requirement: "r2", use: "skill" }] };
    });
    const out = await makeMatcher(chat as never)([all[0]], items, all);
    expect(chat).toHaveBeenCalledOnce();
    expect(out.get("r2")).toMatchObject({ use: "skill" });
  });

  it("keeps the model's reading of what each requirement is on the requirement", async () => {
    const all = buildRequirements(job({ requirements: { required: ["Willing to relocate", "Lead a team of ten engineers"], preferred: [] }, technologies: ["TypeScript"], keywords: ["Books apps"] }));
    const matcher: Matcher = async () =>
      new Map([
        ["r1", { verdict: "missing", refs: [], use: "logistics" }],
        ["r4", { verdict: "missing", refs: [], use: "domain" }],
        ["r3", { verdict: "missing", refs: [], use: "skill" }],
      ]);
    const out = await matchRequirements(all, indexSource(record()), matcher);
    expect(out.map((r) => [r.text, r.use])).toEqual([
      ["Willing to relocate", "logistics"],
      ["Lead a team of ten engineers", "experience"],
      ["TypeScript", "skill"],
      ["Books apps", "domain"],
    ]);
  });

  it("makes no call when there is nothing to compare with or nothing open", async () => {
    const chat = vi.fn();
    expect((await makeMatcher(chat as never)(reqs, [])).size).toBe(0);
    expect((await makeMatcher(chat as never)([], items)).size).toBe(0);
    expect(chat).not.toHaveBeenCalled();
  });

  it("tries once more after a bad answer, then fails with the reason", async () => {
    const chat = vi.fn().mockRejectedValueOnce(new Error("not JSON")).mockResolvedValueOnce({ answers: [], uses: [] });
    expect((await makeMatcher(chat as never)(reqs, items)).size).toBe(0);
    expect(chat).toHaveBeenCalledTimes(2);

    const broken = vi.fn().mockRejectedValue(new Error("boom"));
    await expect(makeMatcher(broken as never)(reqs, items)).rejects.toThrow(/Could not match requirements with the model: boom/);
    expect(broken).toHaveBeenCalledTimes(2);
  });
});
