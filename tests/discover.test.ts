import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { applications, discoveredJobs } from "@/lib/db/schema";
import { addDiscoveredAgain, dismissDiscovered, listDiscovered, restoreDiscovered } from "@/lib/discover/service";
import { discoverState } from "@/lib/discover/types";
import { emptyExtraction, type JobDraft } from "@/lib/jobs/schema";
import { deleteJobs, saveJob } from "@/lib/jobs/service";
import { markDuplicate, markFailed, markNeedsReview, markSaved, removeItem } from "@/lib/queue/service";
import { saveShortlistJob, SHORTLIST_SOURCE } from "@/lib/shortlist/save";
import { resetDb, testDb } from "./helpers";

process.env.DATABASE_URL ??= "postgres://unused";
vi.mock("@/lib/llm/openai", () => ({ chatClient: () => ({}) }));

const db = testDb();
beforeEach(() => resetDb(db));
afterAll(() => db.$client.end());

const deps = () => ({ db, kick: vi.fn(), resolve: async () => ["93.184.215.14"] });
const URL1 = "https://jobs.ashbyhq.com/prodigal/123";
const pick = { url: URL1, title: "Applied AI Engineer", company: "Prodigal", track: "AI/LLM", fit: 82, why: "Agents in production.", leadWith: "Voice agents", shortlistId: "prodigal-applied-ai-engineer" };

function draft(sourceUrl: string, title = "Applied AI Engineer"): JobDraft {
  const e = { ...emptyExtraction(), company: "Prodigal", title, location: "Bengaluru, India", responsibilities: ["Build"], requirements: { required: ["Python"], preferred: [] } };
  return { ...e, sourceUrl, fetchMethod: "ashby", ats: "ashby", atsJobId: "1", rawFileId: null, rawText: "raw", normalized: e };
}

async function queued(input: object = pick) {
  const res = await saveShortlistJob(input, deps());
  if (res.state !== "queued") throw new Error(`expected queued, got ${res.state}`);
  return res.queueId;
}

const only = async () => {
  const list = await listDiscovered(db);
  expect(list).toHaveLength(1);
  return list[0];
};

describe("discoverState", () => {
  it("prefers a live job, then the queue, then the reason it was not added", () => {
    expect(discoverState({ jobId: "j", queueStatus: "failed", notAddedReason: null })).toBe("in_jobs");
    expect(discoverState({ jobId: null, queueStatus: "running", notAddedReason: null })).toBe("reading");
    expect(discoverState({ jobId: null, queueStatus: "needs_review", notAddedReason: null })).toBe("review");
    expect(discoverState({ jobId: null, queueStatus: "failed", notAddedReason: null })).toBe("failed");
    expect(discoverState({ jobId: null, queueStatus: null, notAddedReason: "Blocked" })).toBe("not_added");
    expect(discoverState({ jobId: null, queueStatus: "saved", notAddedReason: null })).toBe("gone");
  });
});

describe("recording picks", () => {
  it("lists a sent pick as Claude.ai, being read, with the shortlist's fields", async () => {
    const queueId = await queued();
    expect(await only()).toMatchObject({
      source: SHORTLIST_SOURCE,
      url: URL1,
      title: "Applied AI Engineer",
      company: "Prodigal",
      fit: 82,
      why: "Agents in production.",
      leadWith: "Voice agents",
      state: "reading",
      queueId,
      jobId: null,
    });
  });

  it("keeps one row per posting and takes the latest fields", async () => {
    await queued();
    await saveShortlistJob({ ...pick, url: `${URL1}?utm_source=x`, fit: 90, why: "Updated." }, deps());
    expect(await only()).toMatchObject({ fit: 90, why: "Updated.", state: "reading" });
  });

  it("lists a blocked site as not added, with the reason", async () => {
    await saveShortlistJob({ ...pick, url: "https://www.linkedin.com/jobs/view/1" }, deps());
    const job = await only();
    expect(job.state).toBe("not_added");
    expect(job.reason).toContain("blocks automated fetching");
  });

  it("does not record private or invalid URLs", async () => {
    await saveShortlistJob({ ...pick, url: "http://localhost:3000/new" }, deps());
    await saveShortlistJob({ ...pick, url: "not a url" }, deps());
    expect(await listDiscovered(db)).toEqual([]);
  });
});

describe("where a discovered job is now", () => {
  it("follows the queue item through review and failure", async () => {
    const queueId = await queued();
    await markNeedsReview(queueId, draft(URL1, ""), "Prodigal - ", "Could not find: title. Check and fix the fields, then save.", db);
    expect(await only()).toMatchObject({ state: "review", reason: expect.stringContaining("Could not find: title") });
    await markFailed(queueId, "The posting was not found", "not_found", db);
    expect(await only()).toMatchObject({ state: "failed", reason: "The posting was not found" });
  });

  it("shows the job and its tracker status once saved", async () => {
    const queueId = await queued();
    const saved = await saveJob(draft(URL1), db);
    if (!saved.ok) throw new Error("expected save");
    await markSaved(queueId, saved.jobId, "Prodigal - Applied AI Engineer", db);
    await db.update(applications).set({ status: "applied" }).where(eq(applications.jobId, saved.jobId));
    expect(await only()).toMatchObject({ state: "in_jobs", jobId: saved.jobId, jobStatus: "applied", reason: null });
  });

  it("finds the job through the queue when it was saved under another URL", async () => {
    const queueId = await queued();
    const saved = await saveJob(draft("https://example.com/careers/applied-ai"), db);
    if (!saved.ok) throw new Error("expected save");
    await markDuplicate(queueId, saved.jobId, "Prodigal - Applied AI Engineer", db);
    expect(await only()).toMatchObject({ state: "in_jobs", jobId: saved.jobId });
  });

  it("is in Jobs straight away when the job was already saved", async () => {
    const saved = await saveJob(draft(URL1), db);
    if (!saved.ok) throw new Error("expected save");
    await saveShortlistJob(pick, deps());
    expect(await only()).toMatchObject({ state: "in_jobs", jobId: saved.jobId, queueId: null });
  });

  it("is gone when the job is deleted and its queue item cleared, and can be added again", async () => {
    const queueId = await queued();
    const saved = await saveJob(draft(URL1), db);
    if (!saved.ok) throw new Error("expected save");
    await markSaved(queueId, saved.jobId, "Prodigal - Applied AI Engineer", db);
    await deleteJobs([saved.jobId], db);
    await removeItem(queueId, db);
    const gone = await only();
    expect(gone).toMatchObject({ state: "gone", queueId: null });

    const d = deps();
    const res = await addDiscoveredAgain(gone.id, d);
    expect(res.state).toBe("queued");
    expect(d.kick).toHaveBeenCalledOnce();
    expect(await only()).toMatchObject({ state: "reading", leadWith: "Voice agents" });
    expect(await db.select().from(discoveredJobs)).toHaveLength(1);
  });
});

describe("removing from Discover", () => {
  it("hides the listing, leaves the job in Jobs, and comes back on Undo", async () => {
    const saved = await saveJob(draft(URL1), db);
    if (!saved.ok) throw new Error("expected save");
    await saveShortlistJob(pick, deps());
    const { id } = await only();

    expect(await dismissDiscovered([id], db)).toEqual([id]);
    expect(await listDiscovered(db)).toEqual([]);
    // Removing it twice removes nothing more, so Undo only restores what this removal hid.
    expect(await dismissDiscovered([id], db)).toEqual([]);

    await restoreDiscovered([id], db);
    expect(await only()).toMatchObject({ id, state: "in_jobs", jobId: saved.jobId });
  });

  it("comes back when the same posting is sent again", async () => {
    await queued();
    const { id } = await only();
    await dismissDiscovered([id], db);
    await saveShortlistJob({ ...pick, fit: 91 }, deps());
    expect(await only()).toMatchObject({ id, fit: 91 });
  });
});
