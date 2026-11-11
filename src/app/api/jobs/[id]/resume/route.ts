import { z } from "zod";
import { startQueueWorker } from "@/lib/queue/worker";
import { getJobResumeState } from "@/lib/resume-writer/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Where writing a resume for this job stands: its latest generation, its resume, and its documents. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return Response.json({ error: "Not found" }, { status: 404 });
  // Brings the worker back after a restart that skipped instrumentation, like the other polled routes.
  startQueueWorker();
  return Response.json(await getJobResumeState(id));
}
