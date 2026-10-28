import { recordToMarkdown } from "@/lib/career/markdown";
import { recordForPrompt } from "@/lib/career/prompt";
import { currentRecord } from "@/lib/career/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Downloads the whole career record, as it is now, as a Markdown file. It changes nothing, so it is a GET. With
 * `?for=ai` it is the short form a model reads (one line per fact with its details), for pasting into another tool.
 */
export async function GET(request: Request) {
  const { version, record } = await currentRecord();
  const today = new Date().toISOString().slice(0, 10);
  const forAi = new URL(request.url).searchParams.get("for") === "ai";
  const filename = forAi ? `Career record for AI - ${today}.md` : `Career record - ${today}.md`;
  const body = forAi ? recordForPrompt(record) : recordToMarkdown(record, { version: version > 0 ? version : null, exportedOn: today });
  return new Response(body, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    },
  });
}
