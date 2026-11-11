import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { applicationQueue, applications } from "@/lib/db/schema";
import { emptyExtraction, type JobDraft } from "@/lib/jobs/schema";
import { saveJob } from "@/lib/jobs/service";
import { markSaved } from "@/lib/queue/service";
import { saveShortlistJob, shortlistNotes } from "@/lib/shortlist/save";
import { resetDb, testDb } from "./helpers";

process.env.DATABASE_URL ??= "postgres://unused";
vi.mock("@/lib/llm/openai", () => ({ chatClient: () => ({}) }));

const db = testDb();
beforeEach(() => resetDb(db));
afterAll(() => db.$client.end());

const publicDns = async () => ["93.184.215.14"];
const deps = () => ({ db, kick: vi.fn(), resolve: publicDns });

const pick = {
  url: "https://jobs.ashbyhq.com/prodigal/123?utm_source=shortlist",
  title: "Applied AI Engineer",
  company: "Prodigal",
  track: "AI/LLM",
  fit: 82,
  why: "LLM agents in production; risk: wants Go.",
  leadWith: "The voice-agent platform story",
  applyHow: "Email the founder a 50-100 word note",
  pay: "40-60 LPA",
  shortlistId: "prodigal-applied-ai-engineer",
};

function draft(sourceUrl: string): JobDraft {
  const e = {
    ...emptyExtraction(),
    company: "Prodigal",
    title: "Applied AI Engineer",
    location: "Bengaluru, India",
    responsibilities: ["Build agents"],
    requirements: { required: ["Python"], preferred: [] },
  };
  return { ...e, sourceUrl, fetchMethod: "ashby", ats: "ashby", atsJobId: "123", rawFileId: null, rawText: "raw", normalized: e };
}

const queueRow = async (id: string) => (await db.select().from(applicationQueue).where(eq(applicationQueue.id, id)))[0];

describe("shortlistNotes", () => {
  it("writes one labelled line per field sent", () => {
    expect(shortlistNotes(pick)).toBe(
      [
        "From the Daily Job Shortlist (fit 82%, AI/LLM)",
        "Lead with: The voice-agent platform story",
        "Apply: Email the founder a 50-100 word note",
        "Why: LLM agents in production; risk: wants Go.",
        "Pay: 40-60 LPA",
      ].join("\n"),
    );
    expect(shortlistNotes({ url: "https://x.example.com/1" })).toBe("From the Daily Job Shortlist");
  });
});

describe("saveShortlistJob", () => {
  it("queues a new URL with the notes and starts the worker", async () => {
    const d = deps();
    const res = await saveShortlistJob(pick, d);
    expect(res).toMatchObject({ state: "queued", appUrl: expect.stringMatching(/\/new$/) });
    if (res.state !== "queued") throw new Error("expected queued");
    const row = await queueRow(res.queueId);
    expect(row.status).toBe("queued");
    expect(row.notes).toBe(shortlistNotes(pick));
    expect(d.kick).toHaveBeenCalledOnce();
  });

  it("returns the same queue item when called again, even with a different tracking parameter", async () => {
    const first = await saveShortlistJob(pick, deps());
    const again = await saveShortlistJob({ ...pick, url: "https://jobs.ashbyhq.com/prodigal/123?utm_source=other" }, deps());
    expect(again).toEqual(first);
    expect(await db.select().from(applicationQueue)).toHaveLength(1);
  });

  it("says when the job is already in Jobs", async () => {
    const saved = await saveJob(draft("https://jobs.ashbyhq.com/prodigal/123"), db);
    if (!saved.ok) throw new Error("expected save");
    const res = await saveShortlistJob(pick, deps());
    expect(res).toEqual({ state: "in_jobs", jobId: saved.jobId, appUrl: expect.stringMatching(new RegExp(`/jobs\\?job=${saved.jobId}$`)) });
    expect(await db.select().from(applicationQueue)).toHaveLength(0);
  });

  it("does not add sites that block fetching", async () => {
    const res = await saveShortlistJob({ ...pick, url: "https://www.linkedin.com/jobs/view/1" }, deps());
    expect(res).toMatchObject({ state: "not_added", reason: expect.stringContaining("blocks automated fetching") });
  });

  it("does not add private or local addresses", async () => {
    for (const url of ["http://localhost:3000/new", "http://192.168.1.1/", "http://169.254.169.254/latest"]) {
      expect(await saveShortlistJob({ ...pick, url }, deps()), url).toMatchObject({ state: "not_added", reason: "Private or local addresses can't be fetched" });
    }
    const rebound = await saveShortlistJob(pick, { ...deps(), resolve: async () => ["10.0.0.5"] });
    expect(rebound).toMatchObject({ state: "not_added" });
    expect(await db.select().from(applicationQueue)).toHaveLength(0);
  });

  it("rejects input that is not a job pick", async () => {
    await expect(saveShortlistJob({ title: "No URL" }, deps())).rejects.toThrow();
    await expect(saveShortlistJob({ ...pick, fit: 140 }, deps())).rejects.toThrow();
  });
});

describe("markSaved", () => {
  it("copies the queued notes into the new application, without overwriting notes it already has", async () => {
    const res = await saveShortlistJob(pick, deps());
    if (res.state !== "queued") throw new Error("expected queued");
    const saved = await saveJob(draft("https://jobs.ashbyhq.com/prodigal/123"), db);
    if (!saved.ok) throw new Error("expected save");
    await markSaved(res.queueId, saved.jobId, "Prodigal - Applied AI Engineer", db);
    const [app] = await db.select().from(applications).where(eq(applications.jobId, saved.jobId));
    expect(app.notes).toBe(shortlistNotes(pick));

    await db.update(applications).set({ notes: "My own note" }).where(eq(applications.id, app.id));
    await markSaved(res.queueId, saved.jobId, "Prodigal - Applied AI Engineer", db);
    const [after] = await db.select().from(applications).where(eq(applications.id, app.id));
    expect(after.notes).toBe("My own note");
  });
});
