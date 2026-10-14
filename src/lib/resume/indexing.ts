import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db as defaultDb, type Db } from "@/lib/db";
import {
  documents,
  documentVersions,
  resumeChunks,
  resumeIndexes,
  type DocumentRow,
  type DocumentVersionRow,
  type ResumeIndexRow,
} from "@/lib/db/schema";
import { chunkDocument } from "@/lib/documents/convert/chunk-document";
import { docToProfile } from "@/lib/documents/convert/doc-to-profile";
import { keepCustomSections } from "@/lib/documents/convert/keep-custom";
import { profileToDoc } from "@/lib/documents/convert/profile-to-doc";
import { hasStructure, sectionsOf } from "@/lib/documents/read";
import { addStructuredVersion, getDocument, getVersion, latestVersion } from "@/lib/documents/service";
import { env } from "@/lib/env";
import { addLlmIds } from "@/lib/llm/context";
import type { Profile } from "@/lib/profile/schema";
import { embedQuery, embedTexts } from "./embed";
import { parseResume } from "./parse";
import type { IndexInfo } from "./types";

/** A running index that has not reported for this long is considered abandoned (its worker died). */
export const INDEX_STALE_SECONDS = 120;
export const INDEX_MAX_ATTEMPTS = 3;

/** Shortest text worth sending to the model to be structured. */
const MIN_TEXT_TO_STRUCTURE = 80;

const toInfo = (r: ResumeIndexRow, documentId: string): IndexInfo => ({
  id: r.id,
  documentId,
  versionId: r.documentVersionId as string,
  status: r.status,
  chunkCount: r.chunkCount,
  note: r.note,
  error: r.error,
});

/**
 * Queues one version of a library resume for indexing. Safe to call as often as you like: a version that is already
 * waiting, running or done is left alone (unless `force`), and one that failed is tried again.
 */
export async function enqueueVersionIndex(versionId: string, opts: { force?: boolean } = {}, db: Db = defaultDb()): Promise<IndexInfo> {
  const version = await getVersion(versionId, db);
  if (!version) throw new Error("That version no longer exists.");

  await db.insert(resumeIndexes).values({ documentVersionId: versionId }).onConflictDoNothing();
  const [row] = await db.select().from(resumeIndexes).where(eq(resumeIndexes.documentVersionId, versionId));
  const redo = row.status === "failed" || (opts.force && row.status === "ready");
  if (!redo) return toInfo(row, version.documentId);

  const [requeued] = await db
    .update(resumeIndexes)
    .set({ status: "queued", error: null, note: null, attempts: 0, startedAt: null, finishedAt: null, updatedAt: new Date() })
    .where(and(eq(resumeIndexes.id, row.id), inArray(resumeIndexes.status, ["failed", "ready"])))
    .returning();
  return toInfo(requeued ?? row, version.documentId);
}

/** Queues the latest version of a document. Resumes only: letters and emails are not embedded. */
export async function enqueueDocumentIndex(documentId: string, opts: { force?: boolean } = {}, db: Db = defaultDb()): Promise<IndexInfo | null> {
  const doc = await getDocument(documentId, db);
  if (!doc || doc.kind !== "resume") return null;
  const latest = await latestVersion(documentId, db);
  return latest ? enqueueVersionIndex(latest.id, opts, db) : null;
}

/**
 * Queues the latest version of every library resume that has no index yet. Returns how many were queued. Runs when
 * the worker starts, and picks up anything missed while it was off.
 */
export async function backfillResumeIndexes(db: Db = defaultDb()): Promise<number> {
  const rows = await db.execute<{ id: string }>(sql`
    SELECT v.id FROM document_versions v JOIN documents d ON d.id = v.document_id
     WHERE d.kind = 'resume' AND d.deleted_at IS NULL
       AND v.version = (SELECT max(version) FROM document_versions WHERE document_id = d.id)
       AND NOT EXISTS (SELECT 1 FROM resume_indexes i WHERE i.document_version_id = v.id)`);
  for (const r of rows) await enqueueVersionIndex(r.id, {}, db);
  return rows.length;
}

/** The index state of each library resume: the state of its latest version. */
export async function listIndexInfo(opts: { documentIds?: string[] } = {}, db: Db = defaultDb()): Promise<IndexInfo[]> {
  if (opts.documentIds && opts.documentIds.length === 0) return [];
  const rows = await db
    .select({ row: resumeIndexes, documentId: documentVersions.documentId })
    .from(resumeIndexes)
    .innerJoin(documentVersions, eq(documentVersions.id, resumeIndexes.documentVersionId))
    .innerJoin(documents, and(eq(documents.id, documentVersions.documentId), isNull(documents.deletedAt)))
    .where(
      and(
        sql`${documentVersions.version} = (select max(v.version) from document_versions v where v.document_id = ${documentVersions.documentId})`,
        opts.documentIds ? inArray(documentVersions.documentId, opts.documentIds) : undefined,
      ),
    );
  return rows.map((r) => toInfo(r.row, r.documentId));
}

export async function getIndexRow(id: string, db: Db = defaultDb()): Promise<ResumeIndexRow | null> {
  const [r] = await db.select().from(resumeIndexes).where(eq(resumeIndexes.id, id));
  return r ?? null;
}

export async function getIndexRowForVersion(versionId: string, db: Db = defaultDb()): Promise<ResumeIndexRow | null> {
  const [r] = await db.select().from(resumeIndexes).where(eq(resumeIndexes.documentVersionId, versionId));
  return r ?? null;
}

/** Atomically takes up to `n` queued indexes, oldest first, marking them running (safe if two servers share the database). */
export async function claimNextIndexes(n: number, db: Db = defaultDb()): Promise<string[]> {
  if (n <= 0) return [];
  const rows = await db.execute<{ id: string }>(sql`
    UPDATE resume_indexes
       SET status = 'running', started_at = now(), updated_at = now(), attempts = attempts + 1, error = NULL
     WHERE id IN (
       SELECT id FROM resume_indexes
        WHERE status = 'queued' AND document_version_id IS NOT NULL
        ORDER BY created_at, id LIMIT ${n} FOR UPDATE SKIP LOCKED
     )
 RETURNING id`);
  return rows.map((r) => r.id);
}

/** Puts abandoned running indexes back in the queue (or fails them after too many tries). */
export async function sweepStaleIndexes(db: Db = defaultDb()): Promise<number> {
  const rows = await db.execute<{ id: string }>(sql`
    UPDATE resume_indexes
       SET status = CASE WHEN attempts >= ${INDEX_MAX_ATTEMPTS} THEN 'failed' ELSE 'queued' END,
           error = CASE WHEN attempts >= ${INDEX_MAX_ATTEMPTS} THEN 'The server stopped while this was running, too many times in a row.' ELSE NULL END,
           finished_at = CASE WHEN attempts >= ${INDEX_MAX_ATTEMPTS} THEN now() ELSE NULL END,
           updated_at = now()
     WHERE status = 'running' AND document_version_id IS NOT NULL AND updated_at < now() - make_interval(secs => ${INDEX_STALE_SECONDS})
 RETURNING id`);
  return rows.length;
}

/** Heartbeat: tells the sweeper this index is still being worked on. */
export async function touchIndex(id: string, db: Db = defaultDb()) {
  await db.update(resumeIndexes).set({ updatedAt: new Date() }).where(and(eq(resumeIndexes.id, id), eq(resumeIndexes.status, "running")));
}

export type IndexDeps = {
  db?: Db;
  parse?: (text: string) => Promise<Profile>;
  embed?: (texts: string[]) => Promise<number[][]>;
};

/** A resume that came from an upload and is still only headings, bullets and paragraphs is worth structuring once. */
function needsStructuring(doc: DocumentRow, version: DocumentVersionRow): boolean {
  const fromUpload = doc.origin === "uploaded" || doc.origin === "pasted" || doc.legacyPastResumeId !== null;
  return doc.kind === "resume" && fromUpload && !hasStructure(version.content) && version.plainText.length >= MIN_TEXT_TO_STRUCTURE;
}

/**
 * Indexes one claimed version end to end. An unstructured upload is first structured by the model and replaced by a
 * structured version (which is queued on its own, so this index then ends with no sections of its own). Otherwise the
 * version is split into sections, each embedded and stored. Structuring is allowed to fail (the text is then split by
 * paragraph and the user is told); embedding is not, because without it there is nothing to search.
 */
export async function processResumeIndex(indexId: string, deps: IndexDeps = {}): Promise<void> {
  const db = deps.db ?? defaultDb();
  const row = await getIndexRow(indexId, db);
  if (!row || row.status !== "running" || !row.documentVersionId) return;
  const versionId = row.documentVersionId;

  try {
    const version = await getVersion(versionId, db);
    const doc = version ? await getDocument(version.documentId, db) : null;
    if (!version || !doc) throw new Error("The document was deleted.");
    addLlmIds({ documentVersionId: version.id, documentId: doc.id });

    let note: string | null = null;
    if (needsStructuring(doc, version)) {
      try {
        const parsed = await (deps.parse ?? parseResume)(version.plainText);
        const fromModel = profileToDoc(parsed);
        if (sectionsOf(fromModel).length === 0) {
          note = "The model found no sections in this resume. It was split by paragraph instead.";
        } else {
          const next = await addStructuredVersion(doc.id, version.id, keepCustomSections(fromModel, version.content), db);
          if (next) {
            await enqueueVersionIndex(next.id, {}, db);
            await db
              .update(resumeIndexes)
              .set({ status: "ready", note: "Replaced by a structured version.", chunkCount: 0, error: null, finishedAt: new Date(), updatedAt: new Date() })
              .where(eq(resumeIndexes.id, indexId));
            return;
          }
          note = "This was edited before it could be structured, so it was indexed as it is.";
        }
      } catch (err) {
        note = `Could not structure this resume (${err instanceof Error ? err.message : "unknown error"}). It was split by paragraph instead.`;
      }
    }

    const chunks = chunkDocument(version.content);
    if (chunks.length === 0) {
      // A new, blank resume has nothing to search yet. That is not an error; it is indexed when it has some text.
      await db.transaction(async (tx) => {
        await tx.delete(resumeChunks).where(eq(resumeChunks.documentVersionId, versionId));
        await tx
          .update(resumeIndexes)
          .set({ status: "ready", parsed: docToProfile(version.content), note: note ?? "There is no text to index yet.", error: null, chunkCount: 0, finishedAt: new Date(), updatedAt: new Date() })
          .where(eq(resumeIndexes.id, indexId));
      });
      return;
    }

    const vectors = await (deps.embed ?? ((t: string[]) => embedTexts(t)))(chunks.map((c) => `${c.label}\n${c.text}`));
    const model = env().EMBEDDING_MODEL;
    await db.transaction(async (tx) => {
      await tx.delete(resumeChunks).where(eq(resumeChunks.documentVersionId, versionId));
      await tx
        .insert(resumeChunks)
        .values(chunks.map((c, i) => ({ documentVersionId: versionId, ordinal: i, section: c.section, label: c.label, text: c.text, embedding: vectors[i], embeddingModel: model })));
      await tx
        .update(resumeIndexes)
        .set({ status: "ready", parsed: docToProfile(version.content), note, error: null, chunkCount: chunks.length, embeddingModel: model, finishedAt: new Date(), updatedAt: new Date() })
        .where(eq(resumeIndexes.id, indexId));
    });
  } catch (err) {
    await db
      .update(resumeIndexes)
      .set({ status: "failed", error: (err instanceof Error ? err.message : "Could not index this resume").slice(0, 500), finishedAt: new Date(), updatedAt: new Date() })
      .where(eq(resumeIndexes.id, indexId));
  }
}

export type ResumeMatch = { documentId: string; versionId: string; title: string; section: string; label: string; text: string; score: number };

/**
 * The resume sections closest in meaning to a query (a job description, a requirement, a question), best first.
 * Only the latest version of each library resume is searched. `score` is cosine similarity, 1 being identical. This
 * is the retrieval the writer will use to pick which of the user's real experience to draw on.
 */
export async function searchResumeChunks(
  query: string,
  opts: { limit?: number; documentIds?: string[] } = {},
  deps: { db?: Db; embedQuery?: (q: string) => Promise<number[]> } = {},
): Promise<ResumeMatch[]> {
  const db = deps.db ?? defaultDb();
  const vector = JSON.stringify(await (deps.embedQuery ?? ((q: string) => embedQuery(q)))(query));
  const distance = sql<number>`${resumeChunks.embedding} <=> ${vector}::vector`;
  const rows = await db
    .select({
      documentId: documents.id,
      versionId: documentVersions.id,
      title: documents.title,
      section: resumeChunks.section,
      label: resumeChunks.label,
      text: resumeChunks.text,
      distance,
    })
    .from(resumeChunks)
    .innerJoin(documentVersions, eq(documentVersions.id, resumeChunks.documentVersionId))
    .innerJoin(documents, and(eq(documents.id, documentVersions.documentId), isNull(documents.deletedAt), eq(documents.kind, "resume")))
    .where(
      and(
        sql`${documentVersions.version} = (select max(v.version) from document_versions v where v.document_id = ${documents.id})`,
        opts.documentIds ? inArray(documents.id, opts.documentIds) : undefined,
      ),
    )
    .orderBy(distance, desc(documentVersions.version))
    .limit(opts.limit ?? 8);
  return rows.map(({ distance: d, ...r }) => ({ ...r, score: 1 - Number(d) }));
}
