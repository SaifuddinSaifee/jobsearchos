import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { resumeIndexes } from "@/lib/db/schema";
import { textToDoc } from "@/lib/documents/convert/text-to-doc";
import { createDocument, latestVersion, listVersions, saveDraft, softDelete } from "@/lib/documents/service";
import { emptyExtraction, type JobDraft } from "@/lib/jobs/schema";
import { saveJob } from "@/lib/jobs/service";
import { changeStatus, changeStatusBulk, revertStatus } from "@/lib/jobs/tracker";
import { getIndexRowForVersion } from "@/lib/resume/indexing";
import { resetDb, testDb } from "./helpers";

process.env.DATABASE_URL ??= "postgres://unused";
vi.mock("@/lib/llm/client", () => ({ together: () => ({}) }));

const db = testDb();
beforeEach(() => resetDb(db));
afterAll(() => db.$client.end());

async function seed(n = 1) {
  const e = { ...emptyExtraction(), company: `Co${n}`, title: `Engineer ${n}`, location: "Remote", technologies: [], keywords: [] };
  const draft: JobDraft = { ...e, sourceUrl: `https://boards.greenhouse.io/co${n}/jobs/${n}`, fetchMethod: "greenhouse", ats: "greenhouse", atsJobId: String(n), rawFileId: null, rawText: "raw", normalized: e };
  const r = await saveJob(draft, db);
  if (!r.ok) throw new Error("seed failed");
  return r;
}

const resume = (text = "JANE DOE\n\nSUMMARY\nBuilds things.") => textToDoc(text);
const letter = (text = "Dear team") => textToDoc(text, { mode: "letter" });

async function docsFor(jobId: string) {
  const a = await createDocument({ kind: "resume", origin: "uploaded", title: "Resume", content: resume(), jobId }, db);
  const b = await createDocument({ kind: "cover_letter", origin: "blank", title: "Letter", content: letter(), jobId }, db);
  const c = await createDocument({ kind: "email", origin: "blank", title: "Email", content: letter("Hi"), jobId }, db);
  return { resume: a.document, letter: b.document, email: c.document };
}

const locked = async (id: string) => (await latestVersion(id, db))?.lockedAt != null;

describe("marking a job Applied", () => {
  it("locks the job's resume and cover letter, and nothing else", async () => {
    const job = await seed();
    const other = await seed(2);
    const docs = await docsFor(job.jobId);
    const unrelated = await createDocument({ kind: "resume", origin: "blank", title: "Other", content: resume(), jobId: other.jobId }, db);

    await changeStatus(job.applicationId, "applied", {}, db);
    expect(await locked(docs.resume.id)).toBe(true);
    expect(await locked(docs.letter.id)).toBe(true);
    expect(await locked(docs.email.id)).toBe(false);
    expect(await locked(unrelated.document.id)).toBe(false);
    expect((await latestVersion(docs.resume.id, db))?.lockedJobId).toBe(job.jobId);
  });

  it("does not lock anything for other status changes", async () => {
    const job = await seed();
    const docs = await docsFor(job.jobId);
    await changeStatus(job.applicationId, "preparing", {}, db);
    expect(await locked(docs.resume.id)).toBe(false);
  });

  it("saves edits that were not yet a version, so what is locked is what was written", async () => {
    const job = await seed();
    const docs = await docsFor(job.jobId);
    await saveDraft(docs.resume.id, { content: resume("JANE DOE\n\nSUMMARY\nEdited just before applying."), revision: 1 }, db);

    await changeStatus(job.applicationId, "applied", {}, db);
    const versions = await listVersions(docs.resume.id, db);
    expect(versions.map((v) => [v.version, v.reason, v.lockedAt !== null])).toEqual([
      [2, "applied", true],
      [1, "upload", false],
    ]);
    expect((await latestVersion(docs.resume.id, db))?.plainText).toContain("Edited just before applying.");
  });

  it("queues the new resume version for search", async () => {
    const job = await seed();
    const docs = await docsFor(job.jobId);
    await saveDraft(docs.resume.id, { content: resume("JANE DOE\n\nSUMMARY\nEdited."), revision: 1 }, db);
    await changeStatus(job.applicationId, "applied", {}, db);
    const v = await latestVersion(docs.resume.id, db);
    expect((await getIndexRowForVersion(v!.id, db))?.status).toBe("queued");
    // A cover letter is not embedded.
    const letterVersion = await latestVersion(docs.letter.id, db);
    expect(await getIndexRowForVersion(letterVersion!.id, db)).toBeNull();
    expect((await db.select().from(resumeIndexes).where(eq(resumeIndexes.documentVersionId, v!.id))).length).toBe(1);
  });

  it("covers bulk changes", async () => {
    const a = await seed(1);
    const b = await seed(2);
    const da = await docsFor(a.jobId);
    const dbb = await docsFor(b.jobId);
    await changeStatusBulk([a.applicationId, b.applicationId], "applied", {}, db);
    expect(await locked(da.resume.id)).toBe(true);
    expect(await locked(dbb.resume.id)).toBe(true);
  });

  it("is not undone by undoing the status, and a second Applied makes no extra versions", async () => {
    const job = await seed();
    const docs = await docsFor(job.jobId);
    const res = await changeStatus(job.applicationId, "applied", {}, db);
    await revertStatus(res.previous, db);
    expect(await locked(docs.resume.id)).toBe(true);

    await changeStatus(job.applicationId, "applied", {}, db);
    expect((await listVersions(docs.resume.id, db)).length).toBe(1);
  });

  it("makes a locked document undeletable", async () => {
    const job = await seed();
    const docs = await docsFor(job.jobId);
    await changeStatus(job.applicationId, "applied", {}, db);
    await expect(softDelete(docs.resume.id, db)).rejects.toMatchObject({ code: "blocked" });
  });

  it("ignores documents that were deleted", async () => {
    const job = await seed();
    const docs = await docsFor(job.jobId);
    await softDelete(docs.letter.id, db);
    await changeStatus(job.applicationId, "applied", {}, db);
    expect(await locked(docs.letter.id)).toBe(false);
    expect(await locked(docs.resume.id)).toBe(true);
  });
});
