import { recordToMarkdown } from "@/lib/career/markdown";
import { currentRecord } from "@/lib/career/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Downloads the whole career record, as it is now, as a Markdown file. It changes nothing, so it is a GET. */
export async function GET() {
  const { version, record } = await currentRecord();
  const today = new Date().toISOString().slice(0, 10);
  const filename = `Career record - ${today}.md`;
  return new Response(recordToMarkdown(record, { version: version > 0 ? version : null, exportedOn: today }), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    },
  });
}
