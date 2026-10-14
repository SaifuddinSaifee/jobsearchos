import { NextResponse } from "next/server";
import { z } from "zod";
import { DocumentError, saveDraft } from "@/lib/documents/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  content: z.unknown(),
  subject: z.string().max(300).default(""),
  /** The revision the editor last saw. If another tab saved since, nothing is written. */
  revision: z.number().int().min(1),
});

/**
 * Autosave for the editor. A route, not a server action, so a slow save never queues behind other actions, and so it can
 * be sent with `keepalive` as the page closes. Returns the new revision, or 409 with the current one if the draft moved on.
 */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = Body.safeParse(await request.json().catch(() => null));
  if (!z.uuid().safeParse(id).success || !body.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  try {
    const saved = await saveDraft(id, body.data);
    return NextResponse.json({ revision: saved.revision });
  } catch (err) {
    if (err instanceof DocumentError) {
      const status = err.code === "stale" ? 409 : err.code === "not_found" ? 404 : 422;
      return NextResponse.json({ error: err.message, revision: err.detail?.revision }, { status });
    }
    console.error("[draft] save failed:", err);
    return NextResponse.json({ error: "Could not save" }, { status: 500 });
  }
}
