import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { documents, outreachEmails, pastResumes, resumeIndexes } from "@/lib/db/schema";
import { backfillDocuments } from "@/lib/documents/backfill";
import { getBaseDocument, latestVersion, listDocuments } from "@/lib/documents/service";
import { emptyExtraction, type JobDraft } from "@/lib/jobs/schema";
import { saveJob } from "@/lib/jobs/service";
import { saveVersion } from "@/lib/profile/service";
import { emptyProfile, type Profile } from "@/lib/profile/schema";
import { putFile } from "@/lib/storage/local";
import { DOCX_MIME } from "./docx";
import { resetDb, testDb } from "./helpers";

process.env.DATABASE_URL ??= "postgres://unused";
vi.mock("@/lib/llm/client", () => ({ together: () => ({}) }));

const db = testDb();
let dir: string;
beforeEach(async () => {
  await resetDb(db);
  dir = await mkdtemp(path.join(tmpdir(), "jt-backfill-"));
});
afterAll(async () => {
  await db.$client.end();
  if (dir) await rm(dir, { recursive: true, force: true });
});

function profile(): Profile {
  const p = emptyProfile();
  p.contact.name = "Jane Doe";
  p.summary = "Backend engineer.";
  p.experience = [{ company: "Acme", title: "Engineer", location: "", start: "2020", end: "", current: true, bullets: ["Built payments rails"] }];
  return p;
}

async function seedJob() {
  const e = { ...emptyExtraction(), company: "Acme", title: "Engineer", location: "Remote", technologies: [], keywords: [] };
  const draft: JobDraft = { ...e, sourceUrl: "https://boards.greenhouse.io/acme/jobs/1", fetchMethod: "greenhouse", ats: "greenhouse", atsJobId: "1", rawFileId: null, rawText: "raw", normalized: e };
  const r = await saveJob(draft, db);
  if (!r.ok) throw new Error("seed failed");
  return r;
}

async function pastResume(over: Partial<typeof pastResumes.$inferInsert> = {}, name = "past.docx") {
  const file = await putFile(Buffer.from(name), { mime: DOCX_MIME, originalName: name }, { dir, db });
  const [row] = await db
    .insert(pastResumes)
    .values({ fileId: file.id, title: "Resume for Globex", extractedText: "JANE DOE\n\nEXPERIENCE\nEngineer, Acme\n- Built payments rails", ...over })
    .returning();
  return { row, file };
}

describe("past resumes", () => {
  it("become library resumes with their details and text", async () => {
    const job = await seedJob();
    const { row, file } = await pastResume({ company: "Acme", role: "Engineer", jdText: "We want engineers", jdUrl: "https://x.test/jd", jobId: job.jobId, appliedAt: new Date("2026-03-04T10:00:00Z") });
    const out = await backfillDocuments(db);
    expect(out).toMatchObject({ pastResumes: 1, skipped: false });

    const [doc] = await db.select().from(documents).where(eq(documents.legacyPastResumeId, row.id));
    expect(doc).toMatchObject({
      kind: "resume",
      origin: "uploaded",
      title: "Resume for Globex",
      companyName: "Acme",
      targetRole: "Engineer",
      jdText: "We want engineers",
      jobId: job.jobId,
      writtenOn: "2026-03-04",
      sourceFileId: file.id,
      sourceName: "past.docx",
      isBase: false,
    });
    expect(doc.createdAt).toEqual(row.createdAt);
    const v = await latestVersion(doc.id, db);
    expect(v).toMatchObject({ version: 1, reason: "migrated" });
    expect(v?.plainText).toContain("Built payments rails");
  });

  it("use the old index's structured reading when there is one, and keep the text it had no place for", async () => {
    const { row, file } = await pastResume({ extractedText: "JANE DOE\n\nEXPERIENCE\nEngineer\n\nHOBBIES\nChess" });
    await db.insert(resumeIndexes).values({ fileId: file.id, status: "ready", parsed: profile() });
    await backfillDocuments(db);
    const [doc] = await db.select().from(documents).where(eq(documents.legacyPastResumeId, row.id));
    const v = await latestVersion(doc.id, db);
    expect(JSON.stringify(v?.content)).toContain("roleTitle");
    expect(v?.plainText).toContain("Chess");
  });

  it("run once only", async () => {
    await pastResume();
    await backfillDocuments(db);
    const again = await backfillDocuments(db);
    expect(again).toMatchObject({ pastResumes: 0, baseResume: false, sentEmails: 0 });
    expect(await db.select().from(documents)).toHaveLength(1);
  });
});

describe("base resume", () => {
  it("is made from the latest profile and marked as the base", async () => {
    const file = await putFile(Buffer.from("base"), { mime: DOCX_MIME, originalName: "base.docx" }, { dir, db });
    await saveVersion({ profile: profile(), baseResumeFileId: file.id }, db);
    const out = await backfillDocuments(db);
    expect(out.baseResume).toBe(true);
    const base = await getBaseDocument(db);
    expect(base).toMatchObject({ title: "Base resume", isBase: true, origin: "uploaded", sourceFileId: file.id });
    expect((await latestVersion(base!.id, db))?.plainText).toContain("Built payments rails");
  });

  it("is not made when there is no profile content, or a base already exists", async () => {
    await saveVersion({ profile: emptyProfile() }, db);
    expect((await backfillDocuments(db)).baseResume).toBe(false);
    await saveVersion({ profile: profile() }, db);
    expect((await backfillDocuments(db)).baseResume).toBe(true);
    await saveVersion({ profile: { ...profile(), summary: "Changed" } }, db);
    expect((await backfillDocuments(db)).baseResume).toBe(false);
    expect((await listDocuments({}, db)).filter((d) => d.isBase)).toHaveLength(1);
  });
});

describe("sent emails", () => {
  it("become locked email documents, and drafts are left out", async () => {
    const job = await seedJob();
    const sentAt = new Date("2026-05-01T08:00:00Z");
    const [sent] = await db.insert(outreachEmails).values({ jobId: job.jobId, status: "sent", subject: "Engineer at Acme", body: "Hi Sam,\n\nI would love to talk.", sentAt }).returning();
    await db.insert(outreachEmails).values({ jobId: job.jobId, status: "draft", subject: "Draft", body: "not sent" });

    expect((await backfillDocuments(db)).sentEmails).toBe(1);
    const [doc] = await db.select().from(documents).where(eq(documents.outreachEmailId, sent.id));
    expect(doc).toMatchObject({ kind: "email", origin: "sent", title: "Engineer at Acme", jobId: job.jobId });
    const v = await latestVersion(doc.id, db);
    expect(v).toMatchObject({ subject: "Engineer at Acme", reason: "sent" });
    expect(v?.lockedAt).toEqual(sentAt);
    expect(v?.plainText).toContain("I would love to talk.");
    expect((await backfillDocuments(db)).sentEmails).toBe(0);
  });
});

describe("a bad row", () => {
  it("does not stop the others", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    await pastResume({ extractedText: "JANE DOE\n\nSUMMARY\nFine." }, "a.docx");
    await pastResume({ extractedText: "x".repeat(600_000) }, "b.docx");
    await pastResume({ extractedText: "JOHN ROE\n\nSUMMARY\nAlso fine." }, "c.docx");
    expect((await backfillDocuments(db)).pastResumes).toBe(2);
    expect(quiet).toHaveBeenCalled();
    quiet.mockRestore();
  });
});
