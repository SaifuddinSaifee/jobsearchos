import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { jobSnapshots } from "@/lib/db/schema";
import { FetchError, type FetchedPosting } from "@/lib/jobs/fetch/types";
import { refetchJob, undoRefetch, type RefetchDeps } from "@/lib/jobs/refetch";
import { emptyExtraction, type JobDraft, type JobExtraction } from "@/lib/jobs/schema";
import { deleteJobs, saveJob } from "@/lib/jobs/service";
import { getJobDetail, saveNotes } from "@/lib/jobs/tracker";
import { putFile } from "@/lib/storage/local";
import { resetDb, testDb } from "./helpers";

process.env.DATABASE_URL ??= "postgres://unused";
vi.mock("@/lib/llm/openai", () => ({ chatClient: () => ({}) }));

const db = testDb();
let dir = "";
beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "jt-refetch-"));
});
beforeEach(() => resetDb(db));
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
  await db.$client.end();
});

const URL = "https://boards.greenhouse.io/acme/jobs/1";

async function save(over: Partial<JobDraft> = {}) {
  const e = { ...emptyExtraction(), company: "Acme", title: "Engineer", location: "Austin, TX", keywords: ["go"] };
  const res = await saveJob(
    { ...e, sourceUrl: URL, fetchMethod: "greenhouse", ats: "greenhouse", atsJobId: "1", rawFileId: null, rawText: "old posting", normalized: e, ...over },
    db,
  );
  if (!res.ok) throw new Error("expected a new job");
  return res;
}

const fresh = (over: Partial<JobExtraction> = {}): JobExtraction => ({
  ...emptyExtraction(),
  company: "Acme",
  title: "Senior Engineer",
  location: "Remote",
  responsibilities: ["Build the new thing"],
  applyNotes: [{ kind: "where", text: "Apply through the form", link: "https://forms.gle/x" }],
  keywords: ["rust", "kafka"],
  ...over,
});

const posting = (text: string): FetchedPosting => ({
  method: "greenhouse",
  sourceUrl: URL,
  applicationUrl: `${URL}/apply`,
  ats: "greenhouse",
  atsJobId: "1",
  raw: { body: text, mime: "text/plain" },
  text,
  hints: { title: "Staff Engineer" },
});

function deps(over: Partial<RefetchDeps> = {}) {
  const calls = { fetched: [] as string[], read: [] as string[], hints: [] as unknown[], strict: [] as unknown[] };
  const d: RefetchDeps = {
    fetchJob: async (url, opts) => {
      calls.fetched.push(url);
      calls.strict.push(opts?.goneIsFinal);
      return posting("new posting");
    },
    extractJob: async (text, hints = {}) => {
      calls.read.push(text);
      calls.hints.push(hints);
      return { extraction: fresh(), model: "test" };
    },
    putFile: (bytes, meta) => putFile(bytes, meta, { dir, db }),
    ...over,
  };
  return { d, calls };
}

const snapshots = (jobId: string) => db.select().from(jobSnapshots).where(eq(jobSnapshots.jobId, jobId));

describe("refetching a job", () => {
  it("fetches the link again, replaces the details and keeps status and notes", async () => {
    const a = await save();
    await saveNotes(a.applicationId, "Talked to Sam", db);
    const { d, calls } = deps();

    const out = await refetchJob(a.jobId, "auto", db, d);

    expect(out).toMatchObject({ type: "updated", source: "site", removedCompanies: [] });
    expect(calls.fetched).toEqual([URL]);
    // Saved through the Greenhouse API, so a not found there means the posting is gone.
    expect(calls.strict).toEqual([true]);
    expect(calls.read).toEqual(["new posting"]);
    expect(calls.hints).toEqual([{ title: "Staff Engineer" }]);
    const job = (await getJobDetail(a.jobId, db))!;
    expect(job.title).toBe("Senior Engineer");
    expect(job.location).toBe("Remote");
    expect(job.responsibilities).toEqual(["Build the new thing"]);
    expect(job.applyNotes).toEqual([{ kind: "where", text: "Apply through the form", link: "https://forms.gle/x" }]);
    expect(job.keywords.sort()).toEqual(["kafka", "rust"]);
    expect(job.applyUrl).toBe(`${URL}/apply`);
    expect(job.status).toBe("saved");
    expect(job.notes).toBe("Talked to Sam");
    expect(job.snapshot?.rawText).toBe("new posting");
    expect(await snapshots(a.jobId)).toHaveLength(2);
  });

  it("reads the saved text again for a pasted job, without fetching or adding a snapshot", async () => {
    const a = await save({ fetchMethod: "paste", ats: null, atsJobId: null });
    const { d, calls } = deps();

    const out = await refetchJob(a.jobId, "auto", db, d);

    expect(out).toMatchObject({ type: "updated", source: "saved-text" });
    expect(calls.fetched).toEqual([]);
    expect(calls.read).toEqual(["old posting"]);
    expect((await getJobDetail(a.jobId, db))!.title).toBe("Senior Engineer");
    expect(await snapshots(a.jobId)).toHaveLength(1);
  });

  it("reports a site that cannot be fetched without changing the job, and can use the saved text instead", async () => {
    const a = await save();
    const { d, calls } = deps({
      fetchJob: async () => {
        throw new FetchError("not_found", "The posting is gone.");
      },
    });

    expect(await refetchJob(a.jobId, "auto", db, d)).toEqual({ type: "fetch-failed", message: "The posting is gone.", canUseSavedText: true });
    expect(calls.read).toEqual([]);
    expect((await getJobDetail(a.jobId, db))!.title).toBe("Engineer");

    expect(await refetchJob(a.jobId, "saved-text", db, d)).toMatchObject({ type: "updated", source: "saved-text" });
    expect(calls.read).toEqual(["old posting"]);
    expect((await getJobDetail(a.jobId, db))!.title).toBe("Senior Engineer");
  });

  it("keeps the saved company and title when the new extraction has none", async () => {
    const a = await save();
    const { d } = deps({ extractJob: async () => ({ extraction: fresh({ company: "", title: " " }), model: "test" }) });
    await refetchJob(a.jobId, "auto", db, d);
    const job = (await getJobDetail(a.jobId, db))!;
    expect([job.company, job.title]).toEqual(["Acme", "Engineer"]);
  });

  it("passes other errors on and refuses deleted jobs", async () => {
    const a = await save();
    const { d } = deps({
      extractJob: async () => {
        throw new Error("Output was cut off (max_tokens); the input may be too long");
      },
    });
    await expect(refetchJob(a.jobId, "auto", db, d)).rejects.toThrow("cut off");
    expect((await getJobDetail(a.jobId, db))!.title).toBe("Engineer");

    await deleteJobs([a.jobId], db);
    await expect(refetchJob(a.jobId, "auto", db, deps().d)).rejects.toThrow("Job not found");
  });

  it("can be undone: the old fields come back and the old posting text is current again", async () => {
    const a = await save({ applyNotes: [{ kind: "deadline", text: "Apply by Friday", link: "" }], keywords: ["go", "sql"] });
    const before = (await getJobDetail(a.jobId, db))!;
    const out = await refetchJob(a.jobId, "auto", db, deps().d);
    if (out.type !== "updated") throw new Error("expected an update");
    expect((await getJobDetail(a.jobId, db))!.snapshot?.rawText).toBe("new posting");

    await undoRefetch(a.jobId, out.undo, db);

    const after = (await getJobDetail(a.jobId, db))!;
    expect(after.title).toBe("Engineer");
    expect(after.location).toBe("Austin, TX");
    expect(after.applyNotes).toEqual(before.applyNotes);
    expect(after.keywords.sort()).toEqual(["go", "sql"]);
    expect(after.applyUrl).toBe(before.applyUrl);
    expect(after.snapshot?.rawText).toBe("old posting");
    expect(await snapshots(a.jobId)).toHaveLength(3);
  });

  it("undoes a re-read of the saved text without adding a snapshot", async () => {
    const a = await save({ fetchMethod: "paste", ats: null, atsJobId: null });
    const out = await refetchJob(a.jobId, "auto", db, deps().d);
    if (out.type !== "updated") throw new Error("expected an update");
    expect(out.undo.restoreSnapshotId).toBeNull();
    await undoRefetch(a.jobId, out.undo, db);
    expect((await getJobDetail(a.jobId, db))!.title).toBe("Engineer");
    expect(await snapshots(a.jobId)).toHaveLength(1);
  });
});
