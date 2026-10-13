import { and, eq } from "drizzle-orm";
import { db as defaultDb, type Db } from "@/lib/db";
import { resumeIndexes, type QueueSteps } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { FetchError, type FetchStep } from "@/lib/jobs/fetch/types";
import { defaultPipelineDeps, runPipeline, type PipelineDeps } from "@/lib/jobs/pipeline";
import { saveJob } from "@/lib/jobs/service";
import { findContacts, type FindDeps } from "@/lib/outreach/service";
import {
  claimNextSearches,
  getSearchRow,
  markSearchDone,
  markSearchFailed,
  saveSearchSteps,
  sweepStaleSearches,
  touchSearch,
} from "@/lib/outreach/searches";
import type { SearchSteps } from "@/lib/outreach/types";
import { claimNextProposal, offerDocumentToRecord, processProposal, sweepStaleProposals, touchProposal } from "@/lib/career/queue";
import { careerProposals, documentVersions } from "@/lib/db/schema";
import { backfillDocuments } from "@/lib/documents/backfill";
import { backfillResumeIndexes, claimNextIndexes, processResumeIndex, sweepStaleIndexes, touchIndex } from "@/lib/resume/indexing";
import { isClean, reviewReason } from "./clean";
import {
  claimNext,
  getQueueRow,
  markDuplicate,
  markFailed,
  markNeedsReview,
  markSaved,
  saveSteps,
  sweepStale,
  touch,
} from "./service";

const TICK_MS = 3000;
const HEARTBEAT_MS = 20_000;
/** One item may take at most this long (fetching, rendering, AI, research). */
const ITEM_TIMEOUT_MS = 4 * 60_000;
/** A contact search is a few web calls and one ranking call; it should never take this long. */
const SEARCH_TIMEOUT_MS = 3 * 60_000;
/** Contact searches that may run at once, separate from job extractions so neither waits for the other. */
const SEARCH_CONCURRENCY = 2;
/** Resume files indexed at once. One, because embeddings run on the local Ollama model and a second would only slow both. */
const INDEX_CONCURRENCY = 1;
/** Reading, structuring and embedding one resume. */
const INDEX_TIMEOUT_MS = 5 * 60_000;
/** Preparing one source for the career record: reading it, and (with a model) grouping its bullets. */
const CAREER_TIMEOUT_MS = 5 * 60_000;

export type WorkerDeps = { pipeline: PipelineDeps; db: Db; save: typeof saveJob; run: typeof runPipeline };

/** Fetches, extracts and (when the result is clean) saves one claimed queue item, recording progress as it goes. */
export async function processItem(id: string, deps: Partial<WorkerDeps> = {}): Promise<void> {
  const db = deps.db ?? defaultDb();
  const save = deps.save ?? saveJob;
  const row = await getQueueRow(id, db);
  if (!row || row.status !== "running") return;

  const steps: QueueSteps = {};
  // Progress writes are chained so they land in order and never overlap.
  let chain: Promise<unknown> = Promise.resolve();
  const onStep = (s: FetchStep) => {
    steps[s.step] = { status: s.status, detail: s.detail };
    const snapshot = { ...steps };
    chain = chain.then(() => saveSteps(id, snapshot, db)).catch(() => {});
  };

  try {
    const run = deps.run ?? runPipeline;
    const result = await withTimeout(
      run(
        row.kind === "url" ? { kind: "url", url: row.input } : { kind: "text", text: row.input, url: row.sourceUrl ?? undefined },
        onStep,
        deps.pipeline ?? defaultPipelineDeps,
      ),
      ITEM_TIMEOUT_MS,
    );
    await chain;

    if (result.type === "duplicate") {
      await markDuplicate(id, result.job.id, `${result.job.company} - ${result.job.title}`, db);
      return;
    }

    const draft = result.draft;
    const label = `${draft.company.trim() || "Unknown company"} - ${draft.title.trim() || "Untitled"}`;
    if (!isClean(draft)) {
      await markNeedsReview(id, draft, label, reviewReason(draft), db);
      return;
    }
    const saved = await save(draft, db);
    if (saved.ok) await markSaved(id, saved.jobId, label, db);
    else await markDuplicate(id, saved.duplicate.id, `${saved.duplicate.company} - ${saved.duplicate.title}`, db);
  } catch (err) {
    await chain;
    const code = err instanceof FetchError ? err.code : "failed";
    const message =
      err instanceof FetchError && (err.code === "blocked" || err.code === "empty")
        ? `${err.message} Try pasting the job text instead.`
        : err instanceof Error
          ? err.message
          : "Could not process this job";
    await markFailed(id, message, code, db);
  }
}

/** Finds and ranks people for one claimed search, recording each step as it goes. The people are saved by `findContacts`. */
export async function processSearch(
  id: string,
  deps: { db?: Db; find?: typeof findContacts; timeoutMs?: number } = {},
): Promise<void> {
  const db = deps.db ?? defaultDb();
  const row = await getSearchRow(id, db);
  if (!row || row.status !== "running") return;

  const steps: SearchSteps = {};
  let chain: Promise<unknown> = Promise.resolve();
  const onStep: NonNullable<FindDeps["onStep"]> = (name, state) => {
    steps[name] = state;
    const snapshot = { ...steps };
    chain = chain.then(() => saveSearchSteps(id, snapshot, db)).catch(() => {});
  };

  try {
    const timeoutMs = deps.timeoutMs ?? SEARCH_TIMEOUT_MS;
    const result = await withTimeout((deps.find ?? findContacts)(row.jobId, { onStep }, db), timeoutMs, "Timed out after 3 minutes");
    await chain;
    await markSearchDone(id, result.found, result.notes, db);
  } catch (err) {
    await chain;
    await markSearchFailed(id, err instanceof Error ? err.message : "Could not search for people", db);
  }
}

/** Offers the document an index was for to the career record, which waited for the index to finish. Never raises. */
async function offerAfterIndex(indexId: string, db: Db): Promise<void> {
  try {
    const [row] = await db
      .select({ documentId: documentVersions.documentId })
      .from(resumeIndexes)
      .innerJoin(documentVersions, eq(documentVersions.id, resumeIndexes.documentVersionId))
      .where(eq(resumeIndexes.id, indexId));
    if (row) await offerDocumentToRecord(row.documentId, db);
  } catch (err) {
    console.error("[queue] could not offer a resume to the career record:", err instanceof Error ? err.message : err);
  }
}

/** Indexes one claimed resume version; failures are recorded on its row by `processResumeIndex`. */
export async function processIndex(indexId: string, deps: { db?: Db; run?: typeof processResumeIndex; timeoutMs?: number } = {}): Promise<void> {
  const db = deps.db ?? defaultDb();
  try {
    await withTimeout((deps.run ?? processResumeIndex)(indexId, { db }), deps.timeoutMs ?? INDEX_TIMEOUT_MS, "Timed out after 5 minutes");
  } catch (err) {
    await db
      .update(resumeIndexes)
      .set({ status: "failed", error: (err instanceof Error ? err.message : "Could not index this resume").slice(0, 500), finishedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(resumeIndexes.id, indexId), eq(resumeIndexes.status, "running")));
  }
  await offerAfterIndex(indexId, db);
}

/** Prepares one claimed career proposal; failures are recorded on its row by `processProposal`. */
export async function processCareer(id: string, deps: { db?: Db; run?: typeof processProposal; timeoutMs?: number } = {}): Promise<void> {
  const db = deps.db ?? defaultDb();
  try {
    await withTimeout((deps.run ?? processProposal)(id, { db }), deps.timeoutMs ?? CAREER_TIMEOUT_MS, "Timed out after 5 minutes");
  } catch (err) {
    await db
      .update(careerProposals)
      .set({ status: "failed", error: (err instanceof Error ? err.message : "Could not prepare this source").slice(0, 500), finishedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(careerProposals.id, id), eq(careerProposals.status, "running")));
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, message = "Timed out after 4 minutes"): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(message)), ms);
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    );
  });
}

type WorkerState = { running: Set<string>; searching: Set<string>; indexing: Set<string>; career: Set<string>; ticking: boolean; again: boolean; timer: ReturnType<typeof setInterval> | null };
const g = globalThis as unknown as { __queueWorker?: WorkerState };

/** One shared state per server process, even if this module is bundled more than once. */
function state(): WorkerState {
  const s = (g.__queueWorker ??= { running: new Set(), searching: new Set(), indexing: new Set(), career: new Set(), ticking: false, again: false, timer: null });
  // A dev server that hot-reloaded from older code may hold a state without the search slots.
  s.searching ??= new Set();
  s.indexing ??= new Set();
  s.career ??= new Set();
  return s;
}

/**
 * Claims work for any free slots. If it is asked to run while already running (e.g. two items finish at the
 * same moment), it runs once more afterwards instead of dropping the request and leaving a slot idle.
 */
async function tick(): Promise<void> {
  const s = state();
  if (s.ticking) {
    s.again = true;
    return;
  }
  s.ticking = true;
  try {
    do {
      s.again = false;
      await sweepStale();
      const free = env().QUEUE_CONCURRENCY - s.running.size;
      for (const id of await claimNext(free)) {
        s.running.add(id);
        const beat = setInterval(() => void touch(id).catch(() => {}), HEARTBEAT_MS);
        void processItem(id)
          .catch((err) => console.error("[queue] unexpected failure", id, err))
          .finally(() => {
            clearInterval(beat);
            s.running.delete(id);
            void tick();
          });
      }

      await sweepStaleSearches();
      for (const id of await claimNextSearches(SEARCH_CONCURRENCY - s.searching.size)) {
        s.searching.add(id);
        const beat = setInterval(() => void touchSearch(id).catch(() => {}), HEARTBEAT_MS);
        void processSearch(id)
          .catch((err) => console.error("[queue] unexpected search failure", id, err))
          .finally(() => {
            clearInterval(beat);
            s.searching.delete(id);
            void tick();
          });
      }

      await sweepStaleIndexes();
      for (const indexId of await claimNextIndexes(INDEX_CONCURRENCY - s.indexing.size)) {
        s.indexing.add(indexId);
        const beat = setInterval(() => void touchIndex(indexId).catch(() => {}), HEARTBEAT_MS);
        void processIndex(indexId)
          .catch((err) => console.error("[queue] unexpected index failure", indexId, err))
          .finally(() => {
            clearInterval(beat);
            s.indexing.delete(indexId);
            void tick();
          });
      }

      await sweepStaleProposals();
      // One at a time: a proposal is only prepared once the one before it has been reviewed.
      if (s.career.size === 0) {
        const careerId = await claimNextProposal();
        if (careerId) {
          s.career.add(careerId);
          const beat = setInterval(() => void touchProposal(careerId).catch(() => {}), HEARTBEAT_MS);
          void processCareer(careerId)
            .catch((err) => console.error("[queue] unexpected career failure", careerId, err))
            .finally(() => {
              clearInterval(beat);
              s.career.delete(careerId);
              void tick();
            });
        }
      }
    } while (s.again);
  } catch (err) {
    console.error("[queue] tick failed", err instanceof Error ? err.message : err);
  } finally {
    s.ticking = false;
  }
}

/** Starts the background worker once per server process (called from instrumentation.ts). */
export function startQueueWorker(): void {
  const s = state();
  if (s.timer) return;
  s.timer = setInterval(() => void tick(), TICK_MS);
  s.timer.unref?.();
  // Library resumes that have no index yet (added while the worker was off) get indexed now.
  void backfillDocuments()
    .then(() => backfillResumeIndexes())
    .catch((err) => console.error("[queue] library backfill failed", err instanceof Error ? err.message : err));
  void tick();
}

/** Wakes the worker right away (after items are added) instead of waiting for the next tick. */
export function kickWorker(): void {
  startQueueWorker();
  void tick();
}

