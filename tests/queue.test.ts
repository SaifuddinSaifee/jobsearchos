import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { applicationQueue, jobs } from "@/lib/db/schema";
import { FetchError, type FetchStep } from "@/lib/jobs/fetch/types";
import { runPipeline, type PipelineDeps, type PipelineInput, type PipelineResult } from "@/lib/jobs/pipeline";
import { emptyExtraction, type JobDraft } from "@/lib/jobs/schema";
import { saveJob } from "@/lib/jobs/service";
import { isClean, reviewReason } from "@/lib/queue/clean";
import {
  claimNext,
  clearFinished,
  enqueueText,
  enqueueUrls,
  getQueueDraft,
  listQueue,
  markNeedsReview,
  markSaved,
  removeItem,
  retryItem,
  sweepStale,
} from "@/lib/queue/service";
import { currentStep, progressOf } from "@/lib/queue/types";
import { processItem } from "@/lib/queue/worker";
import { resetDb, testDb } from "./helpers";

process.env.DATABASE_URL ??= "postgres://unused";
vi.mock("@/lib/llm/client", () => ({ together: () => ({}) }));

const db = testDb();
beforeEach(() => resetDb(db));
afterAll(() => db.$client.end());

function draft(n: number, over: Partial<JobDraft> = {}): JobDraft {
  const e = {
    ...emptyExtraction(),
    company: `Co${n}`,
    title: `Engineer ${n}`,
    location: "Austin, TX",
    responsibilities: ["Build things"],
    requirements: { required: ["Go"], preferred: [] },
  };
  return { ...e, sourceUrl: `https://example.com/jobs/${n}`, fetchMethod: "html", ats: null, atsJobId: null, rawFileId: null, rawText: "raw", normalized: e, ...over };
}

const rowOf = async (id: string) => (await db.select().from(applicationQueue).where(eq(applicationQueue.id, id)))[0];

describe("isClean", () => {
  it("needs company, title and some substance", () => {
    expect(isClean(draft(1))).toBe(true);
    expect(isClean(draft(1, { company: " " }))).toBe(false);
    expect(isClean(draft(1, { title: "" }))).toBe(false);
    expect(isClean(draft(1, { responsibilities: [], requirements: { required: [], preferred: ["Kafka"] } }))).toBe(false);
    expect(isClean(draft(1, { responsibilities: [], requirements: { required: ["Go"], preferred: [] } }))).toBe(true);
  });
  it("says what is missing", () => {
    expect(reviewReason(draft(1, { company: "", responsibilities: [], requirements: { required: [], preferred: [] } }))).toBe(
      "Could not find: company, responsibilities or requirements. Check and fix the fields, then save.",
    );
  });
});

describe("step helpers", () => {
  it("finds the running step, else the last finished one, and counts progress", () => {
    expect(currentStep({})).toBeNull();
    expect(currentStep({ detect: { status: "done" }, fetch: { status: "running", detail: "lever API" } })).toMatchObject({ name: "fetch", detail: "lever API" });
    expect(currentStep({ detect: { status: "done" }, render: { status: "skipped" } })).toMatchObject({ name: "render" });
    expect(progressOf({})).toBe(0);
    expect(progressOf({ detect: { status: "done" }, fetch: { status: "running" }, render: { status: "skipped" } })).toBeCloseTo(0.4);
  });
});

describe("enqueueUrls", () => {
  it("queues valid URLs in the order given and labels them", async () => {
    const r = await enqueueUrls(["https://boards.greenhouse.io/acme/jobs/1", "https://jobs.lever.co/acme/abc"], db);
    expect(r.queued).toHaveLength(2);
    const { items } = await listQueue(db);
    expect(items.map((i) => [i.status, i.label])).toEqual([["queued", "boards.greenhouse.io/acme/jobs/1"], ["queued", "jobs.lever.co/acme/abc"]]);
    // processing order is the pasted order, even though every row of a batch is inserted together
    const urls = Array.from({ length: 8 }, (_, i) => `https://a.com/p${i}`);
    const batch = await enqueueUrls(urls, db);
    expect(await claimNext(8, db)).toEqual([...r.queued, ...batch.queued].slice(0, 8));
  });

  it("reports (does not queue) invalid, blocked, repeated and already-saved URLs", async () => {
    const saved = await saveJob(draft(9, { sourceUrl: "https://example.com/jobs/9" }), db);
    expect(saved.ok).toBe(true);
    await enqueueUrls(["https://example.com/jobs/1"], db);
    const r = await enqueueUrls(
      ["not a url", "https://www.linkedin.com/jobs/view/1", "https://example.com/jobs/1?utm_source=x", "https://example.com/jobs/9", "https://example.com/jobs/2", "https://example.com/jobs/2/"],
      db,
    );
    expect(r.queued).toHaveLength(1);
    expect(Object.fromEntries(r.skipped.map((s) => [s.input, s.reason]))).toMatchObject({
      "not a url": expect.stringMatching(/valid URL/),
      "https://www.linkedin.com/jobs/view/1": expect.stringMatching(/Paste the job text/),
      "https://example.com/jobs/1?utm_source=x": "Already in the queue",
      "https://example.com/jobs/9": "Already saved in Jobs",
      "https://example.com/jobs/2/": "Already in the queue",
    });
  });

  it("limits a batch to 50", async () => {
    const urls = Array.from({ length: 55 }, (_, i) => `https://example.com/jobs/${i}`);
    const r = await enqueueUrls(urls, db);
    expect(r.queued).toHaveLength(50);
    expect(r.skipped).toHaveLength(5);
    expect(r.skipped[0].reason).toMatch(/at a time/);
  });
});

describe("enqueueText", () => {
  it("queues pasted text with the first line as its label, and validates", async () => {
    const r = await enqueueText("  \nSenior Go Engineer at Acme\nMore text", "https://example.com/jobs/5", db);
    expect(r.queued).toHaveLength(1);
    const row = await rowOf(r.queued[0]);
    expect(row).toMatchObject({ kind: "text", label: "Pasted: Senior Go Engineer at Acme", sourceUrl: "https://example.com/jobs/5" });
    await expect(enqueueText("   ", undefined, db)).rejects.toThrow(/Paste the job description/);
    await expect(enqueueText("x", "nope", db)).rejects.toThrow();
  });
  it("a pasted item with a URL blocks the same URL from being queued again", async () => {
    await enqueueText("Job text", "https://example.com/jobs/5", db);
    expect((await enqueueUrls(["https://example.com/jobs/5"], db)).skipped[0].reason).toBe("Already in the queue");
  });
});

describe("claimNext", () => {
  it("takes the oldest queued items first, up to the limit, and marks them running", async () => {
    const { queued } = await enqueueUrls(["https://a.com/1", "https://a.com/2", "https://a.com/3"], db);
    const first = await claimNext(2, db);
    expect(first).toEqual(queued.slice(0, 2));
    expect((await rowOf(first[0]))).toMatchObject({ status: "running", attempts: 1 });
    expect(await claimNext(5, db)).toEqual([queued[2]]);
    expect(await claimNext(5, db)).toEqual([]);
    expect(await claimNext(0, db)).toEqual([]);
  });

  it("never hands the same item to two concurrent claimers", async () => {
    await enqueueUrls(Array.from({ length: 6 }, (_, i) => `https://a.com/${i}`), db);
    const [a, b] = await Promise.all([claimNext(4, db), claimNext(4, db)]);
    expect(new Set([...a, ...b]).size).toBe(a.length + b.length);
    expect(a.length + b.length).toBe(6);
  });
});

describe("sweepStale", () => {
  it("requeues abandoned running items, fails them after three attempts, leaves fresh ones alone", async () => {
    const { queued } = await enqueueUrls(["https://a.com/1", "https://a.com/2", "https://a.com/3"], db);
    await claimNext(3, db);
    await db.execute(sql`UPDATE application_queue SET updated_at = now() - interval '5 minutes' WHERE id = ${queued[0]}`);
    await db.execute(sql`UPDATE application_queue SET updated_at = now() - interval '5 minutes', attempts = 3 WHERE id = ${queued[1]}`);
    expect(await sweepStale(db)).toBe(2);
    expect(await rowOf(queued[0])).toMatchObject({ status: "queued", steps: {} });
    expect(await rowOf(queued[1])).toMatchObject({ status: "failed", errorCode: "interrupted" });
    expect((await rowOf(queued[2])).status).toBe("running");
  });
});

describe("processItem (the pipeline is a fake)", () => {
  const fakeRun = (result: PipelineResult | Error, steps: FetchStep[] = []) =>
    (async (_input: PipelineInput, onStep?: (s: FetchStep) => void) => {
      for (const s of steps) onStep?.(s);
      if (result instanceof Error) throw result;
      return result;
    }) as typeof runPipeline;

  async function claimOne(url = "https://example.com/jobs/1") {
    const { queued } = await enqueueUrls([url], db);
    await claimNext(1, db);
    return queued[0];
  }

  it("saves a clean result, records the steps, and drops the draft", async () => {
    const id = await claimOne();
    const steps: FetchStep[] = [
      { step: "detect", status: "running" },
      { step: "detect", status: "done", detail: "lever" },
      { step: "structure", status: "done" },
    ];
    await processItem(id, { db, run: fakeRun({ type: "draft", draft: draft(1) }, steps) });
    const row = await rowOf(id);
    expect(row).toMatchObject({ status: "saved", label: "Co1 - Engineer 1", draft: null });
    expect(row.jobId).not.toBeNull();
    expect(row.steps).toMatchObject({ detect: { status: "done", detail: "lever" }, structure: { status: "done" } });
    expect(await db.select().from(jobs)).toHaveLength(1);
  });

  it("sends an incomplete result to review with its draft and the reason, and saves nothing", async () => {
    const id = await claimOne();
    await processItem(id, { db, run: fakeRun({ type: "draft", draft: draft(1, { title: "" }) }) });
    const row = await rowOf(id);
    expect(row).toMatchObject({ status: "needs_review", errorCode: "review", label: "Co1 - Untitled" });
    expect(row.error).toMatch(/Could not find: title/);
    expect(row.draft?.company).toBe("Co1");
    expect(await db.select().from(jobs)).toHaveLength(0);
  });

  it("records a duplicate from the pipeline", async () => {
    const existing = await saveJob(draft(2), db);
    if (!existing.ok) throw new Error("seed failed");
    const id = await claimOne();
    await processItem(id, { db, run: fakeRun({ type: "duplicate", job: { id: existing.jobId, company: "Co2", title: "Engineer 2" } }) });
    expect(await rowOf(id)).toMatchObject({ status: "duplicate", duplicateJobId: existing.jobId, label: "Co2 - Engineer 2" });
  });

  it("treats a save that loses a duplicate race as a duplicate", async () => {
    const existing = await saveJob(draft(3), db);
    if (!existing.ok) throw new Error("seed failed");
    const id = await claimOne();
    // Same company/title/location under another URL: the pipeline's early check missed it, the save catches it.
    await processItem(id, { db, run: fakeRun({ type: "draft", draft: draft(3, { sourceUrl: "https://other.com/x" }) }) });
    expect(await rowOf(id)).toMatchObject({ status: "duplicate", duplicateJobId: existing.jobId });
  });

  it("fails with a helpful message when the page blocks fetching", async () => {
    const id = await claimOne();
    await processItem(id, { db, run: fakeRun(new FetchError("blocked", "The site refused the request (HTTP 403)")) });
    const row = await rowOf(id);
    expect(row).toMatchObject({ status: "failed", errorCode: "blocked" });
    expect(row.error).toMatch(/refused.*Try pasting the job text/);
  });

  it("fails on any other error and keeps the steps reached so far", async () => {
    const id = await claimOne();
    await processItem(id, { db, run: fakeRun(new Error("model unavailable"), [{ step: "fetch", status: "done" }]) });
    expect(await rowOf(id)).toMatchObject({ status: "failed", error: "model unavailable", errorCode: "failed", steps: { fetch: { status: "done" } } });
  });

  it("ignores items that are not running (e.g. removed or already processed)", async () => {
    const { queued } = await enqueueUrls(["https://example.com/jobs/7"], db);
    const run = vi.fn();
    await processItem(queued[0], { db, run: run as unknown as typeof runPipeline });
    expect(run).not.toHaveBeenCalled();
    expect((await rowOf(queued[0])).status).toBe("queued");
  });

  it("passes pasted text and its URL to the pipeline", async () => {
    const { queued } = await enqueueText("Pasted posting", "https://example.com/jobs/8", db);
    await claimNext(1, db);
    const run = vi.fn<(input: PipelineInput) => Promise<PipelineResult>>(async () => ({ type: "draft", draft: draft(8) }));
    await processItem(queued[0], { db, run: run as unknown as typeof runPipeline });
    expect(run.mock.calls[0][0]).toEqual({ kind: "text", text: "Pasted posting", url: "https://example.com/jobs/8" });
  });
});

describe("managing items", () => {
  it("retries failed items only, and removes anything but running items", async () => {
    const { queued } = await enqueueUrls(["https://a.com/1", "https://a.com/2"], db);
    await claimNext(1, db); // queued[0] is running
    await db.execute(sql`UPDATE application_queue SET status = 'failed', error = 'x', attempts = 2 WHERE id = ${queued[1]}`);
    expect(await retryItem(queued[0], db)).toBe(false);
    expect(await retryItem(queued[1], db)).toBe(true);
    expect(await rowOf(queued[1])).toMatchObject({ status: "queued", error: null, attempts: 0 });
    expect(await removeItem(queued[0], db)).toBe(false);
    expect(await removeItem(queued[1], db)).toBe(true);
    expect(await rowOf(queued[1])).toBeUndefined();
  });

  it("clears finished items but keeps those waiting for a person or still working", async () => {
    const { queued } = await enqueueUrls(["https://a.com/1", "https://a.com/2", "https://a.com/3", "https://a.com/4"], db);
    await db.execute(sql`UPDATE application_queue SET status = 'saved' WHERE id = ${queued[0]}`);
    await db.execute(sql`UPDATE application_queue SET status = 'failed' WHERE id = ${queued[1]}`);
    await db.execute(sql`UPDATE application_queue SET status = 'needs_review' WHERE id = ${queued[2]}`);
    expect(await clearFinished(db)).toBe(2);
    expect((await listQueue(db)).items.map((i) => i.status).sort()).toEqual(["needs_review", "queued"]);
  });

  it("resolves a reviewed item as saved and drops its draft", async () => {
    const { queued } = await enqueueUrls(["https://example.com/jobs/1"], db);
    await markNeedsReview(queued[0], draft(1), "Co1 - Engineer 1", "check it", db);
    expect((await getQueueDraft(queued[0], db))?.draft?.company).toBe("Co1");
    const saved = await saveJob(draft(1), db);
    if (!saved.ok) throw new Error("save failed");
    await markSaved(queued[0], saved.jobId, "Co1 - Engineer 1", db);
    expect(await getQueueDraft(queued[0], db)).toMatchObject({ item: { status: "saved", jobId: saved.jobId }, draft: null });
  });

  it("lists in processing order with counts, without drafts or raw input", async () => {
    const { queued } = await enqueueUrls(["https://a.com/1"], db);
    await markNeedsReview(queued[0], draft(1), "Co1 - Engineer 1", "check it", db);
    const snap = await listQueue(db);
    expect(snap.counts).toMatchObject({ needs_review: 1, queued: 0 });
    expect(Object.keys(snap.items[0])).not.toContain("draft");
    expect(Object.keys(snap.items[0])).not.toContain("input");
    expect(await getQueueDraft("00000000-0000-4000-8000-000000000000", db)).toBeNull();
  });
});

describe("runPipeline (every dependency is a fake: no network, no AI, no search)", () => {
  const posting = {
    method: "greenhouse" as const,
    sourceUrl: "https://boards.greenhouse.io/acme/jobs/1",
    applicationUrl: "https://boards.greenhouse.io/acme/jobs/1",
    ats: "greenhouse",
    atsJobId: "1",
    raw: { body: "{}", mime: "application/json" },
    text: "Job text",
    hints: {},
  };
  const extraction = { ...emptyExtraction(), company: "Acme", title: "Backend Engineer", location: "Austin", aboutCompany: "Acme makes anvils." };

  function deps(over: Partial<PipelineDeps> = {}) {
    const calls = { fetch: 0, extract: 0, research: 0, search: 0 };
    const d: PipelineDeps = {
      fetchJob: (async () => (calls.fetch++, posting)) as PipelineDeps["fetchJob"],
      extractJob: (async () => (calls.extract++, { extraction, model: "m" })) as PipelineDeps["extractJob"],
      findDuplicate: async () => null,
      putFile: async () => ({ id: "file-1" }),
      findCompanyByName: async () => null,
      researchCompany: (async () => (calls.research++, { website: "", about: "A", principles: "", culture: "", sources: [], via: "company-site", log: { via: "company-site", queries: [], pages: [] } })) as PipelineDeps["researchCompany"],
      webSearch: () => (calls.search++, null),
      render: async () => "",
      ...over,
    };
    return { d, calls };
  }

  it("fetches, extracts, researches and returns a draft with the step sequence", async () => {
    const { d, calls } = deps();
    const steps: string[] = [];
    const r = await runPipeline({ kind: "url", url: "https://boards.greenhouse.io/acme/jobs/1" }, (s) => steps.push(`${s.step}:${s.status}`), d);
    expect(r.type).toBe("draft");
    if (r.type !== "draft") return;
    expect(r.draft).toMatchObject({ company: "Acme", sourceUrl: posting.sourceUrl, fetchMethod: "greenhouse", rawFileId: "file-1", rawText: "Job text" });
    expect(r.draft.companyNote).toMatch(/Researched from the company's own site/);
    expect(steps).toEqual(["structure:running", "structure:done", "company:running", "company:done"]);
    expect(calls).toMatchObject({ fetch: 1, extract: 1, research: 1 });
  });

  it("returns an existing job found by URL before fetching anything", async () => {
    const { d, calls } = deps({ findDuplicate: async (q) => (q.canonicalUrl ? { id: "j1", company: "Acme", title: "Backend Engineer" } : null) });
    const r = await runPipeline({ kind: "url", url: "https://boards.greenhouse.io/acme/jobs/1" }, undefined, d);
    expect(r).toEqual({ type: "duplicate", job: { id: "j1", company: "Acme", title: "Backend Engineer" } });
    expect(calls).toMatchObject({ fetch: 0, extract: 0 });
  });

  it("returns a duplicate found after extraction without researching the company", async () => {
    const { d, calls } = deps({ findDuplicate: async (q) => (q.dedupKey ? { id: "j2", company: "Acme", title: "Backend Engineer" } : null) });
    const r = await runPipeline({ kind: "url", url: "https://boards.greenhouse.io/acme/jobs/1" }, undefined, d);
    expect(r.type).toBe("duplicate");
    expect(calls).toMatchObject({ extract: 1, research: 0 });
  });

  it("skips research for a company already complete in the directory", async () => {
    const { d, calls } = deps({ findCompanyByName: (async () => ({ name: "Acme", about: "a", principles: "p", culture: "c", researchedAt: null })) as unknown as PipelineDeps["findCompanyByName"] });
    const r = await runPipeline({ kind: "url", url: "https://x.com/1" }, undefined, d);
    expect(calls.research).toBe(0);
    expect(r.type === "draft" && r.draft.companyNote).toMatch(/already in your company directory/);
  });

  it("records research problems as a note and still returns the draft", async () => {
    const { ResearchError } = await import("@/lib/companies/research");
    const { d } = deps({ researchCompany: (async () => { throw new ResearchError("No company website to read."); }) as PipelineDeps["researchCompany"] });
    const r = await runPipeline({ kind: "url", url: "https://x.com/1" }, undefined, d);
    expect(r.type === "draft" && r.draft.companyNote).toBe("Company research: No company website to read.");
  });

  it("reads pasted text without fetching, and checks an optional URL for duplicates first", async () => {
    const { d, calls } = deps();
    const steps: string[] = [];
    const r = await runPipeline({ kind: "text", text: " Pasted job ", url: "https://example.com/j/1" }, (s) => steps.push(`${s.step}:${s.status}`), d);
    expect(calls.fetch).toBe(0);
    expect(steps.slice(0, 3)).toEqual(["detect:skipped", "fetch:skipped", "render:skipped"]);
    expect(r.type === "draft" && r.draft).toMatchObject({ fetchMethod: "paste", sourceUrl: "https://example.com/j/1", rawText: "Pasted job" });
  });

  it("lets fetch errors through for the worker to record", async () => {
    const { d } = deps({ fetchJob: (async () => { throw new FetchError("not_found", "gone"); }) as PipelineDeps["fetchJob"] });
    await expect(runPipeline({ kind: "url", url: "https://x.com/1" }, undefined, d)).rejects.toMatchObject({ code: "not_found" });
    await expect(runPipeline({ kind: "text", text: "   " }, undefined, deps().d)).rejects.toMatchObject({ code: "empty" });
  });
});
