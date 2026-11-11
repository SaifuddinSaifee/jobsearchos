import { and, desc, inArray, isNull } from "drizzle-orm";
import { enqueueDocumentSource, enqueueProfileSource } from "@/lib/career/queue";
import { documents } from "@/lib/db/schema";
import type { DbOrTx } from "@/lib/documents/service";

/**
 * Queues every library resume and cover letter (base first, then newest first) and the Profile, the way building the
 * record used to: nothing left out before is queued again. Tests use it to set up a queue of sources.
 */
export async function queueEverything(db: DbOrTx): Promise<{ queued: number; skipped: number }> {
  const rows = await db
    .select({ id: documents.id })
    .from(documents)
    .where(and(isNull(documents.deletedAt), inArray(documents.kind, ["resume", "cover_letter"])))
    .orderBy(desc(documents.isBase), desc(documents.writtenOn), desc(documents.createdAt));
  const outcomes = [];
  for (const r of rows) outcomes.push(await enqueueDocumentSource(r.id, db));
  outcomes.push(await enqueueProfileSource(db));
  const real = outcomes.filter((o) => o !== null);
  return { queued: real.filter((o) => o.status === "queued").length, skipped: real.filter((o) => o.status === "skipped").length };
}
