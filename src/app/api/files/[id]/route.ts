import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { files } from "@/lib/db/schema";
import { fileDisplayName, isKnownResumeFile } from "@/lib/resume/files";
import { getFileBytes } from "@/lib/storage/local";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A stored resume, as the original file. Only files the app knows as resumes are served; `?download=1` forces a save dialog. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return Response.json({ error: "Invalid file id" }, { status: 400 });

  const database = db();
  const [file] = await database.select().from(files).where(eq(files.id, id));
  if (!file || !(await isKnownResumeFile(id, database))) return Response.json({ error: "File not found" }, { status: 404 });

  let bytes: Buffer;
  try {
    bytes = await getFileBytes(file.sha256);
  } catch {
    return Response.json({ error: "The file is missing from storage" }, { status: 404 });
  }
  const name = fileDisplayName(file).replace(/["\\\r\n]/g, "_");
  const disposition = new URL(request.url).searchParams.get("download") === "1" ? "attachment" : "inline";
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": file.mime,
      "Content-Length": String(bytes.length),
      "Content-Disposition": `${disposition}; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
