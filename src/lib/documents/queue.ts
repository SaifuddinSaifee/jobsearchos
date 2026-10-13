import type { Db } from "@/lib/db";
import { kickWorker } from "@/lib/queue/worker";
import { enqueueDocumentIndex } from "@/lib/resume/indexing";

/**
 * Queues a new or changed resume for the search index and wakes the worker. A queue failure is logged, not raised:
 * the document is already saved, and the worker's startup pass picks up anything missed.
 */
export async function enqueueAfterCreate(documentId: string, db?: Db): Promise<void> {
  try {
    if (await enqueueDocumentIndex(documentId, {}, db)) kickWorker();
  } catch (err) {
    console.error("[library] could not queue indexing:", err instanceof Error ? err.message : err);
  }
}
