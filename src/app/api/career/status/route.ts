import { getCareerStatus } from "@/lib/career/review";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Where the career record's sources are in the queue, polled while something is being prepared. */
export async function GET() {
  return Response.json(await getCareerStatus());
}
