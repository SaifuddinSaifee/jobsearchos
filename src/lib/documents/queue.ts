import { offerDocumentToRecord } from "@/lib/career/queue";
import type { Db } from "@/lib/db";
import { kickWorker } from "@/lib/queue/worker";
import { enqueueDocumentIndex } from "@/lib/resume/indexing";

/**
 * Queues a new or changed resume for the search index, offers a new or changed resume or cover letter to the career
 * record (once one exists), and wakes the worker. A queue failure is logged, not raised: the document is already
 * saved, and the worker's startup pass picks up anything missed.
 */
export async function enqueueAfterCreate(documentId: string, db?: Db): Promise<void> {
  try {
    const queued = await enqueueDocumentIndex(documentId, {}, db);
    const offered = await offerDocumentToRecord(documentId, db);
    if (queued || offered?.status === "queued") kickWorker();
  } catch (err) {
    console.error("[library] could not queue indexing:", err instanceof Error ? err.message : err);
  }
}
