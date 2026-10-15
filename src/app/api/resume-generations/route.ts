import { startQueueWorker } from "@/lib/queue/worker";
import { listActiveGenerations } from "@/lib/resume-writer/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Resumes being written, or just finished, polled by the sidebar card and the toasts. */
export async function GET() {
  startQueueWorker();
  return Response.json({ items: await listActiveGenerations() });
}
