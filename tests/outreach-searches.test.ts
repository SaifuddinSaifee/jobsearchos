import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { contactSearches, jobs } from "@/lib/db/schema";
import { resetEnv } from "@/lib/env";
import { emptyExtraction, type JobDraft } from "@/lib/jobs/schema";
import { saveJob } from "@/lib/jobs/service";
import {
  claimNextSearches,
  enqueueSearch,
  getSearchRow,
  latestSearchForJob,
  listSearches,
  markSearchDone,
  SEARCH_MAX_ATTEMPTS,
  sweepStaleSearches,
} from "@/lib/outreach/searches";
import { findContacts, listContacts, type FindDeps } from "@/lib/outreach/service";
import { isSearchActive, searchProgress } from "@/lib/outreach/types";
import { processSearch } from "@/lib/queue/worker";
import { resetDb, testDb } from "./helpers";

process.env.DATABASE_URL ??= "postgres://unused";
vi.mock("@/lib/llm/openai", () => ({ chatClient: () => ({}) }));

const db = testDb();
const savedKey = process.env.PROSPEO_API_KEY;

function job(n: number): JobDraft {
  const e = { ...emptyExtraction(), company: `Acme${n}`, title: `Data Engineer ${n}`, location: "Remote", technologies: [], keywords: [] };
  return {
    ...e,
    sourceUrl: `https://boards.greenhouse.io/acme${n}/jobs/${n}`,
    fetchMethod: "greenhouse",
    ats: "greenhouse",
    atsJobId: String(n),
    rawFileId: null,
    rawText: "Questions? Email Jane Doe, our recruiter.",
    normalized: e,
  };
}
async function seedJob(n = 1) {
  const r = await saveJob(job(n), db);
  if (!r.ok) throw new Error("seed failed");
  return r.jobId;
}
const row = (id: string) => getSearchRow(id, db).then((r) => r!);

beforeEach(async () => {
  process.env.PROSPEO_API_KEY = "prospeo-key";
  resetEnv();
  await resetDb(db);
});
afterEach(() => {
  if (savedKey === undefined) delete process.env.PROSPEO_API_KEY;
  else process.env.PROSPEO_API_KEY = savedKey;
  resetEnv();
});
afterAll(() => db.$client.end());

describe("enqueueSearch", () => {
  it("queues a search labelled with the job", async () => {
    const jobId = await seedJob();
    const { item, alreadyActive } = await enqueueSearch(jobId, db);
    expect(alreadyActive).toBe(false);
    expect(item).toMatchObject({ jobId, label: "Acme1 - Data Engineer 1", status: "queued", found: null, notes: [] });
    expect(isSearchActive(item)).toBe(true);
  });

  it("returns the running search instead of starting a second one", async () => {
    const jobId = await seedJob();
    const first = await enqueueSearch(jobId, db);
    const second = await enqueueSearch(jobId, db);
    expect(second.alreadyActive).toBe(true);
    expect(second.item.id).toBe(first.item.id);
    await claimNextSearches(1, db);
    expect((await enqueueSearch(jobId, db)).alreadyActive).toBe(true);
    expect(await db.select().from(contactSearches)).toHaveLength(1);
  });

  it("survives two requests at the same instant", async () => {
    const jobId = await seedJob();
    const [a, b] = await Promise.all([enqueueSearch(jobId, db), enqueueSearch(jobId, db)]);
    expect(a.item.id).toBe(b.item.id);
    expect(await db.select().from(contactSearches)).toHaveLength(1);
  });

  it("keeps only the latest finished result for a job", async () => {
    const jobId = await seedJob();
    const first = await enqueueSearch(jobId, db);
    await claimNextSearches(1, db);
    await markSearchDone(first.item.id, 3, ["a note"], db);
    const next = await enqueueSearch(jobId, db);
    expect(next.alreadyActive).toBe(false);
    expect(next.item.id).not.toBe(first.item.id);
    expect(await db.select().from(contactSearches)).toHaveLength(1);
  });

  it("refuses a job that does not exist or was deleted", async () => {
    await expect(enqueueSearch("00000000-0000-4000-8000-000000000000", db)).rejects.toThrow(/no longer exists/);
    const jobId = await seedJob();
    await db.update(jobs).set({ deletedAt: new Date() }).where(eq(jobs.id, jobId));
    await expect(enqueueSearch(jobId, db)).rejects.toThrow(/no longer exists/);
  });
});

describe("claiming and recovery", () => {
  it("claims oldest first, up to the free slots, and marks them running", async () => {
    const [a, b, c] = [await seedJob(1), await seedJob(2), await seedJob(3)];
    const ids = [(await enqueueSearch(a, db)).item.id, (await enqueueSearch(b, db)).item.id, (await enqueueSearch(c, db)).item.id];
    expect(await claimNextSearches(0, db)).toEqual([]);
    // Which ones are claimed is defined (the oldest); the order the rows come back in is not.
    expect((await claimNextSearches(2, db)).sort()).toEqual([ids[0], ids[1]].sort());
    expect(await row(ids[0])).toMatchObject({ status: "running", attempts: 1 });
    expect((await row(ids[2])).status).toBe("queued");
    expect(await claimNextSearches(2, db)).toEqual([ids[2]]);
  });

  it("puts a search that stopped reporting back in the queue", async () => {
    const jobId = await seedJob();
    const { item } = await enqueueSearch(jobId, db);
    await claimNextSearches(1, db);
    expect(await sweepStaleSearches(db)).toBe(0);
    await db.update(contactSearches).set({ updatedAt: new Date(Date.now() - 5 * 60_000) }).where(eq(contactSearches.id, item.id));
    expect(await sweepStaleSearches(db)).toBe(1);
    expect(await row(item.id)).toMatchObject({ status: "queued", steps: {} });
  });

  it("fails a search that was interrupted too many times", async () => {
    const jobId = await seedJob();
    const { item } = await enqueueSearch(jobId, db);
    await claimNextSearches(1, db);
    await db.update(contactSearches).set({ attempts: SEARCH_MAX_ATTEMPTS, updatedAt: new Date(Date.now() - 5 * 60_000) }).where(eq(contactSearches.id, item.id));
    await sweepStaleSearches(db);
    expect(await row(item.id)).toMatchObject({ status: "failed", error: expect.stringContaining("too many times") });
  });
});

describe("listing", () => {
  it("shows working searches and recent results, not old ones", async () => {
    const [a, b, c] = [await seedJob(1), await seedJob(2), await seedJob(3)];
    const working = await enqueueSearch(a, db);
    const recent = await enqueueSearch(b, db);
    const old = await enqueueSearch(c, db);
    await claimNextSearches(3, db);
    await markSearchDone(recent.item.id, 2, [], db);
    await markSearchDone(old.item.id, 2, [], db);
    await db.update(contactSearches).set({ finishedAt: new Date(Date.now() - 30 * 60_000) }).where(eq(contactSearches.id, old.item.id));
    const ids = (await listSearches(db)).map((s) => s.id);
    expect(ids).toContain(working.item.id);
    expect(ids).toContain(recent.item.id);
    expect(ids).not.toContain(old.item.id);
    expect((await latestSearchForJob(c, db))?.status).toBe("done");
    expect(await latestSearchForJob("00000000-0000-4000-8000-000000000000", db)).toBeNull();
  });
});

describe("searchProgress", () => {
  it("counts finished and skipped steps", () => {
    expect(searchProgress({})).toBe(0);
    expect(searchProgress({ posting: { status: "done" }, web: { status: "running" } })).toBeCloseTo(1 / 6);
    expect(
      searchProgress({
        yc: { status: "skipped" },
        posting: { status: "done" },
        web: { status: "skipped" },
        prospeo: { status: "done" },
        rank: { status: "done" },
        email: { status: "done" },
      }),
    ).toBe(1);
  });
});

const sources: FindDeps = {
  search: null,
  posting: async () => [{ name: "Jane Doe", title: "Recruiter", email: null, kind: "recruiter", evidence: "Email Jane Doe" }],
  lookup: async () => [{ personId: "p1", firstName: "John", lastName: "Smith", fullName: "John Smith", title: "Head of Data", linkedinUrl: null }],
  rank: async (_job, list) => list.map((c) => ({ id: c.id, kind: "hiring_manager" as const, score: 80, reason: "fits" })),
  // The automatic email lookup must never reach the network in tests.
  reveal: { enrich: async () => null, search: null },
};

describe("processSearch", () => {
  it("runs the search, records each step, saves the people and marks it done", async () => {
    const jobId = await seedJob();
    const { item } = await enqueueSearch(jobId, db);
    await claimNextSearches(1, db);
    await processSearch(item.id, { db, find: (id, d, database) => findContacts(id, { ...sources, ...d }, database) });

    const done = await row(item.id);
    expect(done).toMatchObject({ status: "done", found: 2, error: null });
    expect(done.steps).toEqual({
      yc: { status: "skipped", detail: "Not a Y Combinator job" },
      posting: { status: "done", detail: "1 person" },
      web: { status: "skipped", detail: "Not set up" },
      prospeo: { status: "done", detail: "1 person" },
      rank: { status: "done" },
      email: { status: "skipped", detail: "Needs the company website" },
    });
    expect(done.notes.join(" ")).toMatch(/TAVILY_API_KEY/);
    expect((await listContacts(jobId, db)).map((c) => c.name).sort()).toEqual(["Jane Doe", "John Smith"]);
  });

  it("records a source that failed without losing the others", async () => {
    const jobId = await seedJob();
    const { item } = await enqueueSearch(jobId, db);
    await claimNextSearches(1, db);
    const failing: FindDeps = { ...sources, lookup: async () => { throw new Error("boom"); } };
    await processSearch(item.id, { db, find: (id, d, database) => findContacts(id, { ...failing, ...d }, database) });
    const done = await row(item.id);
    expect(done.status).toBe("done");
    expect(done.found).toBe(1);
    expect(done.steps.prospeo?.status).toBe("failed");
  });

  it("marks the search failed when it throws", async () => {
    const jobId = await seedJob();
    const { item } = await enqueueSearch(jobId, db);
    await claimNextSearches(1, db);
    await processSearch(item.id, { db, find: async () => { throw new Error("database exploded"); } });
    expect(await row(item.id)).toMatchObject({ status: "failed", error: "database exploded" });
  });

  it("gives up on a search that takes too long", async () => {
    const jobId = await seedJob();
    const { item } = await enqueueSearch(jobId, db);
    await claimNextSearches(1, db);
    await processSearch(item.id, { db, timeoutMs: 20, find: () => new Promise(() => {}) });
    expect(await row(item.id)).toMatchObject({ status: "failed", error: "Timed out after 3 minutes" });
  });

  it("ignores a search that is not running", async () => {
    const jobId = await seedJob();
    const { item } = await enqueueSearch(jobId, db);
    const find = vi.fn();
    await processSearch(item.id, { db, find });
    expect(find).not.toHaveBeenCalled();
    expect((await row(item.id)).status).toBe("queued");
  });
});
