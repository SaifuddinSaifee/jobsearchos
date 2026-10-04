import type { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { env } from "@/lib/env";
import { anthropic } from "./client";

export type StructuredOptions = {
  model?: string;
  effort?: "low" | "medium" | "high";
  maxTokens?: number;
};

/**
 * One Claude call whose output is constrained to a Zod schema (structured outputs).
 * Used for every non-writing LLM task: parsing, extraction, scoring, classification.
 */
export async function chatStructured<T extends z.ZodType>(
  schema: T,
  input: { system: string; user: string },
  opts: StructuredOptions = {},
): Promise<z.infer<T>> {
  const response = await anthropic().messages.parse({
    model: opts.model ?? env().EXTRACTION_MODEL,
    max_tokens: opts.maxTokens ?? 16000,
    system: input.system,
    messages: [{ role: "user", content: input.user }],
    output_config: {
      effort: opts.effort ?? "low",
      format: zodOutputFormat(schema),
    },
  });

  if (response.stop_reason === "refusal") {
    throw new Error("The model declined this request");
  }
  if (response.stop_reason === "max_tokens") {
    throw new Error("Output was cut off (max_tokens); the input may be too long");
  }
  if (response.parsed_output == null) {
    throw new Error("The model's output did not match the expected schema");
  }
  return response.parsed_output as z.infer<T>;
}
