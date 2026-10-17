import { describe, expect, it, vi } from "vitest";

process.env.DATABASE_URL ??= "postgres://unused";
vi.mock("@/lib/llm/openai", () => ({ chatClient: () => ({}) }));

import { mergeProvenance } from "@/lib/career/schema";
import { closeCutJson } from "@/lib/llm/structured";
import { headerLocation } from "@/lib/resume-writer/build";
import { addedNames, bareClaimFindings, bulletItems, droppedStrong, mergedResults, revertAddedNames, revertRewrites, twoStories, unbackedInSummary, unproven, withoutRepeats } from "@/lib/resume-writer/faithful";
import { buildReviewPrompt, makeReviewer, renderDraft, reviewSchema, salvageReview } from "@/lib/resume-writer/review";
import { buildPrompt, clipAtSentence, headerMention, inSentenceCase, offered, planWriting, readWriting, resultClause, strongestClause, withoutRepeatedStack, type WriterAnswer } from "@/lib/resume-writer/write";
import { codeFindings, repeatedInSummary, tooLong } from "@/lib/resume-writer/writer";
import { job, record, withMap } from "./resume-writer-helpers";

const ONBOARDING = "Rebuilt onboarding, increasing user activation by 45% and cutting time to first value from 8 minutes to 1";
const MIGRATION = "Migrated the platform to Next.js, handling 3x traffic; cut support tickets by 36% with an AI chatbot";
const LOGGING = "Built a logging layer that traces every LLM call in Postgres";
const wording = (id: string, text: string) => ({ id, text, framingId: null, form: "bullet" as const, sources: [], provenance: mergeProvenance() });

/** A recent role with a strong result, a line holding two results, and a plain one. */
function provenRecord() {
  const r = record();
  const facts = r.employers[0].roles[0].facts;
  facts[0].wordings = [wording("w1", LOGGING)];
  facts[1].wordings = [wording("w2", MIGRATION)];
  facts[2].wordings = [wording("w3", ONBOARDING)];
  return r;
}

const core = withMap([{ verdict: "met", refs: ["fact3"], core: true, weight: 8 }, { verdict: "met", refs: ["fact2"] }]);
const plan = planWriting(provenRecord(), job, core);
const alias = (factId: string) => plan.roles.flatMap((r) => r.facts).find((f) => f.factId === factId)!.alias;

const answer = (bullets: { facts: string[]; text: string }[], over: Partial<WriterAnswer> = {}): WriterAnswer => ({
  summary: "Engineer who ships.",
  roles: [{ role: "e1", bullets }],
  projects: [],
  certifications: [],
  ...over,
});

describe("the summary's proof", () => {
  it("is one clause: a line joined by a semicolon holds two results", () => {
    expect(strongestClause("Led weekly planning; increased activation by 45% from 8 minutes to 1")).toBe("increased activation by 45% from 8 minutes to 1");
    expect(strongestClause(ONBOARDING)).toBe(ONBOARDING);
  });

  it("is the fact that best answers the job's core, not the one with the biggest number", () => {
    expect(plan.summaryProof).toEqual({ alias: alias("fact3"), text: ONBOARDING });
    expect(buildPrompt(plan, job, core).user).toContain(`SUMMARY PROOF (the result the summary leads with, from ${alias("fact3")})\n${ONBOARDING}`);
  });

  it("is the result, not the method list that follows it", () => {
    const line = "Increased user activation by 45% by owning the onboarding redesign: synthesized JTBD interviews, Mixpanel funnels and LogRocket replays, then cut time to first value from 8 minutes to 1";
    expect(resultClause(line)).toBe("Increased user activation by 45% by owning the onboarding redesign");
    // With no result before the colon, the line is kept whole.
    expect(resultClause("Owned onboarding: raised activation by 45%")).toBe("Owned onboarding: raised activation by 45%");
  });

  it("is a measured result, never a line that only answers more of the job", () => {
    // The logging line answers both core requirements and states no result; the onboarding line answers nothing asked.
    const broad = withMap([{ verdict: "met", refs: ["fact1"], core: true, weight: 8 }, { verdict: "met", refs: ["fact1"], core: true, weight: 8 }]);
    expect(planWriting(provenRecord(), job, broad).summaryProof?.text).toBe(ONBOARDING);
  });
});

describe("what the user says they have", () => {
  const claims = withMap([{ userHas: true, note: "Led the payments launch at Acme" }, { userHas: true, note: "" }]);
  const p = planWriting(provenRecord(), job, claims);

  it("is to be proven when it has a note, and only listed when it has none", () => {
    expect(p.users.map((u) => [u.alias, u.bare])).toEqual([
      ["u1", false],
      ["u2", true],
    ]);
    const { user } = buildPrompt(p, job, claims);
    expect(user).toContain("THE CANDIDATE SAYS THEY HAVE THIS\nu1: Experience launching payments products (their note: Led the payments launch at Acme)");
    expect(user).toContain("ALSO TRUE, NO DETAIL GIVEN\nu2: Strong SQL");
  });

  it("is flagged in the summary, or as the whole of a bullet, when it has no detail", () => {
    const w = readWriting(answer([{ facts: [alias("fact3")], text: ONBOARDING }, { facts: ["u2"], text: "Wrote strong SQL across the data stack" }], { summary: "Engineer with strong SQL." }), p);
    const found = bareClaimFindings(w, bulletItems(w, p), p.users).map((f) => [f.bullet, f.kind]);
    expect(found).toEqual([
      ["summary", "bare-claim"],
      ["b2", "bare-claim"],
    ]);
  });
});

describe("the role's strongest results", () => {
  it("are marked to keep, as many as the role has bullets for, and only when measured", () => {
    expect(plan.roles[0].facts.filter((f) => f.keep).map((f) => f.factId).sort()).toEqual(["fact2", "fact3"]);
    expect(buildPrompt(plan, job, core).user).toContain(`${alias("fact3")} [keep]: "${ONBOARDING}"`);
    expect(plan.roles[0].facts.find((f) => f.factId === "fact1")?.keep).toBe(false);
    // The older role's line states no result, so nothing there is marked.
    expect(plan.roles[1].facts.some((f) => f.keep)).toBe(false);
  });

  it("are flagged when left out, against the weakest bullet that does not prove a claim with a note", () => {
    const claims = withMap([{ verdict: "met", refs: ["fact3"], core: true, weight: 8 }, { userHas: true, note: "Ran it on Postgres" }]);
    const p = planWriting(provenRecord(), job, claims);
    const a = (id: string) => p.roles[0].facts.find((f) => f.factId === id)!.alias;
    const u = p.users[0].alias;
    // Both results marked to keep are left out: the logging line proves a claim, so only the third bullet can give way.
    const w = readWriting(answer([{ facts: [a("fact1"), u], text: LOGGING }, { facts: [a("fact1")], text: "Built a logging layer for every model call" }]), p);
    const found = droppedStrong(w, bulletItems(w, p));
    expect(found.map((f) => f.bullet)).toEqual(["b2"]);
  });
});

describe("checks on what was written", () => {
  it("finds a summary sentence that joins results from different lines", () => {
    const merged = "Raised activation by 45% and handled 3x traffic. Builds with Claude Code.";
    expect(mergedResults(merged, plan)).toEqual(["Raised activation by 45% and handled 3x traffic."]);
    expect(mergedResults("Raised activation by 45%, cutting time to first value from 8 minutes to 1.", plan)).toEqual([]);
  });

  it("finds a tool the summary names that no bullet shows, but not one a bullet shows", () => {
    const p = { ...plan, terms: ["Rails", "React"] };
    const w = readWriting(
      answer([{ facts: [alias("fact3")], text: ONBOARDING }, { facts: [alias("fact1")], text: LOGGING }], { summary: "Engineer who builds React frontends on Rails and logs every LLM call in Postgres." }),
      p,
    );
    expect(unbackedInSummary(w, bulletItems(w, p), p)).toEqual(["Rails", "React"]);
  });

  it("finds a bullet that tells two separate results joined by a semicolon, not one result told in full", () => {
    const w = readWriting(answer([{ facts: [alias("fact2")], text: MIGRATION }, { facts: [alias("fact3")], text: ONBOARDING }]), plan);
    const found = twoStories(bulletItems(w, plan));
    expect(found.map((x) => [x.item.id, x.clauses])).toEqual([["b1", ["Migrated the platform to Next.js, handling 3x traffic", "cut support tickets by 36% with an AI chatbot"]]]);
  });

  it("finds a role that leaves out its strongest result while a bullet proves less", () => {
    const w = readWriting(answer([{ facts: [alias("fact1")], text: LOGGING }, { facts: [alias("fact2")], text: MIGRATION }]), plan);
    const found = droppedStrong(w, bulletItems(w, plan));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ bullet: "b1", kind: "dropped-strong" });
    expect(found[0].detail).toContain("increasing user activation by 45%");
  });

  it("finds a bullet or summary past its length, for the revision to shorten", () => {
    const long = `${ONBOARDING}, ${"with more detail ".repeat(30)}`;
    const w = readWriting(answer([{ facts: [alias("fact3")], text: long }], { summary: "x".repeat(800) }), plan);
    expect(tooLong(w, bulletItems(w, plan), plan).map((f) => [f.bullet, f.kind])).toEqual([
      ["summary", "too-long"],
      ["b1", "too-long"],
    ]);
  });

  it("finds a summary that repeats a bullet word for word, but not a shared name and number", () => {
    const w = readWriting(answer([{ facts: [alias("fact3")], text: ONBOARDING }], { summary: `Engineer. ${ONBOARDING}. Raised activation by 45% for new teams.` }), plan);
    expect(repeatedInSummary(w, bulletItems(w, plan))).toHaveLength(1);
    const own = readWriting(answer([{ facts: [alias("fact3")], text: ONBOARDING }], { summary: "Engineer who raised user activation by 45% with a rebuilt onboarding." }), plan);
    expect(repeatedInSummary(own, bulletItems(own, plan))).toEqual([]);
  });

  it("never asks a bullet to prove years of experience", () => {
    const years = withMap([{ userHas: true, note: "I make up for it in results", text: "Senior, roughly 5+ years with real ownership" }]);
    const p = planWriting(provenRecord(), job, years);
    const w = readWriting(answer([{ facts: [alias("fact3")], text: ONBOARDING }]), p);
    expect(unproven(bulletItems(w, p), p.users)).toEqual([]);
  });

  it("writes a job term for an area of work in lowercase inside a sentence, and leaves names alone", () => {
    const terms = ["Video streaming", "Realtime voice agents", "AI agents", "Claude Code"];
    expect(inSentenceCase("Built the Video streaming feature and captioning for Realtime Voice Agents with Claude Code", terms)).toBe(
      "Built the video streaming feature and captioning for realtime voice agents with Claude Code",
    );
    expect(inSentenceCase("Video streaming from desktop. AI agents in production", terms)).toBe("Video streaming from desktop. AI agents in production");
  });

  it("finds a tool moved into a line about other work, but not the posting's spelling of the line's own", () => {
    const w = readWriting(answer([{ facts: [alias("fact1")], text: "Built a logging layer in PostgreSQL that traces every Claude Code run" }]), plan);
    expect(addedNames(bulletItems(w, plan)[0], ["Claude Code", "PostgreSQL"])).toEqual(["Claude Code"]);
  });

  it("puts a bullet back as drafted when the revision moved a tool into it", () => {
    const withTerm = { ...plan, terms: ["Claude Code"] };
    const drafted = readWriting(answer([{ facts: [alias("fact1")], text: LOGGING }]), withTerm);
    const revised = readWriting(answer([{ facts: [alias("fact1")], text: "Built a logging layer that traces every Claude Code run in Postgres" }]), withTerm);
    const out = revertAddedNames(revised, drafted, withTerm);
    expect(out.reverted).toEqual(["b1"]);
    expect(out.written.roles[0].bullets[0].text).toBe(LOGGING);
  });
});

describe("reading what the writer chose", () => {
  // In a real draft the writer named its projects and certifications instead of giving their ids, and every one was
  // dropped without a word.
  it("finds a project, a certification or a role by its name when the writer wrote that instead of the id", () => {
    const projects = withMap([{ verdict: "met", refs: ["proj1"] }, { verdict: "met", refs: ["proj2"] }]);
    const p = planWriting(provenRecord(), job, projects);
    const named = readWriting(
      answer([{ facts: [p.roles[0].facts[0].alias], text: LOGGING }], {
        roles: [{ role: "Acme", bullets: [{ facts: [p.roles[0].facts[0].alias], text: LOGGING }] }],
        projects: [{ project: "Ledger toy", bullets: [{ text: "Designed a double-entry ledger with SQL" }] }],
        certifications: ["AWS Solutions Architect, Amazon"],
      }),
      p,
    );
    expect(named.projects.map((x) => x.plan.name)).toEqual(["Ledger toy"]);
    expect(named.certifications.map((c) => c.name)).toEqual(["AWS Solutions Architect"]);
    expect(named.roles[0].bullets[0].text).toBe(LOGGING);
  });

  it("matches by id first, then by the whole name, then by one unambiguous part of it", () => {
    const items = [
      { alias: "p1", name: "Job Search OS" },
      { alias: "p2", name: "GenSQL" },
      { alias: "p3", name: "GenSQL Cloud" },
    ];
    const names = (i: { name: string }) => [i.name];
    expect(offered("p2", items, names)?.alias).toBe("p2");
    expect(offered("job search os", items, names)?.alias).toBe("p1");
    expect(offered("GenSQL", items, names)?.alias).toBe("p2");
    expect(offered("Job Search OS platform", items, names)?.alias).toBe("p1");
    expect(offered("Cloud", items, names)).toBeUndefined();
    expect(offered("p9", items, names)).toBeUndefined();
  });

  it("flags a draft with no summary, or one that left a role out, for the revision to write", () => {
    const p = planWriting(provenRecord(), job, core);
    const w = readWriting(answer([{ facts: [alias("fact3")], text: ONBOARDING }], { summary: "" }), p);
    // The older role was left out: it holds its own lines, marked, and the revision is asked to write it.
    expect(w.roles[1]).toMatchObject({ fromRecord: true });
    expect(w.roles[0].fromRecord).toBeUndefined();
    const found = codeFindings(w, bulletItems(w, p), p, job, []).filter((f) => f.kind === "left-out");
    expect(found.find((f) => f.bullet === "summary")?.detail).toBe("is empty; write the summary");
    expect(found.filter((f) => f.detail.includes("at Initech (e2)"))).toHaveLength(1);
  });

  it("flags each project code chose for the job that the draft leaves out", () => {
    const p = planWriting(provenRecord(), job, withMap([{ verdict: "met", refs: ["proj1"] }]));
    const left = (projects: WriterAnswer["projects"]) => {
      const w = readWriting(answer([{ facts: [p.roles[0].facts[0].alias], text: LOGGING }], { projects }), p);
      return codeFindings(w, bulletItems(w, p), p, job, []).filter((f) => f.kind === "left-out" && f.detail.startsWith("leaves out the project")).map((f) => f.detail);
    };
    expect(p.projects.length).toBeGreaterThan(0);
    expect(left([])).toHaveLength(p.projects.length);
    expect(left([{ project: p.projects[0].alias, bullets: [{ text: "Built a payments ledger in SQL" }] }])).toHaveLength(p.projects.length - 1);
  });
});

describe("project bullets", () => {
  it("drop a bracketed list of the project's own technologies, which is printed above them", () => {
    const stack = ["Next.js", "TypeScript", "PostgreSQL"];
    expect(withoutRepeatedStack("Built a platform (Next.js, TypeScript and PostgreSQL) that serves 40 teams", stack)).toBe("Built a platform that serves 40 teams");
    expect(withoutRepeatedStack("Built a platform (for 40 teams, mostly remote, worldwide) in TypeScript", stack)).toBe("Built a platform (for 40 teams, mostly remote, worldwide) in TypeScript");
  });
});

describe("the review", () => {
  it("shows every line a bullet was written from, not only the first two", () => {
    const r = provenRecord();
    r.projects[0].wordings = ["Built a double-entry ledger", "Wrote a 50+ case test suite", "Added SQL injection checks"].map((t, i) => wording(`pw${i}`, t));
    const p = planWriting(r, job, withMap([{ verdict: "met", refs: ["proj1"] }]));
    const w = readWriting(answer([{ facts: [p.roles[0].facts[0].alias], text: LOGGING }], { projects: [{ project: "p1", bullets: [{ text: "Built a double-entry ledger with a 50+ case test suite and SQL injection checks" }] }] }), p);
    expect(renderDraft(w, bulletItems(w, p))).toContain("from the record: Added SQL injection checks");
  });

  it("keeps what a review cut off at its limit finished: its scores and complete edits", async () => {
    const cut = '{"scores":[{"criterion":"faithful","score":4,"note":"ok"}],"edits":[{"target":"b1","criterion":"proof","problem":"p","instruction":"i"},{"target":"summary","crit';
    const saved = reviewSchema(["b1"]).parse(salvageReview(closeCutJson(cut)));
    expect(saved).toEqual({ verdict: "revise", scores: [{ criterion: "faithful", score: 4, note: "ok" }], edits: [{ target: "b1", criterion: "proof", problem: "p", instruction: "i" }] });
    // Cut before it reached its edits, it is no review.
    expect(salvageReview(closeCutJson('{"scores":[{"criterion":"faithful","score":4,"note":"ok"}],"ed'))).toBeNull();

    const chat = vi.fn(async () => ({ scores: [], edits: [], verdict: "ready" }));
    const w = readWriting(answer([{ facts: [alias("fact3")], text: ONBOARDING }]), plan);
    await makeReviewer(chat as never)(w, bulletItems(w, plan), plan, job, core, []);
    expect((chat.mock.calls[0] as unknown[])[2]).toMatchObject({ maxTokens: 32_000, salvage: salvageReview });
  });
});

describe("the review prompt", () => {
  it("shows the posting's responsibilities and which claims have no detail", () => {
    const claims = withMap([{ userHas: true, note: "" }]);
    const p = planWriting(provenRecord(), job, claims);
    const w = readWriting(answer([{ facts: [alias("fact3")], text: ONBOARDING }]), p);
    const { system, user } = buildReviewPrompt(w, bulletItems(w, p), p, job, claims, []);
    expect(user).toContain("THE POSTING'S RESPONSIBILITIES");
    expect(user).toContain("- Own the payments roadmap");
    expect(user).toContain("Experience launching payments products (no detail given)");
    expect(system).toContain("The skills section is built by code from the candidate's record: score it, but list no edits for it.");
  });
});

describe("the header's location", () => {
  it("carries how the candidate meets the job's conditions, and leaves out a bare way of working the job's location makes evasive", () => {
    expect(headerLocation("Remote", "", true)).toBe("");
    expect(headerLocation("Remote | Open to relocate", "", true)).toBe("");
    // With no location set by the job, the candidate's own header stays as they wrote it.
    expect(headerLocation("Remote", "", false)).toBe("Remote");
    expect(headerLocation("Mumbai, India", "", true)).toBe("Mumbai, India");
    expect(headerLocation("Mumbai, India", "Open to relocating to Toronto", true)).toBe("Mumbai, India | Open to relocating to Toronto");
    expect(headerLocation("Remote", "Authorized to work in Canada", true)).toBe("Authorized to work in Canada");
  });

  it("takes a short mention out of the summary and into the header; a long one still closes the summary", () => {
    const p = { ...plan, mentions: ["Location: Canada, Remote (their note: moving to Toronto in March)"], jobLocation: "Canada, Remote" };
    const short = readWriting(answer([{ facts: [alias("fact3")], text: ONBOARDING }], { summary: "Engineer who ships.", mention: "Relocating to Toronto in March." }), p);
    expect([short.summary, short.mention, short.locationAsked]).toEqual(["Engineer who ships.", "Relocating to Toronto in March", true]);
    const line = "Relocating to Toronto in March, with a work permit already granted and no sponsorship needed.";
    const long = readWriting(answer([{ facts: [alias("fact3")], text: ONBOARDING }], { summary: "Engineer who ships.", mention: line }), p);
    expect([long.summary, long.mention]).toEqual([`Engineer who ships. ${line}`, ""]);
  });
});

// Trace acdb5f21352d4b4407820f3c1b35a053: the draft proved the user's MCP note in a project bullet; code took "MCP" for a
// name the bullet added, put back the project's first wording (cut off at "profile..."), and the page said it twice.
describe("a project bullet that proves a claim", () => {
  const MCP_NOTE = "JobSearchOS MCP Server: App exposes jobs, the career record and resume generation as tools.";
  const LONG = `Designed and built solo a self-hosted job-search platform that takes a role from a posting link to a sent outreach email. ${"Postings become structured records through a fetch pipeline. ".repeat(12)}Made history immutable from day one: profile versions are append-only.`;
  const SETUP = "Designed and built solo a self-hosted job-search platform that takes a role from a posting link to a sent outreach email";
  function mcpPlan() {
    const rec = provenRecord();
    rec.projects[0].wordings = [wording("pw1", LONG)];
    const reqs = withMap([{ verdict: "met", refs: ["proj1"] }]);
    const mcp = { ...reqs[0], id: "r9", kind: "keyword" as const, text: "MCP", use: "skill" as const, verdict: "met" as const, userHas: false, note: MCP_NOTE, refs: [] };
    return planWriting(rec, { ...job, technologies: ["MCP"] }, [...reqs, mcp]);
  }

  it("is never offered or put back cut off mid-sentence", () => {
    const p = mcpPlan();
    const offeredText = p.projects.find((x) => x.name === "Ledger toy")!.texts[0];
    expect(offeredText.length).toBeLessThanOrEqual(600);
    expect(offeredText).toMatch(/\.$/);
    expect(offeredText).not.toMatch(/\.\.\.$/);
    expect(clipAtSentence("One sentence here. Two three four five.", 20)).toBe("One sentence here.");
    expect(clipAtSentence("Short line.", 100)).toBe("Short line.");
  });

  it("names the claim it proves, and is kept", () => {
    const p = mcpPlan();
    const u = p.users.find((x) => x.text === "MCP")!.alias;
    const proj = p.projects.find((x) => x.name === "Ledger toy")!.alias;
    const mcp = "Exposed jobs, the career record and resume generation as tools through a JobSearchOS MCP Server";
    const w = readWriting(answer([{ facts: [alias("fact3")], text: ONBOARDING }], { projects: [{ project: proj, bullets: [{ text: SETUP }, { facts: [u], text: mcp }] }] }), p);
    expect(w.projects[0].bullets[1].userRequirementIds).toEqual(["r9"]);
    const named = revertAddedNames(w, w, p);
    const safe = revertRewrites(named.written, p);
    expect(safe.written.projects[0].bullets.map((b) => b.text)).toEqual([SETUP, mcp]);
    // Named but not cited, as the traced draft did: tied to the claim all the same.
    const uncited = readWriting(answer([{ facts: [alias("fact3")], text: ONBOARDING }], { projects: [{ project: proj, bullets: [{ text: mcp }] }] }), p);
    expect(uncited.projects[0].bullets[0].userRequirementIds).toEqual(["r9"]);
  });

  it("goes back to a wording that does not repeat a bullet above it, or is left out", () => {
    // With no claim to tie it to, the MCP bullet names a job term its lines do not: its only own wording repeats the first bullet.
    const p = { ...mcpPlan(), users: [] };
    const proj = p.projects.find((x) => x.name === "Ledger toy")!.alias;
    const w = readWriting(answer([{ facts: [alias("fact3")], text: ONBOARDING }], { projects: [{ project: proj, bullets: [{ text: SETUP }, { text: "Exposed the app's tools to Claude through an MCP Server" }] }] }), p);
    const out = revertAddedNames(w, w, p);
    expect(out.reverted).toHaveLength(1);
    expect(out.written.projects[0].bullets.map((b) => b.text)).toEqual([SETUP]);
  });

  it("is left out when it says what a bullet above it says", () => {
    const w = readWriting(answer([{ facts: [alias("fact3")], text: ONBOARDING }, { facts: [alias("fact2")], text: "Rebuilt onboarding, increasing user activation by 45%" }]), plan);
    const out = withoutRepeats(w);
    expect([out.dropped, out.written.roles[0].bullets.length]).toEqual([1, 1]);
  });
});

describe("a line split into two stories", () => {
  it("may run past the role's count, since it takes no other fact's place", () => {
    const p = { ...plan, roles: plan.roles.map((r, i) => (i === 0 ? { ...r, budget: 2 } : r)) };
    const w = readWriting(
      answer([
        { facts: [alias("fact2")], text: "Migrated the platform to Next.js, handling 3x traffic" },
        { facts: [alias("fact2")], text: "Cut support tickets by 36% with an AI chatbot" },
        { facts: [alias("fact3")], text: ONBOARDING },
        { facts: [alias("fact1")], text: LOGGING },
      ]),
      p,
    );
    expect(w.roles[0].bullets).toHaveLength(3);
  });
});

describe("the header's mention", () => {
  it("never names a place or anything else the candidate's note does not", () => {
    // The note said remote; the job said Canada; the candidate is in India.
    expect(headerMention("In Canada; can work remotely.", ["I can work remotely"])).toBe("Can work remotely");
    expect(headerMention("Relocating to Toronto in March", ["Relocating to Toronto in March, permit in hand"])).toBe("Relocating to Toronto in March");
    expect(headerMention("Open to relocating to Toronto.", [])).toBe("Open to relocating to Toronto");
  });
});
