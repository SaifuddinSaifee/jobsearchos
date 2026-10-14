import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { syncBaseFromProfile } from "@/lib/documents/base";
import { getBaseDocument, latestVersion, listDocuments } from "@/lib/documents/service";
import { emptyProfile, type Profile } from "@/lib/profile/schema";
import { sha256 } from "@/lib/documents/intake";
import { DOCX_MIME } from "./docx";
import { resetDb, testDb } from "./helpers";

process.env.DATABASE_URL ??= "postgres://unused";
const queued = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/lib/documents/queue", () => ({ enqueueAfterCreate: queued }));

const db = testDb();
beforeEach(async () => {
  await resetDb(db);
  queued.mockClear();
});
afterAll(async () => {
  await db.$client.end();
});

const profile = (summary = "Backend engineer."): Profile => ({ ...emptyProfile(), summary });
const file = (name: string) => ({ name, mime: DOCX_MIME, sha256: sha256(Buffer.from(name)) });

describe("syncBaseFromProfile", () => {
  it("makes a base resume from an imported profile, remembering where it came from but not keeping the file", async () => {
    const doc = await syncBaseFromProfile(profile(), file("jane.docx"), db);
    expect(doc).toMatchObject({ title: "Base resume", isBase: true, origin: "uploaded", sourceFileId: null, sourceName: "jane.docx", sourceMime: DOCX_MIME });
    expect(doc!.sourceSha256).toHaveLength(64);
    expect((await latestVersion(doc!.id, db))?.plainText).toContain("Backend engineer.");
    expect(queued).toHaveBeenCalledWith(doc!.id, db);
  });

  it("replaces the base on a new import, and keeps the old one as an ordinary resume", async () => {
    const first = await syncBaseFromProfile(profile("First."), file("a.docx"), db);
    const second = await syncBaseFromProfile(profile("Second."), file("b.docx"), db);
    expect((await getBaseDocument(db))?.id).toBe(second!.id);
    expect(second!.title).toMatch(/^Base resume, \d{4}-\d{2}-\d{2}$/);
    const all = await listDocuments({ kind: "resume" }, db);
    expect(all.map((d) => [d.id, d.isBase])).toEqual(expect.arrayContaining([[first!.id, false], [second!.id, true]]));
  });

  it("leaves the base alone when a saved profile is only edited", async () => {
    const base = await syncBaseFromProfile(profile("Original."), file("a.docx"), db);
    expect(await syncBaseFromProfile(profile("Edited."), undefined, db)).toBeNull();
    expect((await getBaseDocument(db))?.id).toBe(base!.id);
    expect((await latestVersion(base!.id, db))?.plainText).toContain("Original.");
  });

  it("makes a base from the profile alone when there is none yet, but not from an empty profile", async () => {
    expect(await syncBaseFromProfile(emptyProfile(), undefined, db)).toBeNull();
    const doc = await syncBaseFromProfile(profile(), undefined, db);
    expect(doc).toMatchObject({ isBase: true, origin: "blank", sourceFileId: null });
  });
});
