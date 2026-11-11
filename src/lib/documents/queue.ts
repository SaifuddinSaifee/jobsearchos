import type { Db } from "@/lib/db";
import { kickWorker } from "@/lib/queue/worker";
import { enqueueDocumentIndex } from "@/lib/resume/indexing";

/**
 * Queues a new or changed resume to be read into sections, and wakes the worker. Nothing goes to the career record
 * from here: the user chooses what to add (see `src/lib/career/offer.ts`). A queue failure is logged, not raised: the
 * document is already saved, and the worker's startup pass picks up anything missed.
 */
export async function enqueueAfterCreate(documentId: string, db?: Db): Promise<void> {
  try {
    const queued = await enqueueDocumentIndex(documentId, {}, db);
    if (queued) kickWorker();
  } catch (err) {
    console.error("[library] could not queue reading:", err instanceof Error ? err.message : err);
  }
}
