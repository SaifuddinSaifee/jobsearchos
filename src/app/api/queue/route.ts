import { listQueue } from "@/lib/queue/service";
import { startQueueWorker } from "@/lib/queue/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The whole queue (without drafts), polled by the New Application page and the sidebar tracker. */
export async function GET() {
  // The worker normally starts with the server (instrumentation.ts). Starting it here too means it also comes back
  // after a dev-server restart that skipped instrumentation, as soon as any page asks about the queue.
  startQueueWorker();
  return Response.json(await listQueue());
}
