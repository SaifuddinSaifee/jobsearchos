import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db as defaultDb } from "@/lib/db";
import { careerCompactions, type CareerCompactionRow } from "@/lib/db/schema";
import { newId as defaultNewId, type IdGen } from "@/lib/documents/build";
import type { DbOrTx } from "@/lib/documents/service";
import { modelClusterer, type Clusterer } from "./cluster";
import { applyAnswers, compactRecord } from "./compact";
import { CompactionAnswersSchema, CompactionResultSchema, type CompactionAnswers, type CompactionResult } from "./compact-schema";
import { modelDescriber, type Describer } from "./describe";
import { ProposalError } from "./review";
import type { CompactionStatus } from "./schema";
import { currentRecord, RecordConflict, saveRecordVersion } from "./service";

// The tidy of the career record as a piece of work: started by the user, worked out by the background worker, reviewed,
// then applied as a new version or dismissed. At most one is open at a time.

export const COMPACTION_STALE_SECONDS = 120;
export const COMPACTION_MAX_ATTEMPTS = 2;

const OPEN: CompactionStatus[] = ["queued", "running", "ready"];

/** Queues a tidy of the record, or returns the one already open. */
export async function startCompaction(db: DbOrTx = defaultDb()): Promise<{ id: string; started: boolean }> {
  const [open] = await db.select({ id: careerCompactions.id }).from(careerCompactions).where(inArray(careerCompactions.status, OPEN)).limit(1);
  if (open) return { id: open.id, started: false };
  try {
    const [row] = await db.insert(careerCompactions).values({}).returning({ id: careerCompactions.id });
    return { id: row.id, started: true };
  } catch (err) {
    // Two clicks at once: the one-open index lets only one in.
    if (!String((err as { cause?: unknown }).cause ?? err).includes("career_compactions_one_open_idx")) throw err;
    const [again] = await db.select({ id: careerCompactions.id }).from(careerCompactions).where(inArray(careerCompactions.status, OPEN)).limit(1);
    return { id: again.id, started: false };
  }
}

/** Atomically takes the queued tidy, if any. Returns its id, or null. */
export async function claimNextCompaction(db: DbOrTx = defaultDb()): Promise<string | null> {
  const rows = await db.execute<{ id: string }>(sql`
    UPDATE career_compactions
       SET status = 'running', started_at = now(), updated_at = now(), attempts = attempts + 1, error = NULL
     WHERE id = (SELECT id FROM career_compactions WHERE status = 'queued' ORDER BY created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED)
 RETURNING id`);
  return rows[0]?.id ?? null;
}

/**
 * Puts a tidy left running back in the queue (or fails it after too many tries). With `all`, every running one: only
 * safe at startup, before this process has claimed anything.
 */
export async function sweepStaleCompactions(db: DbOrTx = defaultDb(), opts: { all?: boolean } = {}): Promise<number> {
  const stale = opts.all ? sql`true` : sql`updated_at < now() - make_interval(secs => ${COMPACTION_STALE_SECONDS})`;
  const rows = await db.execute<{ id: string }>(sql`
    UPDATE career_compactions
       SET status = CASE WHEN attempts >= ${COMPACTION_MAX_ATTEMPTS} THEN 'failed' ELSE 'queued' END,
           error = CASE WHEN attempts >= ${COMPACTION_MAX_ATTEMPTS} THEN 'The server stopped while this was running, too many times in a row.' ELSE NULL END,
           finished_at = CASE WHEN attempts >= ${COMPACTION_MAX_ATTEMPTS} THEN now() ELSE NULL END,
           updated_at = now()
     WHERE status = 'running' AND ${stale}
 RETURNING id`);
  return rows.length;
}

/** Heartbeat: tells the sweeper this tidy is still being worked out. */
export async function touchCompaction(id: string, db: DbOrTx = defaultDb()) {
  await db.update(careerCompactions).set({ updatedAt: new Date() }).where(and(eq(careerCompactions.id, id), eq(careerCompactions.status, "running")));
}

export async function getCompactionRow(id: string, db: DbOrTx = defaultDb()): Promise<CareerCompactionRow | null> {
  const [row] = await db.select().from(careerCompactions).where(eq(careerCompactions.id, id));
  return row ?? null;
}

export type CompactionDeps = { db?: DbOrTx; cluster?: Clusterer; describe?: Describer; newId?: IdGen };

/** Works out one claimed tidy against the newest record and saves it for review. Failures are recorded on its row. */
export async function processCompaction(id: string, deps: CompactionDeps = {}): Promise<void> {
  const db = deps.db ?? defaultDb();
  try {
    const current = await currentRecord(db);
    const result = await compactRecord(current, {
      cluster: deps.cluster ?? modelClusterer,
      describe: deps.describe ?? modelDescriber,
      newId: deps.newId ?? defaultNewId,
    });
    await db
      .update(careerCompactions)
      .set({ status: "ready", result, baseVersion: current.version, answers: {}, finishedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(careerCompactions.id, id), eq(careerCompactions.status, "running")));
  } catch (err) {
    await failCompaction(id, err, db);
  }
}

export async function failCompaction(id: string, err: unknown, db: DbOrTx = defaultDb()) {
  await db
    .update(careerCompactions)
    .set({ status: "failed", error: (err instanceof Error ? err.message : "Could not tidy the record").slice(0, 500), finishedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(careerCompactions.id, id), eq(careerCompactions.status, "running")));
}

export type OpenCompaction =
  | { id: string; status: "queued"; startedAt: null }
  | { id: string; status: "running"; startedAt: string | null }
  | { id: string; status: "ready"; result: CompactionResult; answers: CompactionAnswers }
  | { id: string; status: "failed"; error: string };

/** The tidy to show: one in progress or waiting for review, or the last one if it failed and nothing came after it. */
export async function getOpenCompaction(db: DbOrTx = defaultDb()): Promise<OpenCompaction | null> {
  const [row] = await db.select().from(careerCompactions).orderBy(desc(careerCompactions.createdAt)).limit(1);
  if (!row) return null;
  if (row.status === "queued") return { id: row.id, status: "queued", startedAt: null };
  if (row.status === "running") return { id: row.id, status: "running", startedAt: row.startedAt?.toISOString() ?? null };
  if (row.status === "failed") return { id: row.id, status: "failed", error: row.error ?? "Could not tidy the record." };
  if (row.status !== "ready" || !row.result) return null;
  return { id: row.id, status: "ready", result: CompactionResultSchema.parse(row.result), answers: CompactionAnswersSchema.parse(row.answers) };
}

/** Keeps the user's answers while they review, so a reload loses nothing. */
export async function saveCompactionAnswers(id: string, answers: CompactionAnswers, db: DbOrTx = defaultDb()): Promise<void> {
  const rows = await db
    .update(careerCompactions)
    .set({ answers: CompactionAnswersSchema.parse(answers), updatedAt: new Date() })
    .where(and(eq(careerCompactions.id, id), eq(careerCompactions.status, "ready")))
    .returning({ id: careerCompactions.id });
  if (rows.length === 0) throw new ProposalError("This tidy is no longer waiting for review.");
}

/**
 * Saves the tidied record, with the user's answers, as a new version. If the record changed since it was worked out,
 * the tidy is queued to be worked out again (answers are dropped, since the questions may differ) and a stale error is
 * raised.
 */
export async function applyCompaction(id: string, db: DbOrTx = defaultDb(), now: Date = new Date()): Promise<{ version: number }> {
  const row = await getCompactionRow(id, db);
  if (!row || row.status !== "ready" || !row.result) throw new ProposalError("This tidy is no longer waiting for review.");
  const result = CompactionResultSchema.parse(row.result);
  const current = await currentRecord(db);
  if (current.version !== result.baseVersion) {
    await requeue(id, db);
    throw new ProposalError("Your record changed since this tidy was worked out. It is being worked out again.", true);
  }
  const record = applyAnswers(result, CompactionAnswersSchema.parse(row.answers), now);
  const facts = (r: CompactionResult["roles"]) => r.reduce((n, x) => [n[0] + x.factsBefore, n[1] + x.factsAfter], [0, 0]);
  const [before, after] = facts(result.roles);
  try {
    const saved = await saveRecordVersion(
      { record, reason: "compact", note: `Tidied the record: ${before} facts became ${after}`, expectedVersion: current.version },
      db,
    );
    await db
      .update(careerCompactions)
      .set({ status: "applied", appliedVersionId: saved.id, finishedAt: now, updatedAt: now })
      .where(and(eq(careerCompactions.id, id), eq(careerCompactions.status, "ready")));
    return { version: saved.version };
  } catch (err) {
    if (err instanceof RecordConflict) {
      await requeue(id, db);
      throw new ProposalError("Your record changed while this was saving. It is being worked out again.", true);
    }
    throw err;
  }
}

async function requeue(id: string, db: DbOrTx) {
  await db
    .update(careerCompactions)
    .set({ status: "queued", result: null, baseVersion: null, answers: {}, attempts: 0, startedAt: null, finishedAt: null, updatedAt: new Date() })
    .where(and(eq(careerCompactions.id, id), eq(careerCompactions.status, "ready")));
}

/** Leaves the record as it is. A failed tidy is dismissed the same way, to clear it from view. */
export async function dismissCompaction(id: string, db: DbOrTx = defaultDb()): Promise<void> {
  await db
    .update(careerCompactions)
    .set({ status: "dismissed", finishedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(careerCompactions.id, id), inArray(careerCompactions.status, ["ready", "failed", "queued"])));
}
