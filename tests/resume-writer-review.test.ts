import { describe, expect, it, vi } from "vitest";

process.env.DATABASE_URL ??= "postgres://unused";
vi.mock("@/lib/llm/openai", () => ({ chatClient: () => ({}) }));

import { mergeProvenance } from "@/lib/career/schema";
import { buildResumeDoc } from "@/lib/resume-writer/build";
import { bulletItems, checkFaithful, missingMentions, namesIn, numbersIn, revertRewrites } from "@/lib/resume-writer/faithful";
import { buildReviewPrompt, makeReviewer, meanScore, readReview, reviewNote, reviewSchema, RUBRIC, type Review, type Reviewer } from "@/lib/resume-writer/review";
import { bulletText, buildPrompt, planWriting, readWriting, withoutCovered, type WriterAnswer } from "@/lib/resume-writer/write";
import { retryStats } from "@/lib/llm/attempts";
import { buildPatchPrompt, buildRevisePrompt, disagreements, findingTargets, makeWriter, materialEdits, patchSchema, WRITER_EFFORT, type WriterTrace } from "@/lib/resume-writer/writer";
import { job, record, withMap } from "./resume-writer-helpers";

const contact = { name: "Sam Example", email: "sam@example.com", phone: "", location: "", links: [] };

/** A record whose first fact is worded with names and numbers, the way a candidate writes. */
function richRecord() {
  const r = record();
  r.employers[0].roles[0].facts[0].wordings = [
    {
      id: "w1",
      text: "Built Python ETL pipelines and backend APIs that pull from Attio, Crisp, Productboard, and Userlist and process 500K+ daily events at 99.9% uptime",
      framingId: null,
      form: "bullet",
      sources: [],
      provenance: mergeProvenance(),
    },
  ];
  r.achievements = [
    { id: "ach1", text: "Smart India Hackathon '22 (Winner)", sources: [], provenance: mergeProvenance() },
    { id: "ach2", text: "Smart India Hackathon '22 (Winner)", sources: [], provenance: mergeProvenance() },
  ];
  return r;
}

const reqs = withMap([{ verdict: "met", refs: ["fact1"] }, { verdict: "met", refs: ["fact4"] }]);
const plan = planWriting(richRecord(), job, reqs);
const OWN = "Built Python ETL pipelines and backend APIs that pull from Attio, Crisp, Productboard, and Userlist and process 500K+ daily events at 99.9% uptime";

const answer = (first: string, over: Partial<WriterAnswer> = {}): WriterAnswer => ({
  summary: "Product manager who shipped billing to 2,000 merchants.",
  roles: [
    { role: "e1", bullets: [{ facts: ["f1"], text: first }, { facts: ["f2"], text: "Cut build times by 40%" }] },
    { role: "e2", bullets: [{ facts: ["f4"], text: "Wrote internal reporting tools in SQL" }] },
  ],
  projects: [],
  skills: [{ category: "Data", items: ["s1"] }],
  certifications: [],
  ...over,
});

describe("reading numbers and names", () => {
  it("reads numbers without thousands separators", () => {
    expect(numbersIn("2,000 merchants at 99.9% uptime, 3x traffic")).toEqual(["2000", "99.9", "3"]);
  });

  it("reads the names of tools and products, not a capital that starts a sentence", () => {
    expect(namesIn("Built pipelines that pull from Attio, Crisp and Next.js. Cut costs with AWS")).toEqual(["Attio", "Crisp", "Next.js", "AWS"]);
  });
});

describe("checkFaithful", () => {
  const items = (first: string) => bulletItems(readWriting(answer(first), plan), plan);

  it("is quiet for a light edit of the candidate's own line", () => {
    const light = "Built Python ETL pipelines and APIs pulling from Attio, Crisp, Productboard and Userlist, processing 500K+ daily events at 99.9% uptime";
    expect(checkFaithful(items(light), plan.terms)).toEqual([]);
  });

  it("finds a number, a result, lost names and a rewrite the candidate never wrote", () => {
    const generic = "Designed backend services and data infrastructure in Python handling 750K events, so the team could scale reliably";
    const kinds = checkFaithful(items(generic), plan.terms).map((f) => [f.bullet, f.kind]);
    expect(kinds).toEqual([
      ["b1", "new-number"],
      ["b1", "added-outcome"],
      ["b1", "lost-names"],
      ["b1", "rewritten"],
    ]);
  });

  it("puts a rewritten bullet back to the candidate's own words, and leaves one that works in what the user has", () => {
    const w = readWriting(answer("Spearheaded transformative synergies across organisational verticals"), plan);
    const out = revertRewrites(w, plan);
    expect(out.reverted).toEqual(["b1"]);
    expect(out.written.roles[0].bullets[0].text).toBe(OWN);

    const userPlan = planWriting(richRecord(), job, withMap([{ verdict: "met", refs: ["fact1"], userHas: true }]));
    const withUser = readWriting(answer("Spearheaded transformative synergies across organisational verticals", { roles: [{ role: "e1", bullets: [{ facts: ["f1", "u1"], text: "Spearheaded transformative synergies across organisational verticals" }] }] }), userPlan);
    expect(revertRewrites(withUser, userPlan).reverted).toEqual([]);
  });
});

describe("the plan for the writer", () => {
  it("puts every achievement on the resume once, without asking the model", () => {
    expect(plan.achievements.map((a) => a.text)).toEqual(["Smart India Hackathon '22 (Winner)"]);
    const w = readWriting(answer(OWN), plan);
    expect(w.achievements).toEqual(["Smart India Hackathon '22 (Winner)"]);
    expect(buildResumeDoc(w, contact).doc.content?.some((n) => n.type === "section" && n.attrs?.kind === "achievements")).toBe(true);
  });

  it("puts a condition the user asked to mention at the end of the summary, and nowhere else", () => {
    const relocate = [...reqs, { ...reqs[0], id: "r9", kind: "must" as const, text: "Willing to relocate to San Francisco", use: "logistics" as const, verdict: "missing" as const, userHas: true }];
    const p = planWriting(richRecord(), job, relocate);
    expect(p.mentions).toEqual(["Willing to relocate to San Francisco"]);
    expect(p.users.map((u) => u.text)).not.toContain("Willing to relocate to San Francisco");
    const { user } = buildPrompt(p, job, relocate);
    expect(user).toContain('MENTION BRIEFLY (one short closing sentence of the summary, in the candidate\'s words, for example "Open to relocating to San Francisco.")\nWilling to relocate to San Francisco');
    expect(user.slice(user.indexOf("WHAT THE JOB ASKS FOR"), user.indexOf("THE CANDIDATE'S ROLES"))).not.toContain("relocate");
  });

  it("puts an interest the user ticked in one Interests line, and never one they did not give", () => {
    const fandom = { ...reqs[0], id: "r8", kind: "nice" as const, text: "Optional: you're into fandom, reading, games, or fanfiction", use: "domain" as const, verdict: "missing" as const };
    const ticked = planWriting(richRecord(), job, [...reqs, { ...fandom, userHas: true, note: "AO3 reader since 2016" }]);
    expect(ticked.interests).toEqual([{ requirementId: "r8", text: fandom.text, note: "AO3 reader since 2016" }]);
    // Not worked into a bullet: it is not something they did at work.
    expect(ticked.users.map((u) => u.requirementId)).not.toContain("r8");
    expect(buildPrompt(ticked, job, reqs).user).toContain("INTERESTS (the candidate's own; write \"interests\" from these and their notes only)\nOptional: you're into fandom, reading, games, or fanfiction (their note: AO3 reader since 2016)");

    const w = readWriting(answer(OWN, { interests: "Fanfiction, an AO3 reader since 2016." }), ticked);
    expect(w.interests).toBe("Fanfiction, an AO3 reader since 2016");
    expect(buildResumeDoc(w, contact).doc.content?.some((n) => JSON.stringify(n).includes("Interests"))).toBe(true);

    const untouched = planWriting(richRecord(), job, [...reqs, fandom]);
    expect(untouched.interests).toEqual([]);
    expect(readWriting(answer(OWN, { interests: "A lifelong reader of fanfiction" }), untouched).interests).toBe("");
  });

  it("finds a condition the summary does not mention", () => {
    expect(missingMentions("Engineer who ships. Open to relocating to San Francisco.", ["You're willing to relocate to San Francisco"])).toEqual([]);
    expect(missingMentions("Engineer who ships.", ["You're willing to relocate to San Francisco"])).toEqual(["You're willing to relocate to San Francisco"]);
  });

  it("ends every bullet the same way, and drops a skill a fuller one covers", () => {
    expect(bulletText("- Built the billing service.")).toBe("Built the billing service");
    expect(bulletText("Built it in Node.js")).toBe("Built it in Node.js");
    expect(withoutCovered([{ category: "Languages", items: ["TypeScript", "TypeScript/JavaScript", "Python"] }, { category: "Cloud", items: ["AWS", "AWS (EC2, S3)"] }])).toEqual([
      { category: "Languages", items: ["TypeScript/JavaScript", "Python"] },
      { category: "Cloud", items: ["AWS (EC2, S3)"] },
    ]);
  });

  it("starts each fact from the wording that says the most of what the job asks for", () => {
    const r = richRecord();
    r.employers[0].roles[0].facts[1].wordings = [
      { id: "x1", text: "Cut build times by 40%", framingId: null, form: "bullet", sources: [], provenance: mergeProvenance() },
      { id: "x2", text: "Cut build times by 40% while launching payments products with SQL", framingId: null, form: "bullet", sources: [], provenance: mergeProvenance() },
    ];
    const p = planWriting(r, job, reqs);
    expect(p.roles[0].facts.find((f) => f.factId === "fact2")!.texts[0]).toBe("Cut build times by 40% while launching payments products with SQL");
  });
});

describe("the review", () => {
  const w = readWriting(answer(OWN), plan);
  const items = bulletItems(w, plan);
  const review = (over: Partial<Review> = {}): Review => ({
    scores: RUBRIC.map((c) => ({ criterion: c.id, score: 4, note: "fine" })),
    edits: [],
    verdict: "ready",
    ...over,
  });

  it("only accepts targets that exist and criteria from the rubric", () => {
    const schema = reviewSchema(items.map((i) => i.id));
    expect(schema.safeParse(review({ edits: [{ target: "b2", criterion: "voice", problem: "x", instruction: "y" }], verdict: "revise" })).success).toBe(true);
    expect(schema.safeParse(review({ edits: [{ target: "b99", criterion: "voice", problem: "x", instruction: "y" }] })).success).toBe(false);
    expect(schema.safeParse(review({ edits: [{ target: "summary", criterion: "taste", problem: "x", instruction: "y" }] })).success).toBe(false);
    expect(schema.safeParse(review({ scores: [{ criterion: "voice", score: 6, note: "" }] })).success).toBe(false);
  });

  it("keeps the first score per criterion", () => {
    const read = readReview(review({ scores: [{ criterion: "voice", score: 2, note: "a" }, { criterion: "voice", score: 5, note: "b" }] }), items);
    expect(read.scores).toEqual([{ criterion: "voice", score: 2, note: "a" }]);
  });

  it("shows the reviewer each bullet with the candidate's own lines, the stance, the code findings and the criteria", () => {
    const { system, user } = buildReviewPrompt(w, items, plan, job, reqs, [{ bullet: "b2", kind: "new-number", detail: "has numbers the candidate never wrote: 75" }]);
    expect(system).toContain("Never ask to remove, soften or prove it");
    expect(system).toContain("Never ask for a number, a tool, a result or a claim that is not in the candidate's lines");
    expect(user).toContain(`b1: ${OWN}`);
    expect(user).toContain(`    from the record: ${OWN}`);
    expect(user).toContain("- b2 has numbers the candidate never wrote: 75");
    for (const c of RUBRIC) expect(user).toContain(`${c.id} (${c.name})`);
  });

  it("asks the review model under its own step", async () => {
    const chat = vi.fn(async () => review());
    await makeReviewer(chat as never)(w, items, plan, job, reqs, []);
    expect((chat.mock.calls[0] as unknown[])[2]).toMatchObject({ step: "review-resume", model: expect.any(String) });
  });

  it("says how it went in a line", () => {
    const low = review({ scores: [{ criterion: "voice", score: 2, note: "" }, { criterion: "faithful", score: 5, note: "" }], edits: [{ target: "b1", criterion: "voice", problem: "", instruction: "" }], verdict: "revise" });
    expect(meanScore(low)).toBe(3.5);
    expect(reviewNote(low, true)).toBe("Review of the draft: 3.5 of 5; weakest: Sounds like the candidate (2). 1 edit was made after it.");
    expect(reviewNote(review(), false)).toBe("Review of the draft: 4.0 of 5. No edits needed.");
  });
});

describe("makeWriter: write, review, revise", () => {
  const ready: Reviewer = async () => ({ scores: RUBRIC.map((c) => ({ criterion: c.id, score: 5, note: "" })), edits: [], verdict: "ready" });
  const asks: Reviewer = async () => ({
    scores: RUBRIC.map((c) => ({ criterion: c.id, score: c.id === "voice" ? 2 : 4, note: "" })),
    edits: [{ target: "b2", criterion: "voice", problem: "Too terse.", instruction: "Say what the build cut enabled, from the record." }],
    verdict: "revise",
  });

  it("drafts at the highest effort with the writing model, and stops when the review needs nothing", async () => {
    const chat = vi.fn(async () => answer(OWN));
    const out = await makeWriter(chat as never, ready)(plan, job, reqs);
    expect(chat).toHaveBeenCalledOnce();
    expect((chat.mock.calls[0] as unknown[])[2]).toMatchObject({ step: "write-resume", reasoningEffort: WRITER_EFFORT, jsonMode: "prompt", model: expect.any(String) });
    expect(WRITER_EFFORT).toBe("max");
    expect(out.notes[0]).toBe("Review of the draft: 5.0 of 5. No edits needed.");
  });

  it("revises with the review and its draft, and keeps the revision", async () => {
    const chat = vi.fn().mockResolvedValueOnce(answer(OWN)).mockResolvedValueOnce(answer(OWN, { summary: "Engineer who built pipelines for 500K+ daily events." }));
    const out = await makeWriter(chat as never, asks)(plan, job, reqs);
    expect(chat).toHaveBeenCalledTimes(2);
    const [, input, opts] = chat.mock.calls[1] as [unknown, { system: string; user: string }, { step: string; reasoningEffort: string }];
    expect(opts).toMatchObject({ step: "revise-resume", reasoningEffort: "max" });
    expect(input.system).toContain("You are now revising your draft");
    expect(input.user).toContain("THE REVIEW\n- b2 [Sounds like the candidate]: Too terse. Do this: Say what the build cut enabled, from the record.");
    expect(input.user).toContain("YOUR DRAFT (in the answer format)");
    expect(out.written.summary).toBe("Engineer who built pipelines for 500K+ daily events.");
    expect(out.notes[0]).toMatch(/^Review of the draft: 3\.8 of 5; weakest: Sounds like the candidate \(2\)\. 1 edit was made after it\.$/);
  });

  it("keeps the draft, and says so, when the review or the revision fails", async () => {
    const broken: Reviewer = async () => {
      throw new Error("rate limited");
    };
    const chat = vi.fn(async () => answer(OWN));
    const out = await makeWriter(chat as never, broken, async () => {})(plan, job, reqs);
    // Nothing for the code checks either, so no revision.
    expect(chat).toHaveBeenCalledOnce();
    expect(out.notes[0]).toMatch(/review could not run/);

    const flaky = vi.fn().mockResolvedValueOnce(answer(OWN)).mockRejectedValueOnce(new Error("bad JSON"));
    const kept = await makeWriter(flaky as never, asks)(plan, job, reqs);
    expect(kept.written.roles[0].bullets[0].text).toBe(OWN);
    expect(kept.notes.join(" ")).toMatch(/revision after the review could not run/);
  });

  it("waits and asks the reviewer again when it is refused for the rate limit, and not for other errors", async () => {
    const wait = vi.fn(async () => {});
    let calls = 0;
    const busy: Reviewer = async (...args) => {
      if (calls++ < 2) throw new Error("429 Too many requests in a short window.");
      return ready(...args);
    };
    const chat = vi.fn(async () => answer(OWN));
    const out = await makeWriter(chat as never, busy, wait)(plan, job, reqs);
    expect(wait.mock.calls).toEqual([[20_000], [40_000]]);
    expect(out.notes[0]).toBe("Review of the draft: 5.0 of 5. No edits needed.");

    const waitAgain = vi.fn(async () => {});
    const broken: Reviewer = async () => {
      throw new Error("The model's output was not valid JSON");
    };
    const kept = await makeWriter(vi.fn(async () => answer(OWN)) as never, broken, waitAgain)(plan, job, reqs);
    expect(waitAgain).not.toHaveBeenCalled();
    expect(kept.notes[0]).toMatch(/review could not run/);
  });

  it("revises on the code checks alone when the review could not run", async () => {
    const broken: Reviewer = async () => {
      throw new Error("down");
    };
    const chat = vi.fn().mockResolvedValueOnce(answer(OWN, { summary: "Passionate engineer." })).mockResolvedValueOnce(answer(OWN));
    await makeWriter(chat as never, broken)(plan, job, reqs);
    expect(chat).toHaveBeenCalledTimes(2);
    expect((chat.mock.calls[1] as [unknown, { user: string }])[1].user).toContain('FOUND BY CODE CHECKS\n- resume uses the generic phrase "passionate"');
  });

  it("puts back a bullet the revision rewrote beyond recognition, with a note", async () => {
    const chat = vi.fn().mockResolvedValueOnce(answer(OWN)).mockResolvedValueOnce(answer("Spearheaded transformative synergies across organisational verticals"));
    const out = await makeWriter(chat as never, asks)(plan, job, reqs);
    expect(out.written.roles[0].bullets[0].text).toBe(OWN);
    expect(out.notes.join(" ")).toContain("One bullet was put back to your own wording");
  });

  it("fails with the reason when the draft cannot be written", async () => {
    const broken = vi.fn().mockRejectedValue(new Error("boom"));
    await expect(makeWriter(broken as never, ready)(plan, job, reqs)).rejects.toThrow(/Could not write the resume with the model: boom/);
    expect(broken).toHaveBeenCalledTimes(2);
  });

  it("sends the revision the draft's bullets by id", () => {
    const w = readWriting(answer(OWN), plan);
    const { user } = buildRevisePrompt(buildPrompt(plan, job, reqs), answer(OWN), bulletItems(w, plan), null, []);
    expect(user).toContain(`b1 (Product Manager at Acme): ${OWN}`);
  });
});

describe("makeWriter: options for evaluation", () => {
  const scored = (score: (id: string) => number, edits: Review["edits"] = [], verdict: Review["verdict"] = "revise"): Reviewer => async () => ({ scores: RUBRIC.map((c) => ({ criterion: c.id, score: score(c.id), note: "" })), edits, verdict });
  const w = readWriting(answer(OWN), plan);
  const items = bulletItems(w, plan);

  it("writes with the model and effort it is given, and the reviewer asks the model it is given", async () => {
    const chat = vi.fn(async () => answer(OWN));
    await makeWriter(chat as never, scored(() => 5, [], "ready"), async () => {}, { model: "zai-org/GLM-5.3-Flash", effort: "high" })(plan, job, reqs);
    expect((chat.mock.calls[0] as unknown[])[2]).toMatchObject({ model: "zai-org/GLM-5.3-Flash", reasoningEffort: "high" });

    const review = vi.fn(async () => ({ scores: [], edits: [], verdict: "ready" }));
    await makeReviewer(review as never, { model: "deepseek-ai/DeepSeek-V4.1-Flash" })(w, items, plan, job, reqs, []);
    expect((review.mock.calls[0] as unknown[])[2]).toMatchObject({ model: "deepseek-ai/DeepSeek-V4.1-Flash", step: "review-resume" });
  });

  it("asks the fallback reviewer when the reviewer fails, and says so in the trace", async () => {
    const broken: Reviewer = async () => {
      throw new Error("The model's output was not valid JSON");
    };
    let trace: WriterTrace | null = null;
    const out = await makeWriter(vi.fn(async () => answer(OWN)) as never, broken, async () => {}, { fallbackReviewer: scored(() => 5, [], "ready"), onTrace: (t) => (trace = t) })(plan, job, reqs);
    expect(out.notes[0]).toBe("Review of the draft: 5.0 of 5. No edits needed.");
    expect(trace).toMatchObject({ reviewedBy: "fallback", reviewErrors: ["The model's output was not valid JSON"], revision: "skipped" });
  });

  it("counts an edit as material when it is about what the resume claims, or its criterion scored 3 or less", () => {
    const review = { scores: RUBRIC.map((c) => ({ criterion: c.id, score: c.id === "rhythm" ? 3 : 4, note: "" })), verdict: "revise" as const, edits: [
      { target: "b1", criterion: "faithful", problem: "", instruction: "" },
      { target: "b2", criterion: "voice", problem: "", instruction: "" },
      { target: "b3", criterion: "rhythm", problem: "", instruction: "" },
    ] };
    expect(materialEdits(review).map((e) => e.target)).toEqual(["b1", "b3"]);
  });

  it("places a finding on the parts it is about", () => {
    const summary = { ...w, summary: "Passionate product manager." };
    expect(findingTargets({ bullet: "b2", kind: "new-number", detail: "" }, w, items)).toEqual(["b2"]);
    expect(findingTargets({ bullet: "resume", kind: "generic", detail: 'uses the generic phrase "passionate"' }, summary, items)).toEqual(["summary"]);
    expect(findingTargets({ bullet: "resume", kind: "overused", detail: 'uses "Userlist" in too many places' }, w, items)).toEqual(["b1"]);
    expect(findingTargets({ bullet: "resume", kind: "missing-mention", detail: "leaves out the Interests line the candidate asked for" }, w, items)).toEqual(["interests"]);
  });

  it("says where the review and the code checks disagree", () => {
    const finding = { bullet: "b2", kind: "new-number" as const, detail: "" };
    const targets = (f: { bullet: string }) => [f.bullet];
    const ready = { scores: RUBRIC.map((c) => ({ criterion: c.id, score: 5, note: "" })), edits: [], verdict: "ready" as const };
    expect(disagreements(ready, [finding], targets)).toEqual(['verdict "ready" with 1 code finding', "no edit for b2 new-number"]);
    const agrees = { ...ready, verdict: "revise" as const, edits: [{ target: "b2", criterion: "faithful", problem: "", instruction: "" }] };
    expect(disagreements(agrees, [finding], targets)).toEqual([]);
    const doubts = { ...ready, scores: [{ criterion: "faithful", score: 2, note: "" }] };
    expect(disagreements(doubts, [], targets)).toEqual(["scored faithful 2 while the code checks found nothing unfaithful"]);
  });

  it("skips the targeted revision when the checks pass and no edit is material", async () => {
    const chat = vi.fn(async () => answer(OWN));
    let trace: WriterTrace | null = null;
    const taste = scored(() => 4, [{ target: "b2", criterion: "voice", problem: "Could be warmer.", instruction: "Reword." }]);
    await makeWriter(chat as never, taste, async () => {}, { revision: "targeted", onTrace: (t) => (trace = t) })(plan, job, reqs);
    expect(chat).toHaveBeenCalledOnce();
    expect(trace).toMatchObject({ revision: "skipped", targets: [], materialEdits: 0 });
  });

  it("rewrites only the flagged parts in a targeted revision, and keeps every other bullet and its facts", async () => {
    const material = scored((id) => (id === "rhythm" ? 2 : 4), [{ target: "b2", criterion: "rhythm", problem: "Too terse.", instruction: "Say what the build cut was." }]);
    const chat = vi.fn().mockResolvedValueOnce(answer(OWN)).mockResolvedValueOnce({ bullets: [{ id: "b2", text: "Cut build times by 40% across the payments services" }, { id: "b1", text: "Should not land: not asked for" }] });
    let trace: WriterTrace | null = null;
    const out = await makeWriter(chat as never, material, async () => {}, { revision: "targeted", onTrace: (t) => (trace = t) })(plan, job, reqs);
    const [, input, opts] = chat.mock.calls[1] as [unknown, { system: string; user: string }, { step: string }];
    expect(opts.step).toBe("revise-resume");
    expect(input.user).toContain("TO REVISE\nb2");
    expect(input.system).toContain("revising only the parts of your draft listed under TO REVISE");
    const bullets = out.written.roles[0].bullets;
    expect(bullets.map((b) => b.text)).toEqual([OWN, "Cut build times by 40% across the payments services"]);
    expect(bullets[1].factIds).toEqual(readWriting(answer(OWN), plan).roles[0].bullets[1].factIds);
    expect(trace).toMatchObject({ revision: "targeted", targets: ["b2"] });
  });

  it("asks a targeted revision for only the listed bullets", () => {
    const schema = patchSchema(plan, ["b2"]);
    expect(schema.safeParse({ bullets: [{ id: "b2", text: "Cut build times by 40%" }] }).success).toBe(true);
    expect(schema.safeParse({ bullets: [{ id: "b1", text: "Cut build times by 40%" }] }).success).toBe(false);
    const { user } = buildPatchPrompt(buildPrompt(plan, job, reqs), answer(OWN), items, [], [{ bullet: "summary", kind: "generic", detail: "uses the generic phrase \"passionate\"" }], ["summary"]);
    expect(user).toContain("TO REVISE\nsummary");
    expect(user).toContain('FOUND BY CODE CHECKS\n- summary uses the generic phrase "passionate"');
  });
});

describe("retryStats", () => {
  it("counts the tries after the first and the time between them", () => {
    expect(retryStats({ starts: [0, 100, 1000], ends: [50, 150, 1200] })).toEqual({ retryCount: 2, retryWaitMs: 900 });
    expect(retryStats({ starts: [], ends: [] })).toEqual({ retryCount: 0, retryWaitMs: 0 });
  });
});
