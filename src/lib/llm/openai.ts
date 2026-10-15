import { OpenAIInstrumentation } from "@arizeai/openinference-instrumentation-openai";
import OpenAI from "openai";
import { env } from "@/lib/env";
import { countingFetch } from "./attempts";

let client: OpenAI | undefined;

/** How often a call that was refused for the rate limit, or failed on the way, is tried again. */
const MAX_RETRIES = 6;

/**
 * Together's OpenAI-compatible chat API, through the `openai` SDK so OpenInference can trace each call into Phoenix.
 * The instrumentation is applied here, to the same `OpenAI` class the client is made from, so tracing holds however
 * the bundler splits modules. It does nothing while no tracer provider is registered (PHOENIX_COLLECTOR_ENDPOINT unset).
 * Model listing stays on `together()` in client.ts: Together returns a bare array there, which this SDK cannot read.
 * Its `fetch` notes each attempt (attempts.ts), so a call's record says how often the SDK retried it.
 */
export function chatClient(): OpenAI {
  if (!client) {
    const apiKey = env().TOGETHER_AI_API_KEY;
    if (!apiKey) throw new Error("TOGETHER_AI_API_KEY is not set in .env");
    new OpenAIInstrumentation().manuallyInstrument(OpenAI);
    // Together's rate limits shift with live capacity, and the larger models (Kimi K3) often answer "too many requests"
    // for a few seconds. The SDK waits as the reply says and tries again; two tries were not enough for those.
    client = new OpenAI({ apiKey, baseURL: "https://api.together.xyz/v1", maxRetries: MAX_RETRIES, fetch: countingFetch });
  }
  return client;
}
