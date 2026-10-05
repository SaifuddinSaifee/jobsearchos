import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db as defaultDb, type Db } from "@/lib/db";
import {
  applicationQueue,
  jobs,
  type QueueRow,
  type QueueSteps,
} from "@/lib/db/schema";
import { canonicalizeUrl, isBlockedHost, parseJobUrl } from "@/lib/jobs/fetch/url";
import type { JobDraft } from "@/lib/jobs/schema";
import { MAX_PASTE_CHARS } from "@/lib/jobs/pipeline";
import { MAX_ACTIVE, MAX_BATCH, type QueueItem, type QueueSnapshot, type QueueStatus } from "./types";

/** A running item that has not reported for this long is considered abandoned (its worker died). */
export const STALE_SECONDS = 90;
export const MAX_ATTEMPTS = 3;

export type EnqueueResult = { queued: string[]; skipped: { input: string; reason: string }[] };

const iso = (d: Date | null) => (d ? d.toISOString() : null);

function urlLabel(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, "")}${u.pathname === "/" ? "" : u.pathname}`.slice(0, 120);
  } catch {
    return url.slice(0, 120);
  }
}

function toItem(r: Omit<QueueRow, "input" | "sourceUrl" | "draft" | "attempts" | "startedAt" | "updatedAt">): QueueItem {
  return {
    id: r.id,
    kind: r.kind,
    label: r.label,
    status: r.status,
    steps: r.steps,
    error: r.error,
    errorCode: r.errorCode,
    jobId: r.jobId,
    duplicateJobId: r.duplicateJobId,
    createdAt: r.createdAt.toISOString(),
    finishedAt: iso(r.finishedAt),
  };
}

async function activeCount(db: Db): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(applicationQueue)
    .where(inArray(applicationQueue.status, ["queued", "running", "needs_review"]));
  return row.n;
}

/**
 * Adds job URLs to the queue. Invalid URLs, sites that block fetching, jobs already saved and URLs already
 * queued are reported back instead of queued, so nothing is processed (and paid for) twice.
 */
export async function enqueueUrls(urls: string[], db: Db = defaultDb()): Promise<EnqueueResult> {
  const result: EnqueueResult = { queued: [], skipped: [] };
  const wanted = [...new Set(urls.map((u) => u.trim()).filter(Boolean))];
  const room = MAX_ACTIVE - (await activeCount(db));
  if (room <= 0) throw new Error(`The queue is full (${MAX_ACTIVE} items waiting). Finish or clear some first.`);

  const activeInputs = await db
    .select({ input: applicationQueue.input, sourceUrl: applicationQueue.sourceUrl, kind: applicationQueue.kind })
    .from(applicationQueue)
    .where(inArray(applicationQueue.status, ["queued", "running", "needs_review"]));
  const taken = new Set<string>();
  for (const a of activeInputs) {
    const u = a.kind === "url" ? a.input : a.sourceUrl;
    if (u) {
      try {
        taken.add(canonicalizeUrl(u));
      } catch {
        // an old row with an unparseable URL cannot clash
      }
    }
  }

  const rows: (typeof applicationQueue.$inferInsert)[] = [];
  const base = Date.now();
  for (const input of wanted) {
    if (rows.length >= MAX_BATCH || rows.length >= room) {
      result.skipped.push({ input, reason: `Only ${Math.min(MAX_BATCH, room)} can be added at a time` });
      continue;
    }
    let canonical: string;
    try {
      parseJobUrl(input);
      if (isBlockedHost(input)) {
        result.skipped.push({ input, reason: "This site blocks automated fetching. Paste the job text instead." });
        continue;
      }
      canonical = canonicalizeUrl(input);
    } catch (err) {
      result.skipped.push({ input, reason: err instanceof Error ? err.message : "Not a valid URL" });
      continue;
    }
    if (taken.has(canonical)) {
      result.skipped.push({ input, reason: "Already in the queue" });
      continue;
    }
    const [saved] = await db
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(eq(jobs.canonicalUrl, canonical), isNull(jobs.deletedAt)))
      .limit(1);
    if (saved) {
      result.skipped.push({ input, reason: "Already saved in Jobs" });
      continue;
    }
    taken.add(canonical);
    // One millisecond apart so a batch is processed (and listed) in the order it was pasted.
    rows.push({ kind: "url", input, label: urlLabel(input), createdAt: new Date(base + rows.length) });
  }

  if (rows.length) {
    const inserted = await db.insert(applicationQueue).values(rows).returning({ id: applicationQueue.id });
    result.queued = inserted.map((r) => r.id);
  }
  return result;
}

/** Adds one pasted posting (for sites that block fetching). `url` is optional and only used for de-duplication. */
export async function enqueueText(text: string, url: string | undefined, db: Db = defaultDb()): Promise<EnqueueResult> {
  const body = text.trim();
  if (!body) throw new Error("Paste the job description first");
  if (body.length > MAX_PASTE_CHARS) throw new Error("The pasted text is too long");
  if ((await activeCount(db)) >= MAX_ACTIVE) throw new Error(`The queue is full (${MAX_ACTIVE} items waiting).`);
  let sourceUrl: string | null = null;
  if (url?.trim()) {
    parseJobUrl(url);
    sourceUrl = url.trim();
  }
  const firstLine = body.split("\n").map((l) => l.trim()).find(Boolean) ?? "Pasted job";
  const [row] = await db
    .insert(applicationQueue)
    .values({ kind: "text", input: body, sourceUrl, label: `Pasted: ${firstLine.slice(0, 90)}` })
    .returning({ id: applicationQueue.id });
  return { queued: [row.id], skipped: [] };
}

/** Oldest first: that is the order the worker takes them, so the top of the list is what runs next. */
export async function listQueue(db: Db = defaultDb()): Promise<QueueSnapshot> {
  const rows = await db
    .select({
      id: applicationQueue.id,
      kind: applicationQueue.kind,
      label: applicationQueue.label,
      status: applicationQueue.status,
      steps: applicationQueue.steps,
      error: applicationQueue.error,
      errorCode: applicationQueue.errorCode,
      jobId: applicationQueue.jobId,
      duplicateJobId: applicationQueue.duplicateJobId,
      createdAt: applicationQueue.createdAt,
      finishedAt: applicationQueue.finishedAt,
    })
    .from(applicationQueue)
    .orderBy(asc(applicationQueue.createdAt), asc(applicationQueue.id))
    .limit(300);
  const counts: Record<QueueStatus, number> = { queued: 0, running: 0, saved: 0, needs_review: 0, duplicate: 0, failed: 0 };
  for (const r of rows) counts[r.status]++;
  return { items: rows.map(toItem), counts };
}

/** One item with its draft, for the review screen. */
export async function getQueueDraft(id: string, db: Db = defaultDb()): Promise<{ item: QueueItem; draft: JobDraft | null } | null> {
  const [r] = await db.select().from(applicationQueue).where(eq(applicationQueue.id, id));
  // Drafts stored before additional details existed lack the field.
  const draft = r?.draft ? { ...r.draft, additionalDetails: r.draft.additionalDetails ?? [] } : null;
  return r ? { item: toItem(r), draft } : null;
}

export async function getQueueRow(id: string, db: Db = defaultDb()): Promise<QueueRow | null> {
  const [r] = await db.select().from(applicationQueue).where(eq(applicationQueue.id, id));
  return r ?? null;
}

/**
 * Atomically takes up to `n` queued items, oldest first, marking them running. `SKIP LOCKED` makes this safe
 * if more than one server process (e.g. dev and production) shares the database.
 */
export async function claimNext(n: number, db: Db = defaultDb()): Promise<string[]> {
  if (n <= 0) return [];
  const rows = await db.execute<{ id: string }>(sql`
    UPDATE application_queue
       SET status = 'running', started_at = now(), updated_at = now(), attempts = attempts + 1, steps = '{}'::jsonb, error = NULL, error_code = NULL
     WHERE id IN (
       SELECT id FROM application_queue WHERE status = 'queued' ORDER BY created_at, id LIMIT ${n} FOR UPDATE SKIP LOCKED
     )
 RETURNING id`);
  return rows.map((r) => r.id);
}

/** Puts abandoned running items back in the queue (or fails them after too many tries). Returns how many it touched. */
export async function sweepStale(db: Db = defaultDb()): Promise<number> {
  const rows = await db.execute<{ id: string }>(sql`
    UPDATE application_queue
       SET status = CASE WHEN attempts >= ${MAX_ATTEMPTS} THEN 'failed'::queue_status ELSE 'queued'::queue_status END,
           error = CASE WHEN attempts >= ${MAX_ATTEMPTS} THEN 'The server stopped while this was running, too many times in a row.' ELSE NULL END,
           error_code = CASE WHEN attempts >= ${MAX_ATTEMPTS} THEN 'interrupted' ELSE NULL END,
           finished_at = CASE WHEN attempts >= ${MAX_ATTEMPTS} THEN now() ELSE NULL END,
           steps = '{}'::jsonb,
           updated_at = now()
     WHERE status = 'running' AND updated_at < now() - make_interval(secs => ${STALE_SECONDS})
 RETURNING id`);
  return rows.length;
}

export async function saveSteps(id: string, steps: QueueSteps, db: Db = defaultDb()) {
  await db.update(applicationQueue).set({ steps, updatedAt: new Date() }).where(eq(applicationQueue.id, id));
}

/** Heartbeat: tells the sweeper this item is still being worked on. */
export async function touch(id: string, db: Db = defaultDb()) {
  await db.update(applicationQueue).set({ updatedAt: new Date() }).where(and(eq(applicationQueue.id, id), eq(applicationQueue.status, "running")));
}

export async function markSaved(id: string, jobId: string, label: string, db: Db = defaultDb()) {
  await db
    .update(applicationQueue)
    .set({ status: "saved", jobId, label, draft: null, error: null, finishedAt: new Date(), updatedAt: new Date() })
    .where(eq(applicationQueue.id, id));
}

export async function markNeedsReview(id: string, draft: JobDraft, label: string, reason: string, db: Db = defaultDb()) {
  await db
    .update(applicationQueue)
    .set({ status: "needs_review", draft, label, error: reason, errorCode: "review", finishedAt: new Date(), updatedAt: new Date() })
    .where(eq(applicationQueue.id, id));
}

export async function markDuplicate(id: string, jobId: string, label: string, db: Db = defaultDb()) {
  await db
    .update(applicationQueue)
    .set({ status: "duplicate", duplicateJobId: jobId, label, draft: null, finishedAt: new Date(), updatedAt: new Date() })
    .where(eq(applicationQueue.id, id));
}

export async function markFailed(id: string, message: string, code: string, db: Db = defaultDb()) {
  await db
    .update(applicationQueue)
    .set({ status: "failed", error: message.slice(0, 500), errorCode: code, finishedAt: new Date(), updatedAt: new Date() })
    .where(eq(applicationQueue.id, id));
}

/** Failed items can be tried again; nothing else can. */
export async function retryItem(id: string, db: Db = defaultDb()): Promise<boolean> {
  const rows = await db
    .update(applicationQueue)
    .set({ status: "queued", error: null, errorCode: null, steps: {}, attempts: 0, finishedAt: null, updatedAt: new Date() })
    .where(and(eq(applicationQueue.id, id), eq(applicationQueue.status, "failed")))
    .returning({ id: applicationQueue.id });
  return rows.length > 0;
}

/** Removes an item from the list. A running item cannot be removed. */
export async function removeItem(id: string, db: Db = defaultDb()): Promise<boolean> {
  const rows = await db
    .delete(applicationQueue)
    .where(and(eq(applicationQueue.id, id), inArray(applicationQueue.status, ["queued", "needs_review", "saved", "duplicate", "failed"])))
    .returning({ id: applicationQueue.id });
  return rows.length > 0;
}

/** Clears everything that is finished (saved, duplicate, failed). Items waiting for a person stay. */
export async function clearFinished(db: Db = defaultDb()): Promise<number> {
  const rows = await db
    .delete(applicationQueue)
    .where(inArray(applicationQueue.status, ["saved", "duplicate", "failed"]))
    .returning({ id: applicationQueue.id });
  return rows.length;
}

