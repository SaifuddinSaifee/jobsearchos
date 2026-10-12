import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db as defaultDb, type Db } from "@/lib/db";
import { files, pastResumes, profileVersions, resumeChunks, resumeIndexes, type ResumeIndexRow } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { getFileBytes } from "@/lib/storage/local";
import { chunkProfile, chunkText, type ResumeChunk } from "./chunk";
import { embedQuery, embedTexts } from "./embed";
import { extractResumeText } from "./extract";
import { parseResume } from "./parse";
import type { IndexInfo } from "./types";
import type { Profile } from "@/lib/profile/schema";

/** A running index that has not reported for this long is considered abandoned (its worker died). */
export const INDEX_STALE_SECONDS = 120;
export const INDEX_MAX_ATTEMPTS = 3;

const toInfo = (r: ResumeIndexRow): IndexInfo => ({ fileId: r.fileId, status: r.status, chunkCount: r.chunkCount, note: r.note, error: r.error });

/**
 * Queues a resume file for indexing. Safe to call as often as you like: a file that is already waiting, running or
 * done is left alone (unless `force`), and one that failed is tried again. Identical bytes share one file row, so a
 * resume uploaded twice is only processed once.
 */
export async function enqueueResumeIndex(fileId: string, opts: { force?: boolean } = {}, db: Db = defaultDb()): Promise<IndexInfo> {
  const [file] = await db.select({ id: files.id }).from(files).where(eq(files.id, fileId));
  if (!file) throw new Error("That file no longer exists.");

  await db.insert(resumeIndexes).values({ fileId }).onConflictDoNothing({ target: resumeIndexes.fileId });
  const [row] = await db.select().from(resumeIndexes).where(eq(resumeIndexes.fileId, fileId));
  const redo = row.status === "failed" || (opts.force && row.status === "ready");
  if (!redo) return toInfo(row);

  const [requeued] = await db
    .update(resumeIndexes)
    .set({ status: "queued", error: null, note: null, attempts: 0, startedAt: null, finishedAt: null, updatedAt: new Date() })
    .where(and(eq(resumeIndexes.fileId, fileId), inArray(resumeIndexes.status, ["failed", "ready"])))
    .returning();
  return toInfo(requeued ?? row);
}

/** Queues the file only if it has never been indexed. A failed one is left for the user to retry, so autosaves never loop on it. */
export async function ensureResumeIndex(fileId: string, db: Db = defaultDb()): Promise<boolean> {
  const [row] = await db.select({ fileId: resumeIndexes.fileId }).from(resumeIndexes).where(eq(resumeIndexes.fileId, fileId));
  if (row) return false;
  await enqueueResumeIndex(fileId, {}, db);
  return true;
}

/** Queues the base resume and every stored past resume that has no index yet. Returns how many were queued. */
export async function backfillResumeIndexes(db: Db = defaultDb()): Promise<number> {
  const [latest] = await db.select({ id: profileVersions.baseResumeFileId }).from(profileVersions).orderBy(desc(profileVersions.version)).limit(1);
  const past = await db.select({ id: pastResumes.fileId }).from(pastResumes);
  const ids = [...new Set([latest?.id, ...past.map((p) => p.id)].filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return 0;
  const have = new Set((await db.select({ id: resumeIndexes.fileId }).from(resumeIndexes).where(inArray(resumeIndexes.fileId, ids))).map((r) => r.id));
  const missing = ids.filter((id) => !have.has(id));
  for (const id of missing) await ensureResumeIndex(id, db);
  return missing.length;
}

/** The index state of the given files (or of every file that has one). */
export async function listIndexInfo(fileIds?: string[], db: Db = defaultDb()): Promise<IndexInfo[]> {
  if (fileIds && fileIds.length === 0) return [];
  const rows = await db.select().from(resumeIndexes).where(fileIds ? inArray(resumeIndexes.fileId, fileIds) : undefined);
  return rows.map(toInfo);
}

export async function getIndexRow(fileId: string, db: Db = defaultDb()): Promise<ResumeIndexRow | null> {
  const [r] = await db.select().from(resumeIndexes).where(eq(resumeIndexes.fileId, fileId));
  return r ?? null;
}

/** Atomically takes up to `n` queued files, oldest first, marking them running (safe if two servers share the database). */
export async function claimNextIndexes(n: number, db: Db = defaultDb()): Promise<string[]> {
  if (n <= 0) return [];
  const rows = await db.execute<{ file_id: string }>(sql`
    UPDATE resume_indexes
       SET status = 'running', started_at = now(), updated_at = now(), attempts = attempts + 1, error = NULL
     WHERE file_id IN (
       SELECT file_id FROM resume_indexes WHERE status = 'queued' ORDER BY created_at, file_id LIMIT ${n} FOR UPDATE SKIP LOCKED
     )
 RETURNING file_id`);
  return rows.map((r) => r.file_id);
}

/** Puts abandoned running indexes back in the queue (or fails them after too many tries). */
export async function sweepStaleIndexes(db: Db = defaultDb()): Promise<number> {
  const rows = await db.execute<{ file_id: string }>(sql`
    UPDATE resume_indexes
       SET status = CASE WHEN attempts >= ${INDEX_MAX_ATTEMPTS} THEN 'failed' ELSE 'queued' END,
           error = CASE WHEN attempts >= ${INDEX_MAX_ATTEMPTS} THEN 'The server stopped while this was running, too many times in a row.' ELSE NULL END,
           finished_at = CASE WHEN attempts >= ${INDEX_MAX_ATTEMPTS} THEN now() ELSE NULL END,
           updated_at = now()
     WHERE status = 'running' AND updated_at < now() - make_interval(secs => ${INDEX_STALE_SECONDS})
 RETURNING file_id`);
  return rows.length;
}

/** Heartbeat: tells the sweeper this file is still being worked on. */
export async function touchIndex(fileId: string, db: Db = defaultDb()) {
  await db.update(resumeIndexes).set({ updatedAt: new Date() }).where(and(eq(resumeIndexes.fileId, fileId), eq(resumeIndexes.status, "running")));
}

export type IndexDeps = {
  db?: Db;
  /** Where files are kept (defaults to STORAGE_DIR). */
  storageDir?: string;
  parse?: (text: string) => Promise<Profile>;
  embed?: (texts: string[]) => Promise<number[][]>;
};

/**
 * Reads one claimed resume file end to end: extract the text, have the model structure it, split it into sections,
 * embed each section and store them. Structuring is allowed to fail (the text is then split by paragraph and the
 * user is told); extracting and embedding are not, because without them there is nothing to search.
 */
export async function processResumeIndex(fileId: string, deps: IndexDeps = {}): Promise<void> {
  const db = deps.db ?? defaultDb();
  const row = await getIndexRow(fileId, db);
  if (!row || row.status !== "running") return;

  try {
    const [file] = await db.select().from(files).where(eq(files.id, fileId));
    if (!file) throw new Error("The file is missing from storage.");
    const bytes = await getFileBytes(file.sha256, { dir: deps.storageDir, db });
    const { text } = await extractResumeText(bytes, file.originalName ?? "", file.mime);

    let parsed: Profile | null = null;
    let note: string | null = null;
    try {
      parsed = await (deps.parse ?? parseResume)(text);
    } catch (err) {
      note = `Could not structure this resume (${err instanceof Error ? err.message : "unknown error"}). It was split by paragraph instead.`;
    }
    let chunks: ResumeChunk[] = parsed ? chunkProfile(parsed) : [];
    if (chunks.length === 0) {
      if (parsed) note = "The model found no sections in this resume. It was split by paragraph instead.";
      chunks = chunkText(text);
    }
    if (chunks.length === 0) throw new Error("No text found in this resume.");

    const vectors = await (deps.embed ?? ((t: string[]) => embedTexts(t)))(chunks.map((c) => `${c.label}\n${c.text}`));
    const model = env().EMBEDDING_MODEL;
    await db.transaction(async (tx) => {
      await tx.delete(resumeChunks).where(eq(resumeChunks.fileId, fileId));
      await tx.insert(resumeChunks).values(chunks.map((c, i) => ({ fileId, ordinal: i, section: c.section, label: c.label, text: c.text, embedding: vectors[i], embeddingModel: model })));
      await tx
        .update(resumeIndexes)
        .set({ status: "ready", parsed, note, error: null, chunkCount: chunks.length, embeddingModel: model, finishedAt: new Date(), updatedAt: new Date() })
        .where(eq(resumeIndexes.fileId, fileId));
    });
  } catch (err) {
    await db
      .update(resumeIndexes)
      .set({ status: "failed", error: (err instanceof Error ? err.message : "Could not index this resume").slice(0, 500), finishedAt: new Date(), updatedAt: new Date() })
      .where(eq(resumeIndexes.fileId, fileId));
  }
}

export type ResumeMatch = { fileId: string; fileName: string | null; section: string; label: string; text: string; score: number };

/**
 * The resume sections closest in meaning to a query (a job description, a requirement, a question), best first.
 * `score` is cosine similarity, 1 being identical. This is the retrieval the writer will use to pick which of the
 * user's real experience to draw on.
 */
export async function searchResumeChunks(
  query: string,
  opts: { limit?: number; fileIds?: string[] } = {},
  deps: { db?: Db; embedQuery?: (q: string) => Promise<number[]> } = {},
): Promise<ResumeMatch[]> {
  const db = deps.db ?? defaultDb();
  const vector = JSON.stringify(await (deps.embedQuery ?? ((q: string) => embedQuery(q)))(query));
  const distance = sql<number>`${resumeChunks.embedding} <=> ${vector}::vector`;
  const rows = await db
    .select({ fileId: resumeChunks.fileId, fileName: files.originalName, section: resumeChunks.section, label: resumeChunks.label, text: resumeChunks.text, distance })
    .from(resumeChunks)
    .innerJoin(files, eq(files.id, resumeChunks.fileId))
    .where(opts.fileIds ? inArray(resumeChunks.fileId, opts.fileIds) : undefined)
    .orderBy(distance)
    .limit(opts.limit ?? 8);
  return rows.map(({ distance: d, ...r }) => ({ ...r, score: 1 - Number(d) }));
}

