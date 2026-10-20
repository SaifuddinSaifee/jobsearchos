import { z } from "zod";

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  TEST_DATABASE_URL: z.string().optional(),
  // Optional here so build and tests run without it; LLM calls fail clearly when it's missing.
  TOGETHER_AI_API_KEY: z.string().optional(),
  // Optional: web search for company research (https://tavily.com). Without it, research is skipped.
  TAVILY_API_KEY: z.string().optional(),
  // Optional: Gmail connection for cold email (see the "Setup: Gmail" section of the README).
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  /** Where the app is reached; the Gmail OAuth redirect URI is `${APP_URL}/api/gmail/callback`. */
  APP_URL: z.string().default("http://localhost:3000"),
  /** 32 random bytes, base64 (`openssl rand -base64 32`). Encrypts the stored Gmail tokens. */
  TOKEN_ENCRYPTION_KEY: z.string().optional(),
  // Optional: Prospeo finds people at a company and reveals their verified email (https://prospeo.io).
  PROSPEO_API_KEY: z.string().optional(),
  /** Writing: resume, cover letter, cold email. Run at high reasoning effort (see WRITER_EFFORT in resume-writer/writer.ts). */
  WRITER_MODEL: z.string().default("zai-org/GLM-5.3"),
  /**
   * Reviewing what the writer wrote, against a fixed set of criteria. A different model from the writer on purpose.
   * DeepSeek V4.1 Flash reviews in about 20 seconds for under a cent; Kimi K3 took about 3 minutes and $0.11 a review
   * with no better resumes (`npm run eval:writer`, 2026-10-15).
   */
  REVIEW_MODEL: z.string().default("deepseek-ai/DeepSeek-V4.1-Flash"),
  /**
   * Output limits for the resume writer, thinking included (GLM-5.3 counts its thinking as output). A draft past
   * WRITER_MAX_TOKENS is stopped and written again at low effort with WRITER_FALLBACK_MAX_TOKENS; a revision past
   * REVISE_MAX_TOKENS keeps the reviewed draft. Drafts that worked used up to about 23,000 in all, and one cut off at
   * 24,000 had finished its thinking with no room left for the answer (Oct 17, 2026), so the first limit leaves room.
   */
  WRITER_MAX_TOKENS: z.coerce.number().int().min(4_000).default(28_000),
  WRITER_FALLBACK_MAX_TOKENS: z.coerce.number().int().min(4_000).default(16_000),
  REVISE_MAX_TOKENS: z.coerce.number().int().min(4_000).default(16_000),
  /** Extraction, parsing, scoring, classification, summarization. */
  EXTRACTION_MODEL: z.string().default("zai-org/GLM-5.3-Flash"),
  /** High-volume triage (discovery prefilter). */
  FAST_MODEL: z.string().default("zai-org/GLM-5.3-Flash"),
  // Embeddings only (Stage 5): local Ollama model, since Together has no serverless embeddings.
  OLLAMA_BASE_URL: z.string().default("http://localhost:11434"),
  EMBEDDING_MODEL: z.string().default("qwen3-embedding:4b"),
  /** How many queued job extractions run at the same time. */
  QUEUE_CONCURRENCY: z.coerce.number().int().min(1).max(5).default(2),
  STORAGE_DIR: z.string().default("./storage"),
  // Optional: Arize Phoenix tracing of model calls (see docs/LLM-LOGGING.md). Unset, tracing is off; usage is still
  // recorded in the database. instrumentation.ts and phoenix.ts read the first three straight from process.env.
  PHOENIX_COLLECTOR_ENDPOINT: z.string().optional(),
  PHOENIX_PROJECT_NAME: z.string().optional(),
  PHOENIX_API_KEY: z.string().optional(),
  /** Where your browser reaches Phoenix, for the "Open Phoenix" button. Defaults to the collector endpoint. */
  PHOENIX_UI_URL: z.string().optional(),
  /**
   * Optional: turns on the MCP endpoint at /api/mcp/<MCP_SECRET> (the claude.ai connector "Job Search OS"). The secret
   * in the path is its only protection, so make it long and random (`openssl rand -hex 32`). Unset, the endpoint is off.
   */
  MCP_SECRET: z.preprocess((v) => (v === "" ? undefined : v), z.string().min(32).optional()),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | undefined;

/** Validated environment. Parsed lazily so build and tests don't need every variable. */
export function env(): Env {
  if (!cached) {
    const parsed = EnvSchema.safeParse(process.env);
    if (!parsed.success) {
      throw new Error(`Invalid environment: ${z.prettifyError(parsed.error)}`);
    }
    cached = parsed.data;
  }
  return cached;
}

/** Forgets the parsed environment so tests can change `process.env` between cases. */
export function resetEnv(): void {
  cached = undefined;
}
