import { listIndexInfo } from "@/lib/resume/indexing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The search-index state of every library resume, polled by the pages while something is still indexing. */
export async function GET() {
  return Response.json({ indexes: await listIndexInfo() });
}
