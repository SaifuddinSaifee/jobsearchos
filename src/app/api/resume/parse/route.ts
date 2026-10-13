import { NextResponse } from "next/server";
import { extractResumeText } from "@/lib/resume/extract";
import { parseResume } from "@/lib/resume/parse";
import { sha256 } from "@/lib/documents/intake";

export const runtime = "nodejs";
export const maxDuration = 120;

/** Reads a base resume and returns a parsed draft. Nothing is saved: not the file, and not a profile version. */
export async function POST(request: Request) {
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  }

  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    const { text, mime } = await extractResumeText(bytes, file.name, file.type);
    const profile = await parseResume(text);
    // Only the content is kept. The file's name, type and hash are returned so the base resume made from it can say where it came from.
    return NextResponse.json({ text, profile, source: { name: file.name, mime, sha256: sha256(bytes) } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not parse the resume";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
