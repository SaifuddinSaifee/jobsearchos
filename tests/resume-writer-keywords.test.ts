import { describe, expect, it, vi } from "vitest";

process.env.DATABASE_URL ??= "postgres://unused";
vi.mock("@/lib/llm/openai", () => ({ chatClient: () => ({}) }));

import { buildRequirements, jobTerms, MAX_JOB_TERMS } from "@/lib/resume-writer/context";
import { checkStuffing, copiedPhrases, coverageNotes, keywordCoverage, resumeText, stuffingFeedback } from "@/lib/resume-writer/keywords";
import { assumeQualified, matchScore, requirementUse } from "@/lib/resume-writer/types";
import { askedFor, buildPrompt, planWriting, readWriting } from "@/lib/resume-writer/write";
import { job, record, withMap } from "./resume-writer-helpers";

const withTech = { ...job, location: "", technologies: ["Kafka", "SQL", "Kubernetes"] };

describe("assumeQualified", () => {
  const base = buildRequirements({
    ...job,
    location: "",
    requirements: { required: ["A must", "B must", "Willing to relocate to San Francisco"], preferred: ["C nice"] },
    technologies: ["Kafka"],
    keywords: ["Books apps"],
    companyProfile: { about: "", principles: "- Users come first, always" },
  }).map((r) => (r.text.startsWith("Willing") ? { ...r, use: "logistics" as const } : r));

  it("takes the must-haves and nice-to-haves the source does not fully show as something the candidate has", () => {
    const mixed = base.map((r, i) => (i === 0 ? { ...r, verdict: "met" as const } : i === 1 ? { ...r, verdict: "partial" as const } : r));
    const out = assumeQualified(mixed);
    expect(out.map((r) => [r.kind, r.verdict, r.userHas])).toEqual([
      ["must", "met", false],
      ["must", "partial", true],
      ["must", "missing", false],
      ["nice", "missing", true],
      ["keyword", "missing", false],
      ["keyword", "missing", false],
      ["company", "missing", false],
    ]);
  });

  it("leaves keywords, the company's values and conditions such as relocation for the user to pick", () => {
    const out = assumeQualified(base);
    expect(out.filter((r) => r.userHas).map((r) => r.text)).toEqual(["A must", "B must", "C nice"]);
  });

  it("leaves an interest, a field or a way of working for the user to pick, even in a nice-to-have", () => {
    const mixed = base.map((r) => (r.text === "C nice" ? { ...r, use: "domain" as const } : r.text === "B must" ? { ...r, use: "trait" as const } : r.text === "A must" ? { ...r, use: "skill" as const } : r));
    expect(assumeQualified(mixed).filter((r) => r.userHas).map((r) => r.text)).toEqual(["A must"]);
  });

  it("keeps what the user already said, with its note, and does not change the input", () => {
    const given = [{ ...base[0], userHas: true, note: "AWS certified" }];
    expect(assumeQualified(given)[0]).toMatchObject({ userHas: true, note: "AWS certified" });
    assumeQualified(base);
    expect(base.every((r) => !r.userHas)).toBe(true);
  });
});

describe("requirement uses", () => {
  it("starts technologies as skills, other keywords as fields and sentences as experience", () => {
    const reqs = buildRequirements({ ...withTech, keywords: ["Books apps"], requirements: { required: ["Strong SQL"], preferred: [] } });
    expect(reqs.map((r) => [r.text, r.use])).toEqual([
      ["Strong SQL", "experience"],
      ["Kafka", "skill"],
      ["Kubernetes", "skill"],
      ["Books apps", "domain"],
    ]);
  });

  it("falls back for a generation made before uses were recorded", () => {
    expect(requirementUse({ kind: "keyword" })).toBe("domain");
    expect(requirementUse({ kind: "must" })).toBe("experience");
    expect(requirementUse({ kind: "keyword", use: "skill" })).toBe("skill");
  });

  it("leaves conditions out of the match score", () => {
    const reqs = [
      { weight: 5, verdict: "met" as const, userHas: false, use: "experience" as const },
      { weight: 5, verdict: "missing" as const, userHas: false, use: "logistics" as const },
    ];
    expect(matchScore(reqs)).toBe(1);
  });
});

describe("jobTerms", () => {
  const supported = (reqs: ReturnType<typeof buildRequirements>, verdicts: Record<string, "met" | "partial" | "missing">) => reqs.map((r) => ({ ...r, verdict: verdicts[r.text] ?? ("missing" as const) }));

  it("lists the technologies the candidate has, once each, in the job's wording", () => {
    const reqs = supported(buildRequirements({ ...withTech, keywords: ["event sourcing", "kafka"], requirements: { required: [], preferred: [] } }), { Kafka: "met", SQL: "met", Kubernetes: "partial" });
    // A partial match is not enough for a keyword: it is the user's pick.
    expect(jobTerms(withTech, reqs)).toEqual(["Kafka", "SQL"]);
    expect(jobTerms(withTech, reqs.map((r) => (r.text === "Kubernetes" ? { ...r, userHas: true } : r)))).toEqual(["Kafka", "SQL", "Kubernetes"]);
  });

  it("leaves out a gap the user did not tick, and includes it once they do", () => {
    const reqs = supported(buildRequirements({ ...withTech, requirements: { required: [], preferred: [] } }), { Kafka: "met" });
    expect(jobTerms(withTech, reqs)).toEqual(["Kafka"]);
    expect(jobTerms(withTech, reqs.map((r) => (r.text === "SQL" ? { ...r, userHas: true } : r)))).toEqual(["Kafka", "SQL"]);
  });

  it("leaves out fields and ways of working even when the user ticks them", () => {
    const reqs = buildRequirements({ ...withTech, technologies: ["Kafka"], keywords: ["Books apps", "Adaptability"], requirements: { required: [], preferred: [] } }).map((r) => ({
      ...r,
      verdict: "met" as const,
      use: r.text === "Adaptability" ? ("trait" as const) : r.use,
    }));
    expect(jobTerms({ technologies: ["Kafka"] }, reqs)).toEqual(["Kafka"]);
  });

  it("takes a keyword the model read as a skill", () => {
    const reqs = buildRequirements({ ...job, technologies: [], keywords: ["Model training"], requirements: { required: [], preferred: [] } }).map((r) => ({ ...r, verdict: "met" as const, use: "skill" as const }));
    expect(jobTerms(job, reqs)).toEqual(["Model training"]);
  });

  it("is short enough to put in a prompt", () => {
    const many = { ...job, technologies: Array.from({ length: 30 }, (_, i) => `Tech${i}`) };
    const reqs = buildRequirements({ ...many, requirements: { required: [], preferred: [] } }).map((r) => ({ ...r, verdict: "met" as const }));
    expect(jobTerms(many, reqs)).toHaveLength(MAX_JOB_TERMS);
  });
});

describe("keyword coverage", () => {
  const reqs = withMap([
    { verdict: "met", refs: ["fact1"] },
    { verdict: "met", refs: ["fact4"] },
  ]).concat(
    buildRequirements({ ...job, requirements: { required: ["Experience with Kafka", "Experience with Kubernetes", "Experience with Rust"], preferred: [] } }).map((r, i) => ({
      ...r,
      id: `k${i}`,
      verdict: i === 0 ? ("partial" as const) : ("missing" as const),
      userHas: i === 1,
    })),
  );
  const plan = planWriting(record(), withTech, reqs);
  const written = readWriting(
    {
      summary: "Product manager who ran SQL reporting.",
      roles: [{ role: "e1", bullets: [{ facts: ["f1"], text: "Launched self-serve billing for 2,000 merchants" }] }],
      projects: [],
      certifications: [],
    },
    plan,
  );

  it("reads everything the resume says as one text", () => {
    expect(resumeText(written)).toContain("sql reporting");
    expect(resumeText(written)).toContain("launched self serve billing");
  });

  it("asks for the terms the candidate has: in the record, or ticked by the user, never a gap nobody claimed", () => {
    // SQL is in the record and the user ticked Kubernetes. Kafka is only partly matched by a sentence, Rust is missing, and
    // Haskell is not asked for in any requirement.
    expect(plan.terms).toEqual(["SQL", "Kubernetes"]);
  });

  it("separates the terms used from the ones left out", () => {
    // Kubernetes, ticked with no note, is in the skills section the code writes; without it, it is left out.
    expect(keywordCoverage(written, plan.terms).present).toEqual(["SQL", "Kubernetes"]);
    const c = keywordCoverage({ ...written, skills: [] }, plan.terms);
    expect(c.present).toEqual(["SQL"]);
    expect(c.missing).toEqual(["Kubernetes"]);
  });

  it("does not take a technology named only inside a sentence as the candidate's because the sentence is met", () => {
    const sentence = buildRequirements({ ...job, technologies: ["Vercel"], requirements: { required: ["You've built actual infrastructure (not just pushed to Vercel)"], preferred: [] } }).map((r) => ({ ...r, verdict: "met" as const }));
    expect(jobTerms({ technologies: ["Vercel"] }, sentence)).toEqual([]);
    expect(jobTerms({ technologies: ["Vercel"] }, sentence, (key) => key === "vercel")).toEqual(["Vercel"]);
    expect(jobTerms({ technologies: ["Vercel"] }, sentence.map((r) => ({ ...r, userHas: true })))).toEqual(["Vercel"]);
  });

  it("says it in words", () => {
    expect(coverageNotes({ present: ["SQL"], missing: ["Kafka"] })).toEqual(["Job terms worked in: SQL.", "Job terms not worked in: Kafka."]);
    expect(coverageNotes({ present: [], missing: [] })).toEqual([]);
  });
});

describe("copiedPhrases", () => {
  it("finds runs of six or more words shared word for word, whatever the case or punctuation", () => {
    const posting = ["Work closely with merchants to launch billing products worldwide."];
    expect(copiedPhrases("Led work, closely with Merchants to launch billing products for 2,000 shops", posting)).toEqual(["work closely with merchants to launch billing products"]);
    expect(copiedPhrases("Launched billing products with merchants", posting)).toEqual([]);
  });
});

describe("the checks on stuffing", () => {
  const stuffJob = { ...job, technologies: ["Kafka"], responsibilities: ["Work closely with merchants to launch billing products worldwide"], aboutCompany: "We are building the most entertaining storyteller in the world" };
  const reqs = buildRequirements({ ...stuffJob, keywords: ["Adaptability"], requirements: { required: ["Experience with Kafka"], preferred: [] } }).map((r) => ({
    ...r,
    verdict: "met" as const,
    // The user ticked the sentence that names Kafka, so Kafka is one of the candidate's terms.
    userHas: r.text === "Experience with Kafka",
    use: r.text === "Adaptability" ? ("trait" as const) : r.use,
  }));
  const plan = planWriting(record(), stuffJob, reqs);
  const resume = (summary: string, bullets: string[]) =>
    readWriting({ summary, roles: [{ role: "e1", bullets: bullets.map((text) => ({ facts: ["f1"], text })) }], projects: [], certifications: [] }, plan);

  it("is quiet for a resume in the candidate's own words", () => {
    const w = resume("Senior engineer who builds billing systems.", ["Built billing on Kafka for 2,000 merchants"]);
    expect(checkStuffing(w, stuffJob, reqs, plan.terms)).toEqual({ copied: [], overused: [], bare: [] });
  });

  it("finds wording lifted from the posting or the company's text", () => {
    const w = resume("Ready to help build the most entertaining storyteller in the world.", ["Work closely with merchants to launch billing products worldwide"]);
    expect(checkStuffing(w, stuffJob, reqs, plan.terms).copied).toEqual(["the most entertaining storyteller in the world", "work closely with merchants to launch billing products worldwide"]);
  });

  it("lets the resume echo a condition the user asked to mention and experience they have, but not what they lack", () => {
    const own = [
      { text: "Willing to relocate to San Francisco for this role", kind: "must" as const, verdict: "missing" as const, userHas: true, use: "logistics" as const },
      { text: "5+ years of product design experience in consumer apps", kind: "must" as const, verdict: "met" as const, userHas: false, use: "experience" as const },
      { text: "Deep experience running large scale growth experiments at scale", kind: "nice" as const, verdict: "missing" as const, userHas: false, use: "experience" as const },
    ];
    const w = resume("Designer with 5+ years of product design experience in consumer apps. Willing to relocate to San Francisco for this role.", ["Has deep experience running large scale growth experiments at scale"]);
    expect(checkStuffing(w, stuffJob, own, []).copied).toEqual(["deep experience running large scale growth experiments at scale"]);
  });

  it("finds a term used in too many places, and a way of working named outright", () => {
    const w = resume("Engineer with Kafka and Adaptability.", ["Moved Kafka consumers", "Tuned Kafka brokers", "Monitored Kafka lag", "Upgraded Kafka"]);
    const found = checkStuffing(w, stuffJob, reqs, plan.terms);
    expect(found.overused).toEqual(["Kafka"]);
    expect(found.bare).toEqual(["Adaptability"]);
  });

  it("says what to change, and nothing when all is well", () => {
    expect(stuffingFeedback({ copied: [], overused: [], bare: [] })).toEqual([]);
    const out = stuffingFeedback({ copied: ["work closely with merchants"], overused: ["Kafka"], bare: ["Adaptability"] }).join(" ");
    expect(out).toContain('"work closely with merchants"');
    expect(out).toContain("too many places: Kafka");
    expect(out).toContain("show them through what was done: Adaptability");
  });
});

describe("the writer's use of the job's terms", () => {
  const richJob = { ...job, technologies: ["Kafka"], keywords: ["Books apps", "Adaptability"], aboutCompany: "A storytelling app for everyone" };
  const reqs = buildRequirements({ ...richJob, requirements: { required: ["Experience with Kafka", "Willing to relocate to San Francisco"], preferred: [] }, companyProfile: { about: "", principles: "- Our mission is to tell stories" } }).map((r) => ({
    ...r,
    userHas: r.text === "Experience with Kafka",
    verdict: r.text.startsWith("Willing") ? ("missing" as const) : ("met" as const),
    use: r.text.startsWith("Willing") ? ("logistics" as const) : r.text === "Adaptability" ? ("trait" as const) : r.use,
  }));
  const plan = planWriting(record(), richJob, reqs);
  it("puts the job's terms and the company in the prompt, each in its own place", () => {
    const { system, user } = buildPrompt(plan, richJob, reqs);
    // Claimed with no note and in no line of the record: the skills section carries it, not a bullet.
    expect(user).toContain("IN THE SKILLS SECTION ONLY (listed there already; no line of the candidate's mentions them)\nKafka");
    const asked = user.slice(user.indexOf("WHAT THE JOB ASKS FOR"), user.indexOf("IN THE SKILLS SECTION ONLY"));
    expect(asked).toContain("Experience with Kafka");
    expect(asked).not.toMatch(/relocate|Books apps|Adaptability|mission/);
    expect(user).toContain("THE COMPANY (for tone and context only; never quote it, never name it in the resume)\nField: Books apps");
    expect(user).toContain("What it values: Our mission is to tell stories");
    expect(user).toContain("SHOW, DO NOT NAME\nAdaptability");
    expect(user).not.toMatch(/relocate/);
    expect(system).toContain("You are an editor, not a writer");
    expect(system).toContain("Never add a number, or a result, purpose or benefit the candidate did not write");
    expect(system).toContain("Never invent an employer, title, degree, certification, interest or hobby");
    expect(system).toContain("never replace a name with a category");
    expect(system).toContain("never the company's name or mission");
    expect(system).toContain("Never copy its sentences");
    expect(system).toContain("Never move one into a line about other work");
    expect(system).toContain("One story per bullet");
  });

  it("asks for what was done in the candidate's words, not a copy of the posting", () => {
    const { user } = buildPrompt(plan, richJob, reqs);
    expect(user).toContain("Responsibilities (for understanding the role, never to be copied)");
  });

  it("leaves a gap the user did not tick out of what it is asked to cover", () => {
    const gap = reqs.map((r) => (r.text === "Experience with Kafka" ? { ...r, verdict: "missing" as const, userHas: false } : r));
    expect(askedFor(gap).map((r) => r.text)).toEqual([]);
    expect(askedFor(gap.map((r) => (r.text === "Experience with Kafka" ? { ...r, userHas: true } : r))).map((r) => r.text)).toEqual(["Experience with Kafka"]);
  });
});
