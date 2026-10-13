import { z } from "zod";
import { OutreachError, uploadAttachmentForJob } from "@/lib/outreach/service";

export const runtime = "nodejs";

/** Stores a file uploaded in the email composer to go with the email as it is (a proposal, a writing sample...). */
export async function POST(request: Request) {
  const form = await request.formData();
  const file = form.get("file");
  const jobId = z.uuid().safeParse(form.get("jobId"));
  if (!(file instanceof File)) return Response.json({ error: "No file uploaded" }, { status: 400 });
  if (!jobId.success) return Response.json({ error: "Invalid job" }, { status: 400 });

  try {
    const attachment = await uploadAttachmentForJob(jobId.data, { bytes: Buffer.from(await file.arrayBuffer()), name: file.name });
    return Response.json({ attachment });
  } catch (err) {
    const status = err instanceof OutreachError && err.code === "not_found" ? 404 : 422;
    return Response.json({ error: err instanceof Error ? err.message : "Could not store the file" }, { status });
  }
}
