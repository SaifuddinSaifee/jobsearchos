import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { documentVersions, resumeChunks, resumeIndexes } from "@/lib/db/schema";
import type { DocJSON } from "@/lib/documents/build";
import { profileToDoc } from "@/lib/documents/convert/profile-to-doc";
import { blankContent } from "@/lib/documents/intake";
import { textToDoc } from "@/lib/documents/convert/text-to-doc";
import { createDocument, createVersion, latestVersion, saveDraft, softDelete } from "@/lib/documents/service";
import { emptyProfile, type Profile } from "@/lib/profile/schema";
import { EMBEDDING_DIMENSIONS } from "@/lib/resume/embed";
import {
  backfillResumeIndexes,
  claimNextIndexes,
  enqueueDocumentIndex,
  enqueueVersionIndex,
  getIndexRow,
  getIndexRowForVersion,
  listIndexInfo,
  processResumeIndex,
  searchResumeChunks,
  sweepStaleIndexes,
} from "@/lib/resume/indexing";
import { processIndex } from "@/lib/queue/worker";
import { saveVersion } from "@/lib/profile/service";
import { fileDisplayName, isKnownResumeFile } from "@/lib/resume/files";
import { putFile } from "@/lib/storage/local";
import { DOCX_MIME } from "./docx";
import { resetDb, testDb } from "./helpers";

process.env.DATABASE_URL ??= "postgres://unused";
vi.mock("@/lib/llm/openai", () => ({ chatClient: () => ({}) }));

const db = testDb();
let dir: string;

beforeEach(async () => {
  await resetDb(db);
  dir = await mkdtemp(path.join(tmpdir(), "jt-index-"));
});
afterAll(async () => {
  await db.$client.end();
  if (dir) await rm(dir, { recursive: true, force: true });
});

/** A fake embedding: one axis per keyword, so which section matches a query is predictable. */
const KEYWORDS = ["payments", "devrel", "latency"];
function fakeVector(text: string): number[] {
  const v = new Array(EMBEDDING_DIMENSIONS).fill(0);
  KEYWORDS.forEach((k, i) => {
    if (text.toLowerCase().includes(k)) v[i] = 1;
  });
  if (v.every((x) => x === 0)) v[EMBEDDING_DIMENSIONS - 1] = 1;
  return v;
}
const fakeEmbed = async (texts: string[]) => texts.map(fakeVector);

function profile(): Profile {
  const p = emptyProfile();
  p.experience = [
    { company: "Acme", title: "Engineer", location: "", start: "2020", end: "", current: true, bullets: ["Built payments rails", "Cut latency"] },
    { company: "Globex", title: "Developer Advocate", location: "", start: "2017", end: "2020", current: false, bullets: ["Ran the devrel program"] },
  ];
  return p;
}

const RAW_TEXT = "JANE DOE\n\nEXPERIENCE\nStaff Engineer, Acme\n- Cut p95 latency by 40%\n- Built payments rails for three markets\n\nHOBBIES\nChess and rowing";

/** A resume that is already structured (as if made from a profile). */
async function structuredResume(title = "Jane", content: DocJSON = profileToDoc(profile())) {
  return createDocument({ kind: "resume", origin: "blank", title, content }, db);
}

/** A resume as it comes out of an upload: only headings and bullets. */
async function uploadedResume(title = "Upload") {
  return createDocument({ kind: "resume", origin: "uploaded", title, content: textToDoc(RAW_TEXT) }, db);
}

async function claimOne(versionId: string) {
  const row = await getIndexRowForVersion(versionId, db);
  const ids = await claimNextIndexes(5, db);
  expect(ids).toContain(row!.id);
  return row!.id;
}

async function indexVersion(versionId: string, deps: Parameters<typeof processResumeIndex>[1] = {}) {
  await enqueueVersionIndex(versionId, {}, db);
  const id = await claimOne(versionId);
  await processResumeIndex(id, { db, embed: fakeEmbed, ...deps });
  return id;
}

describe("queueing", () => {
  it("queues a version once, however often it is asked", async () => {
    const { version } = await structuredResume();
    expect((await enqueueVersionIndex(version.id, {}, db)).status).toBe("queued");
    await enqueueVersionIndex(version.id, {}, db);
    expect(await db.select().from(resumeIndexes)).toHaveLength(1);
  });

  it("does not requeue a finished version unless forced, but does retry a failed one", async () => {
    const { version } = await structuredResume();
    await enqueueVersionIndex(version.id, {}, db);
    const set = (patch: Partial<typeof resumeIndexes.$inferInsert>) => db.update(resumeIndexes).set(patch).where(eq(resumeIndexes.documentVersionId, version.id));
    await set({ status: "ready", chunkCount: 3 });
    expect((await enqueueVersionIndex(version.id, {}, db)).status).toBe("ready");
    expect((await enqueueVersionIndex(version.id, { force: true }, db)).status).toBe("queued");

    await set({ status: "failed", error: "boom", attempts: 3 });
    const again = await enqueueVersionIndex(version.id, {}, db);
    expect(again.status).toBe("queued");
    expect(again.error).toBeNull();
    expect((await getIndexRowForVersion(version.id, db))?.attempts).toBe(0);
  });

  it("queues a document's latest version, resumes only", async () => {
    const { document, version } = await structuredResume();
    const info = await enqueueDocumentIndex(document.id, {}, db);
    expect(info).toMatchObject({ documentId: document.id, versionId: version.id, status: "queued" });
    const mail = await createDocument({ kind: "email", origin: "blank", title: "E", content: textToDoc("Hi", { mode: "letter" }) }, db);
    expect(await enqueueDocumentIndex(mail.document.id, {}, db)).toBeNull();
  });

  it("refuses an unknown version", async () => {
    await expect(enqueueVersionIndex("00000000-0000-4000-8000-000000000000", {}, db)).rejects.toThrow(/no longer exists/);
  });

  it("claims each queued version once and sweeps abandoned runs back to the queue", async () => {
    const a = await structuredResume("A");
    const b = await structuredResume("B");
    await enqueueVersionIndex(a.version.id, {}, db);
    await enqueueVersionIndex(b.version.id, {}, db);
    expect((await claimNextIndexes(1, db)).length).toBe(1);
    expect((await claimNextIndexes(5, db)).length).toBe(1);
    expect(await claimNextIndexes(5, db)).toEqual([]);

    await db.execute(sql`UPDATE resume_indexes SET updated_at = now() - interval '10 minutes'`);
    expect(await sweepStaleIndexes(db)).toBe(2);
    expect((await listIndexInfo({}, db)).map((i) => i.status)).toEqual(["queued", "queued"]);
  });

  it("never claims an index left over from the time files were indexed", async () => {
    const file = await putFile(Buffer.from("old"), { mime: DOCX_MIME, originalName: "old.docx" }, { dir, db });
    await db.insert(resumeIndexes).values({ fileId: file.id });
    expect(await claimNextIndexes(5, db)).toEqual([]);
  });

  it("backfills the latest version of resumes that have no index, and nothing else", async () => {
    const a = await structuredResume("A");
    await structuredResume("B");
    await createDocument({ kind: "cover_letter", origin: "blank", title: "L", content: textToDoc("Hi", { mode: "letter" }) }, db);
    await enqueueVersionIndex(a.version.id, {}, db);
    expect(await backfillResumeIndexes(db)).toBe(1);
    expect(await backfillResumeIndexes(db)).toBe(0);
    expect(await db.select().from(resumeIndexes)).toHaveLength(2);
  });

  it("reports the index of each resume's latest version only", async () => {
    const { document, version } = await structuredResume();
    await enqueueVersionIndex(version.id, {}, db);
    await saveDraft(document.id, { content: textToDoc("JANE DOE\n\nSUMMARY\nChanged."), revision: 1 }, db);
    const v2 = (await createVersion(document.id, { reason: "manual" }, db)).version;
    expect((await listIndexInfo({}, db)).map((i) => i.versionId)).toEqual([]);
    await enqueueVersionIndex(v2.id, {}, db);
    const info = await listIndexInfo({}, db);
    expect(info.map((i) => i.versionId)).toEqual([v2.id]);
    expect(await listIndexInfo({ documentIds: [] }, db)).toEqual([]);
  });
});

describe("processResumeIndex", () => {
  it("splits a structured resume into sections and stores an embedding for each", async () => {
    const { version } = await structuredResume();
    const id = await indexVersion(version.id);

    const row = await getIndexRow(id, db);
    expect(row).toMatchObject({ status: "ready", chunkCount: 2, error: null, note: null });
    expect(row?.parsed?.experience).toHaveLength(2);
    const chunks = await db.select().from(resumeChunks).where(eq(resumeChunks.documentVersionId, version.id)).orderBy(resumeChunks.ordinal);
    expect(chunks.map((c) => c.label)).toEqual(["Engineer at Acme", "Developer Advocate at Globex"]);
    expect(chunks[0].embedding).toHaveLength(EMBEDDING_DIMENSIONS);
  });

  it("structures an unedited upload into a new version, and indexes that one", async () => {
    const { document, version } = await uploadedResume();
    const parse = vi.fn(async () => profile());
    const id = await indexVersion(version.id, { parse });

    expect(parse).toHaveBeenCalledOnce();
    expect(await getIndexRow(id, db)).toMatchObject({ status: "ready", chunkCount: 0, note: "Replaced by a structured version." });
    const v2 = await latestVersion(document.id, db);
    expect(v2).toMatchObject({ version: 2, reason: "structured" });
    expect(v2?.plainText).toContain("Developer Advocate");
    // The section a profile has no place for is carried over, so structuring loses no text.
    expect(v2?.plainText).toContain("Chess and rowing");

    const next = await getIndexRowForVersion(v2!.id, db);
    expect(next?.status).toBe("queued");
    await processResumeIndex(await claimOne(v2!.id), { db, embed: fakeEmbed, parse });
    expect(parse).toHaveBeenCalledOnce();
    expect((await getIndexRowForVersion(v2!.id, db))?.status).toBe("ready");
    expect((await db.select().from(resumeChunks).where(eq(resumeChunks.documentVersionId, v2!.id))).length).toBeGreaterThan(0);
  });

  it("falls back to paragraphs and says so when the resume cannot be structured", async () => {
    const { document, version } = await uploadedResume();
    const id = await indexVersion(version.id, {
      parse: async () => {
        throw new Error("no API key");
      },
    });
    const row = await getIndexRow(id, db);
    expect(row?.status).toBe("ready");
    expect(row?.note).toMatch(/no API key.*split by paragraph/);
    expect((await db.select().from(resumeChunks)).length).toBeGreaterThan(0);
    expect((await latestVersion(document.id, db))?.version).toBe(1);
  });

  it("does not replace an upload that was edited in the meantime", async () => {
    const { document, version } = await uploadedResume();
    await saveDraft(document.id, { content: textToDoc(`${RAW_TEXT}\n\nEdited by hand`), revision: 1 }, db);
    const id = await indexVersion(version.id, { parse: async () => profile() });
    expect(await getIndexRow(id, db)).toMatchObject({ status: "ready", note: "This was edited before it could be structured, so it was indexed as it is." });
    expect((await latestVersion(document.id, db))?.version).toBe(1);
  });

  it("indexes the text of a resume the model found nothing in", async () => {
    const { version } = await uploadedResume();
    const id = await indexVersion(version.id, { parse: async () => emptyProfile() });
    expect((await getIndexRow(id, db))?.note).toMatch(/no sections.*split by paragraph/);
    expect((await db.select().from(resumeChunks)).length).toBeGreaterThan(0);
  });

  it("fails with the reason when embedding fails, and stores no half-finished chunks", async () => {
    const { version } = await structuredResume();
    const id = await indexVersion(version.id, {
      embed: async () => {
        throw new Error("Could not reach Ollama at http://localhost:11434.");
      },
    });
    expect(await getIndexRow(id, db)).toMatchObject({ status: "failed", error: "Could not reach Ollama at http://localhost:11434." });
    expect(await db.select().from(resumeChunks)).toHaveLength(0);
  });

  it("replaces the old sections when a version is indexed again", async () => {
    const { version } = await structuredResume();
    await indexVersion(version.id);
    expect(await db.select().from(resumeChunks)).toHaveLength(2);
    await enqueueVersionIndex(version.id, { force: true }, db);
    await processResumeIndex(await claimOne(version.id), { db, embed: fakeEmbed });
    expect(await db.select().from(resumeChunks)).toHaveLength(2);
  });

  it("treats a blank resume as nothing to index yet, not as a failure", async () => {
    const { version } = await createDocument({ kind: "resume", origin: "blank", title: "Blank", content: blankContent("resume") }, db);
    const id = await indexVersion(version.id);
    expect(await getIndexRow(id, db)).toMatchObject({ status: "ready", chunkCount: 0, error: null, note: "There is no text to index yet." });
    expect(await db.select().from(resumeChunks)).toHaveLength(0);
  });

  it("fails cleanly when the document was deleted", async () => {
    const { document, version } = await structuredResume("Gone");
    await enqueueVersionIndex(version.id, {}, db);
    const id = await claimOne(version.id);
    await softDelete(document.id, db);
    await processResumeIndex(id, { db, embed: fakeEmbed });
    expect(await getIndexRow(id, db)).toMatchObject({ status: "failed", error: "The document was deleted." });
  });

  it("ignores an index that is not currently claimed", async () => {
    const { version } = await structuredResume();
    const info = await enqueueVersionIndex(version.id, {}, db);
    await processResumeIndex(info.id, { db, embed: fakeEmbed });
    expect((await getIndexRow(info.id, db))?.status).toBe("queued");
  });
});

describe("searchResumeChunks", () => {
  it("returns the sections closest in meaning to the query, best first", async () => {
    const { document, version } = await structuredResume("Jane resume");
    await indexVersion(version.id);

    const embedQuery = async (q: string) => fakeVector(q);
    const devrel = await searchResumeChunks("devrel community role", { limit: 2 }, { db, embedQuery });
    expect(devrel[0].label).toBe("Developer Advocate at Globex");
    expect(devrel[0].score).toBeGreaterThan(devrel[1].score);
    expect(devrel[0]).toMatchObject({ title: "Jane resume", documentId: document.id, versionId: version.id });

    const payments = await searchResumeChunks("payments platform", { limit: 1 }, { db, embedQuery });
    expect(payments[0].label).toBe("Engineer at Acme");
  });

  it("only searches the latest version of each resume, and not deleted ones", async () => {
    const { document, version } = await structuredResume("Jane");
    await indexVersion(version.id);
    await saveDraft(document.id, { content: textToDoc("JANE DOE\n\nSUMMARY\nPayments specialist."), revision: 1 }, db);
    const v2 = (await createVersion(document.id, { reason: "manual" }, db)).version;
    const embedQuery = async (q: string) => fakeVector(q);

    expect(await searchResumeChunks("devrel", {}, { db, embedQuery })).toEqual([]);
    await indexVersion(v2.id);
    const found = await searchResumeChunks("payments", {}, { db, embedQuery });
    expect(found.map((f) => f.versionId)).toEqual([v2.id]);

    await softDelete(document.id, db);
    expect(await searchResumeChunks("payments", {}, { db, embedQuery })).toEqual([]);
  });

  it("can be limited to some documents", async () => {
    const { version } = await structuredResume();
    await indexVersion(version.id);
    expect(await searchResumeChunks("payments", { documentIds: [] }, { db, embedQuery: async (q) => fakeVector(q) })).toEqual([]);
  });

  it("keeps old version rows out of the way: chunks belong to a version, not the document", async () => {
    const { version } = await structuredResume();
    await indexVersion(version.id);
    const [v] = await db.select().from(documentVersions).where(eq(documentVersions.id, version.id));
    expect(v.id).toBe(version.id);
    expect((await db.select().from(resumeChunks))[0].fileId).toBeNull();
  });
});

describe("worker", () => {
  it("marks an index failed when indexing runs too long", async () => {
    const { version } = await structuredResume();
    await enqueueVersionIndex(version.id, {}, db);
    const id = await claimOne(version.id);
    await processIndex(id, { db, timeoutMs: 20, run: () => new Promise(() => {}) });
    expect(await getIndexRow(id, db)).toMatchObject({ status: "failed", error: "Timed out after 5 minutes" });
  });
});

describe("known resume files", () => {
  it("accepts base, past and attached files and nothing else", async () => {
    const base = await putFile(Buffer.from("base"), { mime: DOCX_MIME, originalName: "base.docx" }, { dir, db });
    const stray = await putFile(Buffer.from("not a resume"), { mime: "text/plain", originalName: "x.txt" }, { dir, db });
    await saveVersion({ baseResumeFileId: base.id }, db);
    expect(await isKnownResumeFile(base.id, db)).toBe(true);
    expect(await isKnownResumeFile(stray.id, db)).toBe(false);
    expect(await isKnownResumeFile("00000000-0000-4000-8000-000000000000", db)).toBe(false);
  });

  it("names a file from its upload name, or from its type when it has none", () => {
    expect(fileDisplayName({ originalName: " Jane.pdf ", mime: "application/pdf" })).toBe("Jane.pdf");
    expect(fileDisplayName({ originalName: null, mime: "application/pdf" })).toBe("resume.pdf");
    expect(fileDisplayName({ originalName: null, mime: DOCX_MIME })).toBe("resume.docx");
  });
});
