import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { careerSources } from "@/lib/db/schema";
import { findPanelRole } from "@/lib/career/panel";
import { getLatestRecord } from "@/lib/career/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Query = z.object({
  documentId: z.uuid(),
  roleBlockId: z.string().max(64).optional(),
  company: z.string().max(300).default(""),
  title: z.string().max(300).default(""),
  dates: z.string().max(200).default(""),
});

/** The career record's wordings for a role of a document, for the editor's side panel. */
export async function GET(request: Request) {
  const parsed = Query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  const q = parsed.data;

  const latest = await getLatestRecord();
  if (!latest) return Response.json({ hasRecord: false, role: null });
  const sources = await db().select({ id: careerSources.id }).from(careerSources).where(eq(careerSources.documentId, q.documentId));
  const role = findPanelRole(latest.record, {
    documentSourceIds: sources.map((s) => s.id),
    roleBlockId: q.roleBlockId ?? null,
    company: q.company,
    title: q.title,
    dates: q.dates,
  });
  return Response.json({ hasRecord: true, role });
}
