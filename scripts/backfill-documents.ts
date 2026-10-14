import "dotenv/config";
import { backfillDocuments } from "@/lib/documents/backfill";
import { backfillResumeIndexes } from "@/lib/resume/indexing";
import { db } from "@/lib/db";

/** Usage: npm run backfill:documents. Imports past resumes, the base resume and sent emails into the library, then queues indexing. */
async function main() {
  const result = await backfillDocuments();
  if (result.skipped) console.error("Another import is already running.");
  console.log(JSON.stringify(result, null, 2));
  console.log(`${await backfillResumeIndexes()} resumes queued for indexing`);
  await db().$client.end();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
