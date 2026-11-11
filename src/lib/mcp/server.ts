import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { saveShortlistJob, SaveJobInput, type SaveJobDeps } from "@/lib/shortlist/save";

/**
 * The jobsearchos MCP server, reached remotely as the claude.ai connector "Job Search OS" (see the README's Daily Job
 * Shortlist section). Its tools only add things; nothing here reads the profile, deletes or changes a status.
 */

const SaveJobOutput = z.object({
  state: z.enum(["queued", "in_jobs", "not_added"]),
  queueId: z.string().optional(),
  jobId: z.string().optional(),
  reason: z.string().optional(),
  appUrl: z.string(),
});

export function createMcpServer(deps: SaveJobDeps = {}): McpServer {
  const server = new McpServer({ name: "jobsearchos", version: "0.1.0" });

  server.registerTool(
    "save_job",
    {
      title: "Save a job to Job Search OS",
      description:
        "Adds a job posting to Job Search OS. The URL is queued, then fetched, extracted and saved to Jobs in the background; the other fields become notes on the application. Safe to call again with the same URL: it reports where the job already is instead of adding it twice.",
      inputSchema: SaveJobInput.shape,
      outputSchema: SaveJobOutput.shape,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (input) => {
      const result = await saveShortlistJob(input, deps);
      return { structuredContent: result, content: [{ type: "text", text: JSON.stringify(result) }] };
    },
  );

  return server;
}
