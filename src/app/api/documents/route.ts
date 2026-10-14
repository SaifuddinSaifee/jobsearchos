import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createFromUpload } from "@/lib/documents/intake";

export const runtime = "nodejs";
export const maxDuration = 60;

const Form = z.object({
  kind: z.enum(["resume", "cover_letter"]),
  title: z.string().trim().max(200),
  jobId: z.union([z.uuid(), z.literal("")]),
  companyName: z.string().trim().max(200),
  targetRole: z.string().trim().max(200),
  writtenOn: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal("")]),
  jdText: z.string().max(100_000),
  jdUrl: z.string().trim().max(2000),
  force: z.string(),
});

const field = (form: FormData, key: string) => String(form.get(key) ?? "");
const orNull = (s: string) => s || null;

/** Files a resume or cover letter (PDF or DOCX) in the library. Uploads go through a route, not a server action, to avoid the 1 MB action limit. */
export async function POST(request: Request) {
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file uploaded" }, { status: 400 });

  const parsed = Form.safeParse({
    kind: field(form, "kind") || "resume",
    title: field(form, "title"),
    jobId: field(form, "jobId"),
    companyName: field(form, "companyName"),
    targetRole: field(form, "targetRole"),
    writtenOn: field(form, "writtenOn"),
    jdText: field(form, "jdText"),
    jdUrl: field(form, "jdUrl"),
    force: field(form, "force"),
  });
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid details" }, { status: 400 });
  const v = parsed.data;

  try {
    const out = await createFromUpload({
      bytes: Buffer.from(await file.arrayBuffer()),
      name: file.name,
      mime: file.type,
      kind: v.kind,
      force: v.force === "1",
      title: v.title,
      jobId: orNull(v.jobId),
      companyName: orNull(v.companyName),
      targetRole: orNull(v.targetRole),
      writtenOn: orNull(v.writtenOn),
      jdText: orNull(v.jdText),
      jdUrl: orNull(v.jdUrl),
    });
    if (!out.ok) {
      return NextResponse.json({ error: `You already have this file in the library as "${out.duplicateOf.title}".`, duplicateOf: out.duplicateOf }, { status: 409 });
    }
    revalidatePath("/library");
    return NextResponse.json({ id: out.id });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not read that file" }, { status: 422 });
  }
}
