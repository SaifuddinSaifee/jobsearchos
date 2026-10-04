import { z } from "zod";

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  TEST_DATABASE_URL: z.string().optional(),
  // Optional here so build and tests run without it; LLM calls fail clearly when it's missing.
  TOGETHER_AI_API_KEY: z.string().optional(),
  /** Writing: resume, cover letter, cold email. */
  WRITER_MODEL: z.string().default("MiniMaxAI/MiniMax-M3"),
  /** Extraction, parsing, scoring, classification, summarization. */
  EXTRACTION_MODEL: z.string().default("zai-org/GLM-5.3-Flash"),
  /** High-volume triage (discovery prefilter). */
  FAST_MODEL: z.string().default("zai-org/GLM-5.3-Flash"),
  // Embeddings only (Stage 5): local Ollama model, since Together has no serverless embeddings.
  OLLAMA_BASE_URL: z.string().default("http://localhost:11434"),
  EMBEDDING_MODEL: z.string().default("qwen3-embedding:4b"),
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
