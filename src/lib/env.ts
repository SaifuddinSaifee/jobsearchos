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
  // Optional: contact finders for cold email.
  HUNTER_API_KEY: z.string().optional(),
  APOLLO_API_KEY: z.string().optional(),
  /** Writing: resume, cover letter, cold email. */
  WRITER_MODEL: z.string().default("MiniMaxAI/MiniMax-M3"),
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
