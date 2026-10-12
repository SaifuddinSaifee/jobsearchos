import { env } from "@/lib/env";

/**
 * Size of every stored embedding. qwen3-embedding:4b produces 2560 numbers but is trained so its first dimensions
 * carry most of the meaning (Matryoshka), so asking Ollama for 1024 loses little and keeps the vector index small.
 * Must match the `vector(1024)` column in `resume_chunks`; changing it needs a migration and a re-index.
 */
export const EMBEDDING_DIMENSIONS = 1024;

const BATCH = 16;
const TIMEOUT_MS = 90_000;

export type EmbedOptions = { fetch?: typeof fetch; baseUrl?: string; model?: string };

/** Embeds texts with the local Ollama model, in order. Throws a plain-language error when Ollama cannot be used. */
export async function embedTexts(texts: string[], opts: EmbedOptions = {}): Promise<number[][]> {
  if (texts.length === 0) return [];
  const e = env();
  const baseUrl = (opts.baseUrl ?? e.OLLAMA_BASE_URL).replace(/\/$/, "");
  const model = opts.model ?? e.EMBEDDING_MODEL;
  const doFetch = opts.fetch ?? fetch;

  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const input = texts.slice(i, i + BATCH);
    let res: Response;
    try {
      res = await doFetch(`${baseUrl}/api/embed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, input, dimensions: EMBEDDING_DIMENSIONS }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new Error(`Could not reach Ollama at ${baseUrl}. Start it (ollama serve) and try again.`);
    }
    const json = (await res.json().catch(() => ({}))) as { embeddings?: number[][]; error?: string };
    if (!res.ok) {
      const hint = /not found/i.test(json.error ?? "") ? ` Run: ollama pull ${model}` : "";
      throw new Error(`Ollama could not embed the text: ${json.error ?? res.statusText}.${hint}`);
    }
    const vectors = json.embeddings;
    if (!vectors || vectors.length !== input.length) throw new Error("Ollama returned the wrong number of embeddings.");
    for (const v of vectors) {
      if (v.length !== EMBEDDING_DIMENSIONS) {
        throw new Error(`Ollama returned ${v.length} numbers per embedding, expected ${EMBEDDING_DIMENSIONS}. Update Ollama, or the dimensions setting is not supported by ${model}.`);
      }
    }
    out.push(...vectors);
  }
  return out;
}

/** Qwen3 embedding models expect searches (not documents) to carry a one-line task description. */
export const QUERY_INSTRUCTION = "Given a job description or a request, find the resume sections that best show relevant experience";

export async function embedQuery(query: string, opts: EmbedOptions = {}): Promise<number[]> {
  const [v] = await embedTexts([`Instruct: ${QUERY_INSTRUCTION}\nQuery: ${query}`], opts);
  return v;
}
