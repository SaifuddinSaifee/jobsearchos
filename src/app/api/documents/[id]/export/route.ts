import { NextResponse } from "next/server";
import { z } from "zod";
import { BrowserUnavailableError } from "@/lib/browser";
import { EXPORT_FORMATS, exportDocument } from "@/lib/documents/export";
import { enqueueAfterCreate } from "@/lib/documents/queue";
import { DocumentError } from "@/lib/documents/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({ format: z.enum(EXPORT_FORMATS), versionId: z.uuid().nullish() });

/**
 * Downloads a document as PDF, Word, Markdown or plain text. A POST, because exporting a PDF or Word file saves a
 * version, and a GET should not change anything. The page count and version number come back as headers.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = Body.safeParse(await request.json().catch(() => null));
  if (!z.uuid().safeParse(id).success || !body.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  try {
    const out = await exportDocument(id, { format: body.data.format, versionId: body.data.versionId });
    if (out.versionCreated) await enqueueAfterCreate(id);
    const name = out.filename.replace(/["\\\r\n]/g, "_");
    return new Response(new Uint8Array(out.bytes), {
      headers: {
        "Content-Type": out.mime,
        "Content-Length": String(out.bytes.length),
        "Content-Disposition": `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(out.filename)}`,
        "Access-Control-Expose-Headers": "Content-Disposition, X-Page-Count, X-Fit-One-Page, X-Version",
        ...(out.pages !== undefined ? { "X-Page-Count": String(out.pages), "X-Fit-One-Page": out.settings.fitOnePage ? "1" : "0" } : {}),
        ...(out.version ? { "X-Version": String(out.version.version) } : {}),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    if (err instanceof DocumentError) return NextResponse.json({ error: err.message }, { status: err.code === "not_found" ? 404 : 422 });
    if (err instanceof BrowserUnavailableError) return NextResponse.json({ error: err.message }, { status: 503 });
    console.error("[export] failed:", err);
    return NextResponse.json({ error: "Could not make that file. Try again." }, { status: 500 });
  }
}
