import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { applications, jobKeywords, jobs, jobSnapshots, statusEvents } from "@/lib/db/schema";
import { dedupKey, normalizeForDedup } from "@/lib/jobs/dedup";
import { mergeHints } from "@/lib/jobs/extract";
import { emptyExtraction, type JobDraft } from "@/lib/jobs/schema";
import { saveJob } from "@/lib/jobs/service";
import { resetDb, testDb } from "./helpers";

process.env.DATABASE_URL ??= "postgres://unused";
vi.mock("@/lib/llm/client", () => ({ together: () => ({}) }));

const db = testDb();
beforeEach(() => resetDb(db));
afterAll(() => db.$client.end());

function draft(over: Partial<JobDraft> = {}): JobDraft {
  const extraction = {
    ...emptyExtraction(),
    company: "Acme Inc.",
    title: "Backend Engineer",
    location: "Austin, TX",
    technologies: ["Go", "Postgres"],
    keywords: ["distributed systems", "Go", "go", "  "],
    responsibilities: ["Build APIs"],
    requirements: { required: ["3y Go"], preferred: [] },
    salaryMin: 150000.4,
    postedAt: "2026-05-01",
  };
  return {
    ...extraction,
    sourceUrl: "https://boards.greenhouse.io/acme/jobs/1?utm_source=x",
    fetchMethod: "greenhouse",
    ats: "greenhouse",
    atsJobId: "1",
    rawFileId: null,
    rawText: "raw jd text",
    normalized: extraction,
    ...over,
  };
}

describe("dedup", () => {
  it("normalizes case, punctuation and company suffixes", () => {
    expect(normalizeForDedup("Acme, Inc.")).toBe("acme");
    expect(dedupKey({ company: "ACME Inc", title: "Backend  Engineer", location: "Austin, TX" })).toBe(
      dedupKey({ company: "Acme", title: "backend engineer", location: "austin tx" }),
    );
    expect(dedupKey({ company: "Acme", title: "A", location: "" })).not.toBe(
      dedupKey({ company: "Acme", title: "B", location: "" }),
    );
  });
});

describe("mergeHints", () => {
  it("lets reliable source fields override the model", () => {
    const base = { ...emptyExtraction(), title: "Wrong", company: "Wrong", salaryMin: 1, salaryCurrency: "EUR" };
    const merged = mergeHints(base, { title: "Right", company: "Acme", salaryMin: 100, salaryMax: 200, salaryCurrency: "USD" });
    expect(merged).toMatchObject({ title: "Right", company: "Acme", salaryMin: 100, salaryMax: 200, salaryCurrency: "USD" });
  });
  it("ignores placeholder locations from the source", () => {
    const base = { ...emptyExtraction(), location: "Remote, US" };
    expect(mergeHints(base, { location: "LOCATION" }).location).toBe("Remote, US");
  });
  it("leaves model values where there is no hint", () => {
    const base = { ...emptyExtraction(), location: "Berlin", salaryMin: 5 };
    expect(mergeHints(base, {})).toEqual(base);
  });
});

describe("saveJob", () => {
  it("writes job, snapshot, keywords, application and first status event", async () => {
    const res = await saveJob(draft(), db);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const [job] = await db.select().from(jobs).where(eq(jobs.id, res.jobId));
    expect(job).toMatchObject({
      canonicalUrl: "https://boards.greenhouse.io/acme/jobs/1",
      company: "Acme Inc.",
      status: "saved",
      origin: "manual",
      salaryMin: 150000,
      postedAt: "2026-05-01",
    });
    expect(await db.select().from(jobSnapshots).where(eq(jobSnapshots.jobId, job.id))).toHaveLength(1);
    const kws = await db.select().from(jobKeywords).where(eq(jobKeywords.jobId, job.id));
    expect(kws.map((k) => k.keyword).sort()).toEqual(["Go", "distributed systems"]);
    const [app] = await db.select().from(applications).where(eq(applications.jobId, job.id));
    expect(app.status).toBe("saved");
    const events = await db.select().from(statusEvents).where(eq(statusEvents.applicationId, app.id));
    expect(events).toMatchObject([{ fromStatus: null, toStatus: "saved" }]);
  });

  it("detects a duplicate by canonical URL", async () => {
    await saveJob(draft(), db);
    const res = await saveJob(draft({ title: "Something else", sourceUrl: "https://boards.greenhouse.io/acme/jobs/1" }), db);
    expect(res.ok).toBe(false);
  });

  it("detects the same job under a different URL by company/title/location", async () => {
    await saveJob(draft(), db);
    const res = await saveJob(draft({ company: "ACME", sourceUrl: "https://acme.com/careers/backend" }), db);
    expect(res).toMatchObject({ ok: false, duplicate: { title: "Backend Engineer" } });
    expect(await db.select().from(jobs)).toHaveLength(1);
  });

  it("saves pasted text with no URL", async () => {
    const res = await saveJob(draft({ sourceUrl: "", fetchMethod: "paste", ats: null, atsJobId: null }), db);
    expect(res.ok).toBe(true);
    const [job] = await db.select().from(jobs);
    expect(job.canonicalUrl).toBeNull();
  });

  it("rolls back everything when a later insert fails", async () => {
    await expect(saveJob(draft({ fetchMethod: "bogus" as never }), db)).rejects.toThrow();
    expect(await db.select().from(jobs)).toHaveLength(0);
  });

  it("populates the search vector", async () => {
    await saveJob(draft(), db);
    const rows = await db.execute(sql`SELECT 1 FROM jobs WHERE search_vector @@ websearch_to_tsquery('english', 'backend postgres')`);
    expect(rows).toHaveLength(1);
  });

  it("job_snapshots rows are immutable", async () => {
    await saveJob(draft(), db);
    // drizzle wraps the Postgres error; the trigger's message is on `cause`
    for (const stmt of [sql`UPDATE job_snapshots SET raw_text = 'x'`, sql`DELETE FROM job_snapshots`]) {
      const err = await db.execute(stmt).then(() => null, (e: Error & { cause?: Error }) => e);
      expect(err?.cause?.message).toMatch(/immutable/);
    }
  });
});
