import { db as defaultDb, type Db } from "@/lib/db";
import { type QueueSteps } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { FetchError, type FetchStep } from "@/lib/jobs/fetch/types";
import { defaultPipelineDeps, runPipeline, type PipelineDeps } from "@/lib/jobs/pipeline";
import { saveJob } from "@/lib/jobs/service";
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

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("Timed out after 4 minutes")), ms);
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    );
  });
}

type WorkerState = { running: Set<string>; ticking: boolean; again: boolean; timer: ReturnType<typeof setInterval> | null };
const g = globalThis as unknown as { __queueWorker?: WorkerState };

/** One shared state per server process, even if this module is bundled more than once. */
function state(): WorkerState {
  return (g.__queueWorker ??= { running: new Set(), ticking: false, again: false, timer: null });
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
  void tick();
}

/** Wakes the worker right away (after items are added) instead of waiting for the next tick. */
export function kickWorker(): void {
  startQueueWorker();
  void tick();
}

