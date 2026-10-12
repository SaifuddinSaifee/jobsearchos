import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resumeChunks, resumeIndexes } from "@/lib/db/schema";
import { emptyProfile, type Profile } from "@/lib/profile/schema";
import { EMBEDDING_DIMENSIONS } from "@/lib/resume/embed";
import {
  backfillResumeIndexes,
  claimNextIndexes,
  enqueueResumeIndex,
  ensureResumeIndex,
  getIndexRow,
  listIndexInfo,
  processResumeIndex,
  searchResumeChunks,
  sweepStaleIndexes,
} from "@/lib/resume/indexing";
import { saveVersion } from "@/lib/profile/service";
import { processIndex } from "@/lib/queue/worker";
import { fileDisplayName, isKnownResumeFile } from "@/lib/resume/files";
import { putFile } from "@/lib/storage/local";
import { DOCX_MIME, makeDocx } from "./docx";
import { resetDb, testDb } from "./helpers";

process.env.DATABASE_URL ??= "postgres://unused";

const db = testDb();
let dir: string;

beforeEach(async () => {
  await resetDb(db);
  dir = await mkdtemp(path.join(tmpdir(), "jt-index-"));
});
afterAll(async () => {
  await db.$client.end();
});

async function storeResume(paragraphs = ["Jane Doe", "Staff Engineer at Acme", "Cut p95 latency by 40%"], name = "jane.docx") {
  return putFile(await makeDocx(paragraphs), { mime: DOCX_MIME, originalName: name }, { dir, db });
}

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

async function claim(fileId: string) {
  const ids = await claimNextIndexes(5, db);
  expect(ids).toContain(fileId);
}

describe("queueing", () => {
  it("queues a file once, however often it is asked", async () => {
    const f = await storeResume();
    expect((await enqueueResumeIndex(f.id, {}, db)).status).toBe("queued");
    await enqueueResumeIndex(f.id, {}, db);
    expect(await db.select().from(resumeIndexes)).toHaveLength(1);
  });

  it("does not requeue a finished file unless forced, but does retry a failed one", async () => {
    const f = await storeResume();
    await enqueueResumeIndex(f.id, {}, db);
    await db.update(resumeIndexes).set({ status: "ready", chunkCount: 3 }).where(eq(resumeIndexes.fileId, f.id));
    expect((await enqueueResumeIndex(f.id, {}, db)).status).toBe("ready");
    expect((await enqueueResumeIndex(f.id, { force: true }, db)).status).toBe("queued");

    await db.update(resumeIndexes).set({ status: "failed", error: "boom", attempts: 3 }).where(eq(resumeIndexes.fileId, f.id));
    const again = await enqueueResumeIndex(f.id, {}, db);
    expect(again.status).toBe("queued");
    expect(again.error).toBeNull();
    expect((await getIndexRow(f.id, db))?.attempts).toBe(0);
  });

  it("ensureResumeIndex leaves failed files alone so autosaves cannot loop on them", async () => {
    const f = await storeResume();
    expect(await ensureResumeIndex(f.id, db)).toBe(true);
    await db.update(resumeIndexes).set({ status: "failed" }).where(eq(resumeIndexes.fileId, f.id));
    expect(await ensureResumeIndex(f.id, db)).toBe(false);
    expect((await getIndexRow(f.id, db))?.status).toBe("failed");
  });

  it("refuses an unknown file", async () => {
    await expect(enqueueResumeIndex("00000000-0000-4000-8000-000000000000", {}, db)).rejects.toThrow(/no longer exists/);
  });

  it("claims each queued file once and sweeps abandoned runs back to the queue", async () => {
    const a = await storeResume(["one resume"], "a.docx");
    const b = await storeResume(["another resume"], "b.docx");
    await enqueueResumeIndex(a.id, {}, db);
    await enqueueResumeIndex(b.id, {}, db);
    expect((await claimNextIndexes(1, db)).length).toBe(1);
    expect((await claimNextIndexes(5, db)).length).toBe(1);
    expect(await claimNextIndexes(5, db)).toEqual([]);

    await db.execute(sql`UPDATE resume_indexes SET updated_at = now() - interval '10 minutes'`);
    expect(await sweepStaleIndexes(db)).toBe(2);
    expect((await listIndexInfo(undefined, db)).map((i) => i.status)).toEqual(["queued", "queued"]);
  });

  it("backfills the base resume and past resumes that have no index", async () => {
    const base = await storeResume(["base resume"], "base.docx");
    await saveVersion({ profile: profile(), baseResumeFileId: base.id }, db);
    expect(await backfillResumeIndexes(db)).toBe(1);
    expect(await backfillResumeIndexes(db)).toBe(0);
  });
});

describe("processResumeIndex", () => {
  it("reads the file, splits it into sections and stores an embedding for each", async () => {
    const f = await storeResume();
    await enqueueResumeIndex(f.id, {}, db);
    await claim(f.id);
    await processResumeIndex(f.id, { db, storageDir: dir, parse: async () => profile(), embed: fakeEmbed });

    const row = await getIndexRow(f.id, db);
    expect(row).toMatchObject({ status: "ready", chunkCount: 2, error: null, note: null });
    expect(row?.parsed?.experience).toHaveLength(2);
    const chunks = await db.select().from(resumeChunks).where(eq(resumeChunks.fileId, f.id)).orderBy(resumeChunks.ordinal);
    expect(chunks.map((c) => c.label)).toEqual(["Engineer at Acme", "Developer Advocate at Globex"]);
    expect(chunks[0].embedding).toHaveLength(EMBEDDING_DIMENSIONS);
  });

  it("falls back to paragraphs and says so when the resume cannot be structured", async () => {
    const f = await storeResume();
    await enqueueResumeIndex(f.id, {}, db);
    await claim(f.id);
    await processResumeIndex(f.id, {
      db,
      storageDir: dir,
      parse: async () => {
        throw new Error("no API key");
      },
      embed: fakeEmbed,
    });
    const row = await getIndexRow(f.id, db);
    expect(row?.status).toBe("ready");
    expect(row?.note).toMatch(/no API key.*split by paragraph/);
    expect((await db.select().from(resumeChunks)).length).toBeGreaterThan(0);
  });

  it("fails with the reason when embedding fails, and stores no half-finished chunks", async () => {
    const f = await storeResume();
    await enqueueResumeIndex(f.id, {}, db);
    await claim(f.id);
    await processResumeIndex(f.id, {
      db,
      storageDir: dir,
      parse: async () => profile(),
      embed: async () => {
        throw new Error("Could not reach Ollama at http://localhost:11434.");
      },
    });
    expect(await getIndexRow(f.id, db)).toMatchObject({ status: "failed", error: "Could not reach Ollama at http://localhost:11434." });
    expect(await db.select().from(resumeChunks)).toHaveLength(0);
  });

  it("replaces the old sections when a file is indexed again", async () => {
    const f = await storeResume();
    for (const p of [profile(), { ...profile(), experience: profile().experience.slice(0, 1) }]) {
      await enqueueResumeIndex(f.id, { force: true }, db);
      await claim(f.id);
      await processResumeIndex(f.id, { db, storageDir: dir, parse: async () => p, embed: fakeEmbed });
    }
    expect(await db.select().from(resumeChunks)).toHaveLength(1);
    expect((await getIndexRow(f.id, db))?.chunkCount).toBe(1);
  });

  it("ignores a file that is not currently claimed", async () => {
    const f = await storeResume();
    await enqueueResumeIndex(f.id, {}, db);
    await processResumeIndex(f.id, { db, storageDir: dir, parse: async () => profile(), embed: fakeEmbed });
    expect((await getIndexRow(f.id, db))?.status).toBe("queued");
  });
});

describe("searchResumeChunks", () => {
  it("returns the sections closest in meaning to the query, best first", async () => {
    const f = await storeResume();
    await enqueueResumeIndex(f.id, {}, db);
    await claim(f.id);
    await processResumeIndex(f.id, { db, storageDir: dir, parse: async () => profile(), embed: fakeEmbed });

    const embedQuery = async (q: string) => fakeVector(q);
    const devrel = await searchResumeChunks("devrel community role", { limit: 2 }, { db, embedQuery });
    expect(devrel[0].label).toBe("Developer Advocate at Globex");
    expect(devrel[0].score).toBeGreaterThan(devrel[1].score);
    expect(devrel[0].fileName).toBe("jane.docx");

    const payments = await searchResumeChunks("payments platform", { limit: 1 }, { db, embedQuery });
    expect(payments[0].label).toBe("Engineer at Acme");
  });

  it("can be limited to some files", async () => {
    const f = await storeResume();
    await enqueueResumeIndex(f.id, {}, db);
    await claim(f.id);
    await processResumeIndex(f.id, { db, storageDir: dir, parse: async () => profile(), embed: fakeEmbed });
    expect(await searchResumeChunks("payments", { fileIds: [] }, { db, embedQuery: async (q) => fakeVector(q) })).toEqual([]);
  });
});

describe("worker", () => {
  it("marks a file failed when indexing throws or runs too long", async () => {
    const f = await storeResume();
    await enqueueResumeIndex(f.id, {}, db);
    await claim(f.id);
    await processIndex(f.id, {
      db,
      timeoutMs: 20,
      run: () => new Promise(() => {}),
    });
    expect(await getIndexRow(f.id, db)).toMatchObject({ status: "failed", error: "Timed out after 5 minutes" });
  });
});

describe("known resume files", () => {
  it("accepts base, past and attached files and nothing else", async () => {
    const base = await storeResume(["base"], "base.docx");
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

afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});
