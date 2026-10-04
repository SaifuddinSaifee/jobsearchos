import { NextResponse } from "next/server";
import { extractResumeText } from "@/lib/resume/extract";
import { parseResume } from "@/lib/resume/parse";
import { putFile } from "@/lib/storage/local";

export const runtime = "nodejs";
export const maxDuration = 120;

/** Uploads a base resume, extracts its text and returns a parsed draft. Nothing is saved as a profile version. */
export async function POST(request: Request) {
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  }

  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    const { text, mime } = await extractResumeText(bytes, file.name, file.type);
    const stored = await putFile(bytes, { mime, originalName: file.name });
    const profile = await parseResume(text);
    return NextResponse.json({ fileId: stored.id, text, profile });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not parse the resume";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
