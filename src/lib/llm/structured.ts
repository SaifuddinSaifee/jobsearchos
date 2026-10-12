import { z } from "zod";
import { env } from "@/lib/env";
import { together } from "./client";

export type StructuredOptions = {
  model?: string;
  maxTokens?: number;
};

/**
 * One LLM call whose output is constrained to a Zod schema (Together AI structured outputs).
 * Used for every non-writing LLM task: parsing, extraction, scoring, classification.
 *
 * Together recommends also putting the schema text in the prompt, so it is appended to the
 * system message. The reply is validated with Zod, since constrained decoding is not a guarantee.
 */
export async function chatStructured<T extends z.ZodType>(
  schema: T,
  input: { system: string; user: string },
  opts: StructuredOptions = {},
): Promise<z.infer<T>> {
  const jsonSchema = z.toJSONSchema(schema);
  const system = `${input.system}

Respond only with a JSON object that matches this JSON Schema:
${JSON.stringify(jsonSchema)}`;

  const response = await together().chat.completions.create({
    model: opts.model ?? env().EXTRACTION_MODEL,
    max_tokens: opts.maxTokens ?? 16000,
    messages: [
      { role: "system", content: system },
      { role: "user", content: input.user },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "output", schema: jsonSchema as Record<string, unknown> },
    },
  });

  const choice = response.choices[0];
  if (choice?.finish_reason === "length") {
    throw new Error("Output was cut off (max_tokens); the input may be too long");
  }

  let json: unknown;
  try {
    json = JSON.parse(stripFences(choice?.message?.content ?? ""));
  } catch {
    throw new Error("The model's output was not valid JSON");
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`The model's output did not match the expected schema: ${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

/** Some models wrap JSON in ```json fences despite response_format. */
function stripFences(text: string): string {
  const m = text.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return m ? m[1] : text;
}
