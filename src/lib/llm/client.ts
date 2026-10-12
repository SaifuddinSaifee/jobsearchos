import Together from "together-ai";
import { env } from "@/lib/env";

let client: Together | undefined;

/** Shared Together AI client (OpenAI-compatible chat API hosting open-weight models). */
export function together(): Together {
  if (!client) {
    const apiKey = env().TOGETHER_AI_API_KEY;
    if (!apiKey) throw new Error("TOGETHER_AI_API_KEY is not set in .env");
    client = new Together({ apiKey });
  }
  return client;
}
