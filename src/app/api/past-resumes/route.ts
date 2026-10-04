import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { pastResumes } from "@/lib/db/schema";
import { extractResumeText } from "@/lib/resume/extract";
import { putFile } from "@/lib/storage/local";

export const runtime = "nodejs";

const Meta = z.object({
  title: z.string().trim(),
  company: z.string().trim(),
  role: z.string().trim(),
  jdText: z.string().trim(),
  jdUrl: z.string().trim(),
  appliedAt: z.string().trim(),
});

const field = (form: FormData, key: string) => String(form.get(key) ?? "");

/** Stores a past resume (and optionally the job description it was written for). */
export async function POST(request: Request) {
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  }
  const meta = Meta.parse({
    title: field(form, "title"),
    company: field(form, "company"),
    role: field(form, "role"),
    jdText: field(form, "jdText"),
    jdUrl: field(form, "jdUrl"),
    appliedAt: field(form, "appliedAt"),
  });

  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    const { text, mime } = await extractResumeText(bytes, file.name, file.type);
    const stored = await putFile(bytes, { mime, originalName: file.name });
    const appliedAt = meta.appliedAt ? new Date(meta.appliedAt) : null;

    const [row] = await db()
      .insert(pastResumes)
      .values({
        fileId: stored.id,
        title: meta.title || file.name.replace(/\.[^.]+$/, ""),
        company: meta.company || null,
        role: meta.role || null,
        jdText: meta.jdText || null,
        jdUrl: meta.jdUrl || null,
        appliedAt: appliedAt && !Number.isNaN(appliedAt.getTime()) ? appliedAt : null,
        extractedText: text,
      })
      .returning({ id: pastResumes.id });

    revalidatePath("/profile");
    return NextResponse.json({ id: row.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not store the resume";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
