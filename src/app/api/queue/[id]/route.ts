import { z } from "zod";
import { getQueueDraft } from "@/lib/queue/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One queue item with its draft, for the review screen. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return Response.json({ error: "Invalid id" }, { status: 400 });
  const found = await getQueueDraft(id);
  if (!found) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(found);
}
