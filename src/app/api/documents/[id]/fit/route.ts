import { NextResponse } from "next/server";
import { z } from "zod";
import { BrowserUnavailableError } from "@/lib/browser";
import { renderPdf } from "@/lib/documents/export/pdf";
import { getEditorData } from "@/lib/documents/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * How many pages the saved draft really comes to when printed. The editor estimates this in the browser while you
 * type; this is the check against the actual PDF, so a different answer here wins. Nothing is saved or exported.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const data = await getEditorData(id);
  if (!data) return NextResponse.json({ error: "Document not found" }, { status: 404 });
  try {
    const pdf = await renderPdf(data.draft.content, data.pageSettings, { title: data.document.title });
    return NextResponse.json({ pages: pdf.pages, revision: data.draft.revision });
  } catch (err) {
    if (err instanceof BrowserUnavailableError) return NextResponse.json({ error: err.message }, { status: 503 });
    console.error("[fit] check failed:", err);
    return NextResponse.json({ error: "Could not check the page count" }, { status: 500 });
  }
}
