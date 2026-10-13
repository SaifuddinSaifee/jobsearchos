import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { documentVersions, documents } from "@/lib/db/schema";
import type { DocJSON } from "@/lib/documents/build";
import { textToDoc } from "@/lib/documents/convert/text-to-doc";
import {
  createDocument,
  createVersion,
  DocumentError,
  duplicateDocument,
  getBaseDocument,
  getDraft,
  getEditorData,
  latestVersion,
  listDocuments,
  listVersions,
  lockForJob,
  restoreVersion,
  saveDraft,
  setBase,
  softDelete,
  updateMeta,
  updatePageSettings,
} from "@/lib/documents/service";
import { emptyExtraction, type JobDraft } from "@/lib/jobs/schema";
import { saveJob } from "@/lib/jobs/service";
import { resetDb, testDb } from "./helpers";

process.env.DATABASE_URL ??= "postgres://unused";
vi.mock("@/lib/llm/client", () => ({ together: () => ({}) }));

const db = testDb();
beforeEach(() => resetDb(db));
afterAll(() => db.$client.end());

const letter = (text: string): DocJSON => textToDoc(text, { mode: "letter" });
const resume = (text = "JANE DOE\n\nSUMMARY\nBuilds things."): DocJSON => textToDoc(text);

async function seedJob() {
  const e = { ...emptyExtraction(), company: "Acme", title: "Engineer", location: "Remote", technologies: [], keywords: [] };
  const draft: JobDraft = {
    ...e,
    sourceUrl: "https://boards.greenhouse.io/acme/jobs/1",
    fetchMethod: "greenhouse",
    ats: "greenhouse",
    atsJobId: "1",
    rawFileId: null,
    rawText: "raw",
    normalized: e,
  };
  const r = await saveJob(draft, db);
  if (!r.ok) throw new Error("seed failed");
  return r;
}

describe("createDocument", () => {
  it("makes the document, its first version and its draft together", async () => {
    const { document, version } = await createDocument({ kind: "cover_letter", origin: "pasted", title: "Letter", content: letter("Dear team,\n\nHello.") }, db);
    expect(version.version).toBe(1);
    expect(version.reason).toBe("upload");
    expect(version.plainText).toContain("Dear team");
    expect(version.markdown).toContain("Hello.");
    expect(version.contentSha256).toHaveLength(64);
    const draft = await getDraft(document.id, db);
    expect(draft?.revision).toBe(1);
    expect(draft?.baseVersionId).toBe(version.id);
    expect(draft?.contentSha256).toBe(version.contentSha256);
  });

  it("repairs missing fields and ids, and refuses documents that cannot be repaired", async () => {
    const roughly: DocJSON = { type: "doc", content: [{ type: "section", content: [{ type: "sectionTitle" }, { type: "role" }] }] };
    const { version } = await createDocument({ kind: "resume", origin: "blank", title: "R", content: roughly }, db);
    expect(JSON.stringify(version.content)).toContain("roleLocation");
    await expect(createDocument({ kind: "resume", origin: "blank", title: "R", content: { type: "doc", content: [{ type: "nope" }] } }, db)).rejects.toThrow();
    expect(await db.select().from(documents)).toHaveLength(1);
  });

  it("takes the company from the linked job", async () => {
    const job = await seedJob();
    const { document } = await createDocument({ kind: "resume", origin: "uploaded", title: "For Acme", content: resume(), jobId: job.jobId }, db);
    expect(document.companyId).toBeTruthy();
    expect(document.companyName).toBe("Acme");
    const [item] = await listDocuments({}, db);
    expect(item).toMatchObject({ title: "For Acme", companyName: "Acme", jobTitle: "Engineer", versionCount: 1, locked: false });
  });

  it("can only make a resume the base, and only one", async () => {
    await expect(createDocument({ kind: "email", origin: "blank", title: "E", content: letter("Hi"), isBase: true }, db)).rejects.toThrow(DocumentError);
    const a = await createDocument({ kind: "resume", origin: "blank", title: "A", content: resume(), isBase: true }, db);
    const b = await createDocument({ kind: "resume", origin: "blank", title: "B", content: resume(), isBase: true }, db);
    expect((await getBaseDocument(db))?.id).toBe(b.document.id);
    const [aRow] = await db.select().from(documents).where(eq(documents.id, a.document.id));
    expect(aRow.isBase).toBe(false);
  });
});

describe("drafts", () => {
  it("saves a draft and moves the revision on", async () => {
    const { document } = await createDocument({ kind: "email", origin: "blank", title: "E", content: letter("Hi") }, db);
    const saved = await saveDraft(document.id, { content: letter("Hi there"), subject: "Hello", revision: 1 }, db);
    expect(saved.revision).toBe(2);
    const draft = await getDraft(document.id, db);
    expect(draft?.subject).toBe("Hello");
    expect(JSON.stringify(draft?.content)).toContain("Hi there");
  });

  it("refuses a save made from an older revision", async () => {
    const { document } = await createDocument({ kind: "email", origin: "blank", title: "E", content: letter("Hi") }, db);
    await saveDraft(document.id, { content: letter("one"), revision: 1 }, db);
    const err = await saveDraft(document.id, { content: letter("two"), revision: 1 }, db).catch((e) => e);
    expect(err).toBeInstanceOf(DocumentError);
    expect(err.code).toBe("stale");
    expect(err.detail.revision).toBe(2);
    expect(JSON.stringify((await getDraft(document.id, db))?.content)).toContain("one");
  });

  it("refuses invalid content and unknown documents", async () => {
    const { document } = await createDocument({ kind: "email", origin: "blank", title: "E", content: letter("Hi") }, db);
    await expect(saveDraft(document.id, { content: { type: "doc", content: [{ type: "role" }] }, revision: 1 }, db)).rejects.toMatchObject({ code: "invalid" });
    await expect(saveDraft("00000000-0000-4000-8000-000000000000", { content: letter("x"), revision: 1 }, db)).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("versions", () => {
  it("makes a new version only when something changed", async () => {
    const { document } = await createDocument({ kind: "resume", origin: "blank", title: "R", content: resume() }, db);
    const same = await createVersion(document.id, { reason: "manual" }, db);
    expect(same.created).toBe(false);
    expect(same.version.version).toBe(1);

    await saveDraft(document.id, { content: resume("JANE DOE\n\nSUMMARY\nChanged."), revision: 1 }, db);
    const next = await createVersion(document.id, { reason: "manual", note: "Tweaked summary" }, db);
    expect(next.created).toBe(true);
    expect(next.version).toMatchObject({ version: 2, note: "Tweaked summary", reason: "manual" });

    expect((await createVersion(document.id, { reason: "export" }, db)).created).toBe(false);
    expect((await listVersions(document.id, db)).map((v) => v.version)).toEqual([2, 1]);
  });

  it("counts a change of page settings as a change", async () => {
    const { document } = await createDocument({ kind: "resume", origin: "blank", title: "R", content: resume() }, db);
    await updatePageSettings(document.id, { density: 6 }, db);
    const v = await createVersion(document.id, { reason: "manual" }, db);
    expect(v.created).toBe(true);
    expect(v.version.pageSettings).toMatchObject({ density: 6 });
  });

  it("restores an old version as a new one", async () => {
    const { document, version: v1 } = await createDocument({ kind: "resume", origin: "blank", title: "R", content: resume("JANE DOE\n\nSUMMARY\nFirst.") }, db);
    await saveDraft(document.id, { content: resume("JANE DOE\n\nSUMMARY\nSecond."), revision: 1 }, db);
    await createVersion(document.id, { reason: "manual" }, db);

    const v3 = await restoreVersion(document.id, v1.id, db);
    expect(v3).toMatchObject({ version: 3, reason: "restore", restoredFromVersionId: v1.id, note: "Restored from version 1" });
    const draft = await getDraft(document.id, db);
    expect(JSON.stringify(draft?.content)).toContain("First.");
    expect(draft?.revision).toBe(3);
    expect((await latestVersion(document.id, db))?.id).toBe(v3.id);
  });

  it("will not restore a version of another document", async () => {
    const a = await createDocument({ kind: "resume", origin: "blank", title: "A", content: resume() }, db);
    const b = await createDocument({ kind: "resume", origin: "blank", title: "B", content: resume() }, db);
    await expect(restoreVersion(a.document.id, b.version.id, db)).rejects.toMatchObject({ code: "not_found" });
  });
});

/** Drizzle wraps the database error; the trigger's message is on `cause`. */
async function expectImmutable(run: Promise<unknown>) {
  const err = await run.then(() => null, (e: Error & { cause?: Error }) => e);
  expect(err, "expected the update to be refused").not.toBeNull();
  expect(String((err as { cause?: Error }).cause?.message ?? err?.message)).toMatch(/immutable/);
}

describe("immutability", () => {
  it("blocks DELETE and changing content", async () => {
    const { version } = await createDocument({ kind: "resume", origin: "blank", title: "R", content: resume() }, db);
    await expectImmutable(db.execute(sql`DELETE FROM document_versions WHERE id = ${version.id}`));
    await expectImmutable(db.execute(sql`UPDATE document_versions SET plain_text = 'x' WHERE id = ${version.id}`));
    await expectImmutable(db.execute(sql`UPDATE document_versions SET locked_at = now(), plain_text = 'x' WHERE id = ${version.id}`));
  });

  it("allows locking once and never unlocking", async () => {
    const { version } = await createDocument({ kind: "resume", origin: "blank", title: "R", content: resume() }, db);
    await db.execute(sql`UPDATE document_versions SET locked_at = now() WHERE id = ${version.id}`);
    await expectImmutable(db.execute(sql`UPDATE document_versions SET locked_at = NULL WHERE id = ${version.id}`));
    await expectImmutable(db.execute(sql`UPDATE document_versions SET locked_at = now() WHERE id = ${version.id}`));
  });

  it("keeps a search vector for full-text search", async () => {
    await createDocument({ kind: "resume", origin: "blank", title: "R", content: resume("JANE DOE\n\nSUMMARY\nKubernetes operator.") }, db);
    const rows = await db.select({ id: documentVersions.id }).from(documentVersions).where(sql`search_vector @@ websearch_to_tsquery('english', 'kubernetes')`);
    expect(rows).toHaveLength(1);
  });
});

describe("base, delete, duplicate, meta", () => {
  it("moves the base resume", async () => {
    const a = await createDocument({ kind: "resume", origin: "blank", title: "A", content: resume(), isBase: true }, db);
    const b = await createDocument({ kind: "resume", origin: "blank", title: "B", content: resume() }, db);
    await setBase(b.document.id, db);
    expect((await getBaseDocument(db))?.id).toBe(b.document.id);
    await setBase(a.document.id, db);
    expect((await getBaseDocument(db))?.id).toBe(a.document.id);
    const mail = await createDocument({ kind: "email", origin: "blank", title: "E", content: letter("Hi") }, db);
    await expect(setBase(mail.document.id, db)).rejects.toMatchObject({ code: "blocked" });
  });

  it("will not delete the base or anything that went out", async () => {
    const base = await createDocument({ kind: "resume", origin: "blank", title: "Base", content: resume(), isBase: true }, db);
    await expect(softDelete(base.document.id, db)).rejects.toMatchObject({ code: "blocked" });

    const sent = await createDocument({ kind: "email", origin: "sent", title: "Sent", content: letter("Hi"), lockedAt: new Date() }, db);
    await expect(softDelete(sent.document.id, db)).rejects.toMatchObject({ code: "blocked" });

    const plain = await createDocument({ kind: "cover_letter", origin: "blank", title: "Plain", content: letter("Hi") }, db);
    await softDelete(plain.document.id, db);
    expect((await listDocuments({}, db)).map((d) => d.title).sort()).toEqual(["Base", "Sent"]);
    expect(await getEditorData(plain.document.id, db)).toBeNull();
  });

  it("duplicates the current draft as an unlinked copy", async () => {
    const job = await seedJob();
    const a = await createDocument({ kind: "resume", origin: "uploaded", title: "Orig", content: resume(), jobId: job.jobId, isBase: true }, db);
    await saveDraft(a.document.id, { content: resume("JANE DOE\n\nSUMMARY\nEdited."), revision: 1 }, db);
    const copy = await duplicateDocument(a.document.id, {}, db);
    expect(copy.document).toMatchObject({ title: "Orig (copy)", origin: "copied", isBase: false, jobId: null });
    expect(copy.version.plainText).toContain("Edited.");
  });

  it("updates details and lists by kind", async () => {
    const { document } = await createDocument({ kind: "cover_letter", origin: "blank", title: "L", content: letter("Hi") }, db);
    await createDocument({ kind: "email", origin: "blank", title: "E", content: letter("Hi") }, db);
    const row = await updateMeta(document.id, { title: "  Letter for Acme ", targetRole: "Engineer", writtenOn: "2026-10-01" }, db);
    expect(row).toMatchObject({ title: "Letter for Acme", targetRole: "Engineer", writtenOn: "2026-10-01" });
    expect((await listDocuments({ kind: "cover_letter" }, db)).map((d) => d.title)).toEqual(["Letter for Acme"]);
    await expect(updateMeta("00000000-0000-4000-8000-000000000000", { title: "x" }, db)).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("lockForJob", () => {
  it("saves unsaved edits, then locks the latest version of the job's resume and letter", async () => {
    const job = await seedJob();
    const r = await createDocument({ kind: "resume", origin: "uploaded", title: "R", content: resume(), jobId: job.jobId }, db);
    const l = await createDocument({ kind: "cover_letter", origin: "blank", title: "L", content: letter("Hi"), jobId: job.jobId }, db);
    const mail = await createDocument({ kind: "email", origin: "blank", title: "E", content: letter("Hi"), jobId: job.jobId }, db);
    await createDocument({ kind: "resume", origin: "uploaded", title: "Other job", content: resume() }, db);
    await saveDraft(r.document.id, { content: resume("JANE DOE\n\nSUMMARY\nEdited after save."), revision: 1 }, db);

    const out = await db.transaction((tx) => lockForJob(tx, job.jobId));
    expect(out.createdVersionIds).toHaveLength(1);
    expect(out.lockedVersionIds).toHaveLength(2);

    const rv = await latestVersion(r.document.id, db);
    expect(rv).toMatchObject({ version: 2, reason: "applied", lockedJobId: job.jobId });
    expect(rv?.lockedAt).toBeTruthy();
    expect((await latestVersion(l.document.id, db))?.lockedAt).toBeTruthy();
    expect((await latestVersion(mail.document.id, db))?.lockedAt).toBeNull();

    const again = await db.transaction((tx) => lockForJob(tx, job.jobId));
    expect(again).toEqual({ createdVersionIds: [], createdDocumentIds: [], lockedVersionIds: [] });
    expect((await listDocuments({}, db)).find((d) => d.id === r.document.id)?.locked).toBe(true);
  });
});
