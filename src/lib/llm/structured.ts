import { z } from "zod";
import { env } from "@/lib/env";
import { chatCompletion, type ChatParams, type Usage } from "./chat";
import type { LlmStep } from "./names";

export type StructuredOptions = {
  /** What this call is, for the trace and the usage record. Required so a new call site cannot forget it. */
  step: LlmStep;
  model?: string;
  maxTokens?: number;
  /**
   * How long the model thinks before answering. Left unset, nothing is sent and the model uses its own default.
   * GLM-5.3 cannot turn thinking off (`reasoning: { enabled: false }` is ignored), but "low" cuts it to almost nothing.
   * Together accepts unknown values silently, which is why this is typed.
   */
  reasoningEffort?: ChatParams["reasoning_effort"];
  /**
   * How the JSON is asked for. "schema" (the default) uses Together's structured outputs. "prompt" only puts the schema
   * in the prompt and reads the JSON out of the reply: GLM-5.3 does not think at all under structured outputs (no
   * reasoning tokens, whatever the effort), so a call that needs its reasoning asks this way. The reply is validated
   * against the schema the same way in both.
   */
  jsonMode?: "schema" | "prompt";
  /** Called with the call's token counts, when the provider reports them. */
  onUsage?: (usage: Usage) => void;
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
  opts: StructuredOptions,
): Promise<z.infer<T>> {
  const jsonSchema = z.toJSONSchema(schema);
  const byPrompt = opts.jsonMode === "prompt";
  const system = `${input.system}

Respond only with a JSON object that matches this JSON Schema${byPrompt ? ", with no other text before or after it" : ""}:
${JSON.stringify(jsonSchema)}`;

  return chatCompletion(
    {
      model: opts.model ?? env().EXTRACTION_MODEL,
      max_tokens: opts.maxTokens ?? 16000,
      ...(opts.reasoningEffort ? { reasoning_effort: opts.reasoningEffort } : {}),
      messages: [
        { role: "system", content: system },
        { role: "user", content: input.user },
      ],
      ...(byPrompt
        ? {}
        : {
            response_format: {
              type: "json_schema" as const,
              json_schema: { name: "output", schema: jsonSchema as Record<string, unknown> },
            },
          }),
    },
    {
      step: opts.step,
      // Checked inside the call, so a reply that cost tokens but cannot be used is recorded as a failed call with them.
      read: ({ content, finishReason, usage }): z.infer<T> => {
        if (usage) opts.onUsage?.(usage);

        if (finishReason === "length") {
          throw new Error("Output was cut off (max_tokens); the input may be too long");
        }

        let json: unknown;
        try {
          json = JSON.parse(byPrompt ? jsonIn(content) : stripFences(content));
        } catch {
          throw new Error("The model's output was not valid JSON");
        }
        const parsed = schema.safeParse(json);
        if (!parsed.success) {
          throw new Error(`The model's output did not match the expected schema: ${z.prettifyError(parsed.error)}`);
        }
        return parsed.data;
      },
    },
  );
}

/** The JSON object in a reply asked for by prompt: inside fences, or between the first "{" and the last "}". */
export function jsonIn(text: string): string {
  const unfenced = stripFences(text).trim();
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  return start >= 0 && end > start ? unfenced.slice(start, end + 1) : unfenced;
}

/** Some models wrap JSON in ```json fences despite response_format. */
function stripFences(text: string): string {
  const m = text.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return m ? m[1] : text;
}
