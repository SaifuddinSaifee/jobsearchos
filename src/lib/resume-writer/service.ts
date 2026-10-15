import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db as defaultDb, type Db } from "@/lib/db";
import { applications, documents, jobs, resumeGenerations, type ResumeGenerationRow } from "@/lib/db/schema";
import type { PreviousState } from "@/lib/jobs/types";
import { changeStatus } from "@/lib/jobs/tracker";
import { getLatest, saveVersion } from "@/lib/profile/service";
import { reviewsRequirements } from "@/lib/profile/schema";
import {
  OPEN_STATUSES,
  type ActiveGeneration,
  type GenerationItem,
  type JobDocument,
  type JobResumeState,
  type ReviewAnswer,
} from "./types";

// The life of a resume being written for a job: asked for, matched, reviewed, written, done (or stopped or failed).
// Everything here is plain database work; the model calls happen in `process.ts`, run by the background worker.

/** A generation that has not reported for this long is considered abandoned (its worker died). */
export const GENERATION_STALE_SECONDS = 90;
export const GENERATION_MAX_ATTEMPTS = 3;
/** How long a finished generation stays in the sidebar's list, so a page that was open can tell the user it finished. */
const RECENT_SECONDS = 90;
const MAX_NOTE_CHARS = 200;

export class GenerationError extends Error {
  constructor(
    message: string,
    public readonly code: "no_job" | "exists" | "state",
  ) {
    super(message);
    this.name = "GenerationError";
  }
}

export const toItem = (r: ResumeGenerationRow): GenerationItem => ({
  id: r.id,
  jobId: r.jobId,
  documentId: r.documentId,
  status: r.status,
  source: r.source,
  recordVersion: r.recordVersion,
  requirements: r.requirements,
  skipReview: r.skipReview,
  steps: r.steps,
  notes: r.notes,
  error: r.error,
  createdAt: r.createdAt.toISOString(),
  finishedAt: r.finishedAt?.toISOString() ?? null,
});

export async function getGenerationRow(id: string, db: Db = defaultDb()): Promise<ResumeGenerationRow | null> {
  const [row] = await db.select().from(resumeGenerations).where(eq(resumeGenerations.id, id));
  return row ?? null;
}

/** The newest generation for a job, whatever state it is in. */
export async function getLatestGeneration(jobId: string, db: Db = defaultDb()): Promise<ResumeGenerationRow | null> {
  const [row] = await db.select().from(resumeGenerations).where(eq(resumeGenerations.jobId, jobId)).orderBy(desc(resumeGenerations.createdAt)).limit(1);
  return row ?? null;
}

/** The resume already written for a job, if any: a job has at most one, and writing again makes a new version of it. */
export async function findJobResume(jobId: string, db: Db = defaultDb()) {
  const [doc] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.jobId, jobId), eq(documents.kind, "resume"), eq(documents.origin, "generated"), isNull(documents.deletedAt)))
    .orderBy(desc(documents.createdAt))
    .limit(1);
  return doc ?? null;
}

/** Every resume and cover letter linked to a job, newest first, with its latest version and whether it is locked. */
export async function listJobDocuments(jobId: string, db: Db = defaultDb()): Promise<JobDocument[]> {
  const rows = await db
    .select({
      id: documents.id,
      kind: documents.kind,
      origin: documents.origin,
      title: documents.title,
      updatedAt: documents.updatedAt,
      // The table is named in full: drizzle writes a bare "id" for a column inside a subquery, which would be the inner table's.
      version: sql<number>`coalesce((select max(v.version) from document_versions v where v.document_id = documents.id), 0)::int`,
      locked: sql<boolean>`exists (select 1 from document_versions v where v.document_id = documents.id and v.locked_at is not null)`,
    })
    .from(documents)
    .where(and(eq(documents.jobId, jobId), isNull(documents.deletedAt), inArray(documents.kind, ["resume", "cover_letter"])))
    .orderBy(desc(documents.updatedAt));
  return rows.map((r) => ({ id: r.id, kind: r.kind as JobDocument["kind"], origin: r.origin, title: r.title, version: r.version, locked: r.locked, updatedAt: r.updatedAt.toISOString() }));
}

/** What the job drawer and the resume page show about writing a resume for a job. */
export async function getJobResumeState(jobId: string, db: Db = defaultDb()): Promise<JobResumeState> {
  const [latest, resume, docs] = await Promise.all([getLatestGeneration(jobId, db), findJobResume(jobId, db), listJobDocuments(jobId, db)]);
  return { generation: latest ? toItem(latest) : null, documentId: resume?.id ?? null, documents: docs };
}

/** Moves a job from Saved to Preparing (only from Saved). Returns what Undo needs, or nothing when the status was left alone. */
export async function startPreparing(jobId: string, db: Db = defaultDb()): Promise<PreviousState[]> {
  const [app] = await db.select({ id: applications.id, status: applications.status }).from(applications).where(eq(applications.jobId, jobId));
  if (!app || app.status !== "saved") return [];
  return (await changeStatus(app.id, "preparing", { note: "Writing a resume" }, db)).previous;
}

/**
 * Asks for a resume for a job. If one is already being written (or waiting for review) that one is returned. A job
 * that already has a resume is only written again when asked to `regenerate`, into the same document. Starting moves
 * the job to Preparing right away only when the review step is off; otherwise that happens when the user says write.
 */
export async function startGeneration(
  jobId: string,
  opts: { regenerate?: boolean } = {},
  db: Db = defaultDb(),
): Promise<{ generation: ResumeGenerationRow; previous: PreviousState[] }> {
  const [job] = await db.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.id, jobId), isNull(jobs.deletedAt)));
  if (!job) throw new GenerationError("That job no longer exists.", "no_job");

  const open = async () => {
    const [row] = await db.select().from(resumeGenerations).where(and(eq(resumeGenerations.jobId, jobId), inArray(resumeGenerations.status, [...OPEN_STATUSES])));
    return row ?? null;
  };
  const already = await open();
  if (already) return { generation: already, previous: [] };

  const existing = await findJobResume(jobId, db);
  if (existing && !opts.regenerate) throw new GenerationError("This job already has a resume. Write it again from the editor.", "exists");

  const skipReview = !reviewsRequirements((await getLatest(db))?.generationInstructions);
  try {
    const [row] = await db.insert(resumeGenerations).values({ jobId, documentId: existing?.id ?? null, skipReview }).returning();
    return { generation: row, previous: skipReview ? await startPreparing(jobId, db) : [] };
  } catch (err) {
    // Two clicks at once: the one-open index lets only one win, and the other gets that one.
    if (String((err as { cause?: unknown }).cause ?? err).includes("resume_generations_one_open_idx")) {
      const won = await open();
      if (won) return { generation: won, previous: [] };
    }
    throw err;
  }
}

/**
 * The user's answers on the review screen: what they have, with an optional note, and whether to skip this screen from
 * now on. Moves the generation on to writing and the job to Preparing (returning what Undo needs).
 */
export async function saveReview(
  id: string,
  input: { answers: ReviewAnswer[]; skipReviewNextTime?: boolean },
  db: Db = defaultDb(),
): Promise<{ generation: ResumeGenerationRow; previous: PreviousState[] }> {
  const row = await getGenerationRow(id, db);
  if (!row || row.status !== "review") throw new GenerationError("This resume is not waiting for review.", "state");
  const answers = new Map(input.answers.map((a) => [a.id, a]));
  const requirements = row.requirements.map((r) => {
    const a = answers.get(r.id);
    return a ? { ...r, userHas: a.userHas, note: a.userHas ? a.note.trim().slice(0, MAX_NOTE_CHARS) : "" } : r;
  });

  const [generation] = await db
    .update(resumeGenerations)
    .set({ status: "writing_queued", requirements, updatedAt: new Date() })
    .where(and(eq(resumeGenerations.id, id), eq(resumeGenerations.status, "review")))
    .returning();
  if (!generation) throw new GenerationError("This resume is not waiting for review.", "state");

  if (input.skipReviewNextTime) {
    const latest = await getLatest(db);
    if (latest) await saveVersion({ generationInstructions: { ...latest.generationInstructions, reviewRequirements: false } }, db);
  }
  return { generation, previous: await startPreparing(row.jobId, db) };
}

/** Stops a generation that is not finished (cancelling what it is doing is the worker's part). Null if it was not open. */
export async function stopGeneration(id: string, db: Db = defaultDb()): Promise<ResumeGenerationRow | null> {
  const [row] = await db
    .update(resumeGenerations)
    .set({ status: "stopped", finishedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(resumeGenerations.id, id), inArray(resumeGenerations.status, [...OPEN_STATUSES])))
    .returning();
  return row ?? null;
}

/** The generations in progress, and those that ended in the last minute or so, with the job each is for. */
export async function listActiveGenerations(db: Db = defaultDb()): Promise<ActiveGeneration[]> {
  const rows = await db
    .select({ g: resumeGenerations, title: jobs.title, company: jobs.company })
    .from(resumeGenerations)
    .innerJoin(jobs, eq(jobs.id, resumeGenerations.jobId))
    .where(
      sql`${resumeGenerations.status} in ('queued', 'matching', 'review', 'writing_queued', 'writing')
        or (${resumeGenerations.status} in ('done', 'failed') and ${resumeGenerations.finishedAt} > now() - make_interval(secs => ${RECENT_SECONDS}))`,
    )
    .orderBy(desc(resumeGenerations.createdAt));
  return rows.map((r) => ({ ...toItem(r.g), jobLabel: `${r.title} at ${r.company}` }));
}

// ---- The queue the worker works off ----

/**
 * Atomically takes the next generation to work on: one waiting to be written first (the user is waiting for it), then
 * one waiting to be matched. It becomes `writing` or `matching`. Returns its id and which, or null.
 */
export async function claimNextGeneration(db: Db = defaultDb()): Promise<{ id: string; status: "matching" | "writing" } | null> {
  const rows = await db.execute<{ id: string; status: "matching" | "writing" }>(sql`
    UPDATE resume_generations
       SET status = CASE status WHEN 'writing_queued' THEN 'writing' ELSE 'matching' END,
           started_at = CASE status WHEN 'queued' THEN now() ELSE started_at END,
           updated_at = now(), attempts = attempts + 1, error = NULL
     WHERE id = (
       SELECT id FROM resume_generations
        WHERE status IN ('queued', 'writing_queued')
        ORDER BY (status = 'writing_queued') DESC, created_at LIMIT 1 FOR UPDATE SKIP LOCKED
     )
 RETURNING id, status`);
  return rows[0] ?? null;
}

const STALE_ERROR = "The server stopped while this was running, too many times in a row.";

/** Puts abandoned generations back where they were waiting (or fails them after too many tries). */
export async function sweepStaleGenerations(db: Db = defaultDb()): Promise<number> {
  const rows = await db.execute<{ id: string }>(sql`
    UPDATE resume_generations
       SET status = CASE WHEN attempts >= ${GENERATION_MAX_ATTEMPTS} THEN 'failed' WHEN status = 'writing' THEN 'writing_queued' ELSE 'queued' END,
           error = CASE WHEN attempts >= ${GENERATION_MAX_ATTEMPTS} THEN ${STALE_ERROR} ELSE NULL END,
           finished_at = CASE WHEN attempts >= ${GENERATION_MAX_ATTEMPTS} THEN now() ELSE NULL END,
           updated_at = now()
     WHERE status IN ('matching', 'writing') AND updated_at < now() - make_interval(secs => ${GENERATION_STALE_SECONDS})
 RETURNING id`);
  return rows.length;
}

/** Puts back every generation left running when the server stopped. Only safe at startup, before this process claims any. */
export async function recoverInterruptedGenerations(db: Db = defaultDb()): Promise<number> {
  const rows = await db.execute<{ id: string }>(sql`
    UPDATE resume_generations
       SET status = CASE WHEN attempts >= ${GENERATION_MAX_ATTEMPTS} THEN 'failed' WHEN status = 'writing' THEN 'writing_queued' ELSE 'queued' END,
           error = CASE WHEN attempts >= ${GENERATION_MAX_ATTEMPTS} THEN ${STALE_ERROR} ELSE NULL END,
           finished_at = CASE WHEN attempts >= ${GENERATION_MAX_ATTEMPTS} THEN now() ELSE NULL END,
           updated_at = now()
     WHERE status IN ('matching', 'writing')
 RETURNING id`);
  return rows.length;
}

/** Heartbeat: tells the sweeper this generation is still being worked on. */
export async function touchGeneration(id: string, db: Db = defaultDb()) {
  await db
    .update(resumeGenerations)
    .set({ updatedAt: new Date() })
    .where(and(eq(resumeGenerations.id, id), inArray(resumeGenerations.status, ["matching", "writing"])));
}
