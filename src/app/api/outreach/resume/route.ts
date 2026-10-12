import { z } from "zod";
import { OutreachError, uploadResumeForJob } from "@/lib/outreach/service";
import { kickWorker } from "@/lib/queue/worker";

export const runtime = "nodejs";

/** Stores a resume uploaded from the email composer, files it in the library and queues it for indexing. */
export async function POST(request: Request) {
  const form = await request.formData();
  const file = form.get("file");
  const jobId = z.uuid().safeParse(form.get("jobId"));
  if (!(file instanceof File)) return Response.json({ error: "No file uploaded" }, { status: 400 });
  if (!jobId.success) return Response.json({ error: "Invalid job" }, { status: 400 });

  try {
    const resume = await uploadResumeForJob(jobId.data, { bytes: Buffer.from(await file.arrayBuffer()), name: file.name, mime: file.type });
    kickWorker();
    return Response.json({ resume });
  } catch (err) {
    const status = err instanceof OutreachError && err.code === "not_found" ? 404 : 422;
    return Response.json({ error: err instanceof Error ? err.message : "Could not store the resume" }, { status });
  }
}
