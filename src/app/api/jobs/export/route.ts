import { z } from "zod";
import { jobsToCsv } from "@/lib/jobs/export";
import { exportRows } from "@/lib/jobs/tracker";

export const runtime = "nodejs";

const Body = z.object({ ids: z.array(z.uuid()).max(5000).nullable() });

/** CSV of the given applications (in the given order), or of every job when `ids` is null. */
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });

  const rows = await exportRows(parsed.data.ids);
  const date = new Date().toISOString().slice(0, 10);
  return new Response(jobsToCsv(rows), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="jobs-${date}.csv"`,
      "cache-control": "no-store",
    },
  });
}

