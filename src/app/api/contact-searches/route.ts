import { listSearches } from "@/lib/outreach/searches";
import { startQueueWorker } from "@/lib/queue/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Searches that are working or just finished, polled by the outreach page, the sidebar and the toasts. */
export async function GET() {
  // Same reason as /api/queue: bring the worker back after a restart that skipped instrumentation.
  startQueueWorker();
  return Response.json({ items: await listSearches() });
}
