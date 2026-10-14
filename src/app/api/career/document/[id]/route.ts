import { z } from "zod";
import { getDocumentOffer } from "@/lib/career/offer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Where a resume or cover letter stands with the career record, and what adding it would bring. No model call. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return Response.json({ error: "Not found" }, { status: 404 });
  const offer = await getDocumentOffer(id);
  if (!offer) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ offer });
}
