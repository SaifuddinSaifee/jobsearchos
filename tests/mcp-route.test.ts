import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnv } from "@/lib/env";

process.env.DATABASE_URL ??= "postgres://unused";

// The route must not reach the database here; the tool's own behavior is covered in shortlist-save.test.ts.
const saveShortlistJob = vi.fn(async (input: { url: string }) => ({ state: "queued" as const, queueId: "q-1", appUrl: `http://localhost:3000/new#${input.url}` }));
vi.mock("@/lib/shortlist/save", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/shortlist/save")>()),
  saveShortlistJob: (input: { url: string }) => saveShortlistJob(input),
}));

const { POST, GET } = await import("@/app/api/mcp/[token]/route");

const SECRET = "s".repeat(40);
const ctx = (token: string) => ({ params: Promise.resolve({ token }) });

function rpc(method: string, params: object, id = 1) {
  return new Request("http://localhost:3000/api/mcp/x", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
}

const initialize = () => rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });

beforeEach(() => {
  process.env.MCP_SECRET = SECRET;
  resetEnv();
  saveShortlistJob.mockClear();
});
afterEach(() => {
  delete process.env.MCP_SECRET;
  resetEnv();
});

describe("/api/mcp/[token]", () => {
  it("answers initialize, tools/list and tools/call with the right token", async () => {
    const init = await POST(initialize(), ctx(SECRET));
    expect(init.status).toBe(200);
    expect((await init.json()).result.serverInfo.name).toBe("jobsearchos");

    const list = await (await POST(rpc("tools/list", {}, 2), ctx(SECRET))).json();
    const tool = list.result.tools.find((t: { name: string }) => t.name === "save_job");
    expect(tool.inputSchema.required).toEqual(["url"]);
    expect(tool.annotations).toMatchObject({ readOnlyHint: false, idempotentHint: true, destructiveHint: false });

    const call = await (await POST(rpc("tools/call", { name: "save_job", arguments: { url: "https://jobs.ashbyhq.com/a/1", fit: 80 } }, 3), ctx(SECRET))).json();
    expect(call.result.structuredContent).toEqual({ state: "queued", queueId: "q-1", appUrl: "http://localhost:3000/new#https://jobs.ashbyhq.com/a/1" });
    expect(JSON.parse(call.result.content[0].text)).toEqual(call.result.structuredContent);
    expect(saveShortlistJob).toHaveBeenCalledOnce();
  });

  it("reports bad input as a tool error without saving", async () => {
    const call = await (await POST(rpc("tools/call", { name: "save_job", arguments: { fit: 80 } }), ctx(SECRET))).json();
    expect(call.result?.isError ?? call.error).toBeTruthy();
    expect(saveShortlistJob).not.toHaveBeenCalled();
  });

  it("is a plain 404 with a wrong token", async () => {
    for (const res of [await POST(initialize(), ctx("wrong-token")), await GET(new Request("http://localhost:3000/api/mcp/x"), ctx("wrong-token"))]) {
      expect(res.status).toBe(404);
      expect(await res.text()).toBe("Not found");
    }
  });

  it("is off when MCP_SECRET is not set", async () => {
    delete process.env.MCP_SECRET;
    resetEnv();
    expect((await POST(initialize(), ctx(SECRET))).status).toBe(404);
    expect((await POST(initialize(), ctx(""))).status).toBe(404);
  });
});
