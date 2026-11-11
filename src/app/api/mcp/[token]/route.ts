import { createHash, timingSafeEqual } from "node:crypto";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { env } from "@/lib/env";
import { createMcpServer } from "@/lib/mcp/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ token: string }> };

const digest = (s: string) => createHash("sha256").update(s).digest();

/** The secret in the path is the only credential, so a wrong one looks exactly like a page that does not exist. */
function allowed(token: string): boolean {
  const secret = env().MCP_SECRET;
  return !!secret && timingSafeEqual(digest(token), digest(secret));
}

/** MCP over Streamable HTTP, stateless: each request gets its own server and transport. */
async function handle(request: Request, { params }: Ctx): Promise<Response> {
  const { token } = await params;
  if (!allowed(token)) return new Response("Not found", { status: 404 });
  const server = createMcpServer();
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    void server.close().catch(() => {});
  }
}

export { handle as GET, handle as POST, handle as DELETE };
