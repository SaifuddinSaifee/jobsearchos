import { listIndexInfo } from "@/lib/resume/indexing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Where every library resume is in being read into sections, polled by the pages while one is still being read. */
export async function GET() {
  return Response.json({ indexes: await listIndexInfo() });
}
