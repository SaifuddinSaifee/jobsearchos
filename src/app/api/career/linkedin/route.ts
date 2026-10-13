import { NextResponse } from "next/server";
import { addLinkedInSource, LinkedInError } from "@/lib/career/linkedin";
import { kickWorker } from "@/lib/queue/worker";
import { extractResumeText } from "@/lib/resume/extract";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Takes a LinkedIn profile saved as a PDF (print the profile page and choose Save as PDF). Only its text is kept, as
 * a source for the career record; the file itself is not stored. The same text twice is answered with 409.
 */
export async function POST(request: Request) {
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file uploaded" }, { status: 400 });

  try {
    const { text } = await extractResumeText(Buffer.from(await file.arrayBuffer()), file.name, file.type);
    const outcome = await addLinkedInSource(text);
    if (outcome.status === "skipped") return NextResponse.json({ error: outcome.reason }, { status: 409 });
    kickWorker();
    return NextResponse.json({ status: outcome.status });
  } catch (err) {
    if (err instanceof LinkedInError || err instanceof Error) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    return NextResponse.json({ error: "Could not read that file" }, { status: 422 });
  }
}
