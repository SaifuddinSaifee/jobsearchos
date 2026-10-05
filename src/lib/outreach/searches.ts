import { and, desc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import { db as defaultDb, type Db } from "@/lib/db";
import { contactSearches, jobs, type ContactSearchRow } from "@/lib/db/schema";
import type { SearchItem, SearchSteps } from "./types";

/** A running search that has not reported for this long is considered abandoned (its worker died). */
export const SEARCH_STALE_SECONDS = 90;
export const SEARCH_MAX_ATTEMPTS = 3;
/** Finished searches stay in the sidebar and toasts for this long. */
export const RECENT_MINUTES = 10;

const iso = (d: Date | null) => (d ? d.toISOString() : null);

function toItem(r: ContactSearchRow, label: string): SearchItem {
  return {
    id: r.id,
    jobId: r.jobId,
    label,
    status: r.status,
    steps: r.steps,
    found: r.found,
    notes: r.notes,
    error: r.error,
    createdAt: r.createdAt.toISOString(),
    finishedAt: iso(r.finishedAt),
  };
}

const jobLabel = (j: { company: string; title: string } | undefined) => (j ? `${j.company} - ${j.title}` : "Unknown job");

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === "23505" || e?.cause?.code === "23505";
}

/**
 * Queues a search for a job. If one is already waiting or running for that job it is returned instead, so a second
 * click (or a second tab) never starts a duplicate. Older finished searches for the job are dropped: only the latest
 * result is kept.
 */
export async function enqueueSearch(jobId: string, db: Db = defaultDb()): Promise<{ item: SearchItem; alreadyActive: boolean }> {
  const [job] = await db.select({ company: jobs.company, title: jobs.title }).from(jobs).where(and(eq(jobs.id, jobId), isNull(jobs.deletedAt)));
  if (!job) throw new Error("That job no longer exists.");
  const label = jobLabel(job);

  const active = async () => {
    const [r] = await db
      .select()
      .from(contactSearches)
      .where(and(eq(contactSearches.jobId, jobId), inArray(contactSearches.status, ["queued", "running"])));
    return r ?? null;
  };
  const existing = await active();
  if (existing) return { item: toItem(existing, label), alreadyActive: true };

  await db.delete(contactSearches).where(and(eq(contactSearches.jobId, jobId), inArray(contactSearches.status, ["done", "failed"])));
  try {
    const [row] = await db.insert(contactSearches).values({ jobId }).returning();
    return { item: toItem(row, label), alreadyActive: false };
  } catch (err) {
    // Another request queued one between our check and the insert.
    const raced = isUniqueViolation(err) ? await active() : null;
    if (raced) return { item: toItem(raced, label), alreadyActive: true };
    throw err;
  }
}

async function withLabels(rows: ContactSearchRow[], db: Db): Promise<SearchItem[]> {
  if (rows.length === 0) return [];
  const found = await db
    .select({ id: jobs.id, company: jobs.company, title: jobs.title })
    .from(jobs)
    .where(inArray(jobs.id, [...new Set(rows.map((r) => r.jobId))]));
  const byId = new Map(found.map((j) => [j.id, j]));
  return rows.map((r) => toItem(r, jobLabel(byId.get(r.jobId))));
}

/** Searches that are working, plus ones that finished recently (for the sidebar and toasts), newest first. */
export async function listSearches(db: Db = defaultDb()): Promise<SearchItem[]> {
  const since = new Date(Date.now() - RECENT_MINUTES * 60_000);
  const rows = await db
    .select()
    .from(contactSearches)
    .where(or(inArray(contactSearches.status, ["queued", "running"]), gte(contactSearches.finishedAt, since)))
    .orderBy(desc(contactSearches.createdAt))
    .limit(50);
  return withLabels(rows, db);
}

/** The latest search for a job, whatever its state. */
export async function latestSearchForJob(jobId: string, db: Db = defaultDb()): Promise<SearchItem | null> {
  const [row] = await db.select().from(contactSearches).where(eq(contactSearches.jobId, jobId)).orderBy(desc(contactSearches.createdAt)).limit(1);
  return row ? (await withLabels([row], db))[0] : null;
}

export async function getSearchRow(id: string, db: Db = defaultDb()): Promise<ContactSearchRow | null> {
  const [r] = await db.select().from(contactSearches).where(eq(contactSearches.id, id));
  return r ?? null;
}

/** Atomically takes up to `n` queued searches, oldest first, marking them running (safe if two servers share the database). */
export async function claimNextSearches(n: number, db: Db = defaultDb()): Promise<string[]> {
  if (n <= 0) return [];
  const rows = await db.execute<{ id: string }>(sql`
    UPDATE contact_searches
       SET status = 'running', started_at = now(), updated_at = now(), attempts = attempts + 1, steps = '{}'::jsonb, error = NULL
     WHERE id IN (
       SELECT id FROM contact_searches WHERE status = 'queued' ORDER BY created_at, id LIMIT ${n} FOR UPDATE SKIP LOCKED
     )
 RETURNING id`);
  return rows.map((r) => r.id);
}

/** Puts abandoned running searches back in the queue (or fails them after too many tries). */
export async function sweepStaleSearches(db: Db = defaultDb()): Promise<number> {
  const rows = await db.execute<{ id: string }>(sql`
    UPDATE contact_searches
       SET status = CASE WHEN attempts >= ${SEARCH_MAX_ATTEMPTS} THEN 'failed' ELSE 'queued' END,
           error = CASE WHEN attempts >= ${SEARCH_MAX_ATTEMPTS} THEN 'The server stopped while this was running, too many times in a row.' ELSE NULL END,
           finished_at = CASE WHEN attempts >= ${SEARCH_MAX_ATTEMPTS} THEN now() ELSE NULL END,
           steps = '{}'::jsonb,
           updated_at = now()
     WHERE status = 'running' AND updated_at < now() - make_interval(secs => ${SEARCH_STALE_SECONDS})
 RETURNING id`);
  return rows.length;
}

export async function saveSearchSteps(id: string, steps: SearchSteps, db: Db = defaultDb()) {
  await db.update(contactSearches).set({ steps, updatedAt: new Date() }).where(eq(contactSearches.id, id));
}

/** Heartbeat: tells the sweeper this search is still being worked on. */
export async function touchSearch(id: string, db: Db = defaultDb()) {
  await db.update(contactSearches).set({ updatedAt: new Date() }).where(and(eq(contactSearches.id, id), eq(contactSearches.status, "running")));
}

export async function markSearchDone(id: string, found: number, notes: string[], db: Db = defaultDb()) {
  await db
    .update(contactSearches)
    .set({ status: "done", found, notes, error: null, finishedAt: new Date(), updatedAt: new Date() })
    .where(eq(contactSearches.id, id));
}

export async function markSearchFailed(id: string, message: string, db: Db = defaultDb()) {
  await db
    .update(contactSearches)
    .set({ status: "failed", error: message.slice(0, 500), finishedAt: new Date(), updatedAt: new Date() })
    .where(eq(contactSearches.id, id));
}
