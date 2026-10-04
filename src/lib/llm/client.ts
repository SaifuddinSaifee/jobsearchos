import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/lib/env";

let client: Anthropic | undefined;

/** Shared Anthropic client. Without an explicit key the SDK resolves credentials itself. */
export function anthropic(): Anthropic {
  if (!client) {
    const apiKey = env().ANTHROPIC_API_KEY;
    client = apiKey ? new Anthropic({ apiKey }) : new Anthropic();
  }
  return client;
}
