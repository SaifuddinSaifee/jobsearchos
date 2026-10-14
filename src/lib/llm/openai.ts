import { OpenAIInstrumentation } from "@arizeai/openinference-instrumentation-openai";
import OpenAI from "openai";
import { env } from "@/lib/env";

let client: OpenAI | undefined;

/**
 * Together's OpenAI-compatible chat API, through the `openai` SDK so OpenInference can trace each call into Phoenix.
 * The instrumentation is applied here, to the same `OpenAI` class the client is made from, so tracing holds however
 * the bundler splits modules. It does nothing while no tracer provider is registered (PHOENIX_COLLECTOR_ENDPOINT unset).
 * Model listing stays on `together()` in client.ts: Together returns a bare array there, which this SDK cannot read.
 */
export function chatClient(): OpenAI {
  if (!client) {
    const apiKey = env().TOGETHER_AI_API_KEY;
    if (!apiKey) throw new Error("TOGETHER_AI_API_KEY is not set in .env");
    new OpenAIInstrumentation().manuallyInstrument(OpenAI);
    client = new OpenAI({ apiKey, baseURL: "https://api.together.xyz/v1" });
  }
  return client;
}
