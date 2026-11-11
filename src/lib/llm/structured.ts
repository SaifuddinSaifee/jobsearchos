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
   * reasoning tokens, whatever the effort), so a call that needs its reasoning asks this way. GLM-5.3-Flash does think
   * under structured outputs, as much as it likes at its default effort, so set an effort on Flash calls too. The reply is validated
   * against the schema the same way in both.
   */
  jsonMode?: "schema" | "prompt";
  /** Called with the call's token counts, when the provider reports them. */
  onUsage?: (usage: Usage) => void;
  /**
   * What to make of a reply cut off at the output limit, instead of failing: given the JSON read so far (closed off
   * after its last complete value, `closeCutJson`), return the value to validate, or null to fail as usual. For a reply
   * whose parts each stand alone, such as a review's scores and edits, where most of it is worth more than none.
   */
  salvage?: (partial: unknown) => unknown | null;
  /**
   * Text sent first, as its own system message ahead of the instructions and the schema, byte for byte the same across
   * calls that share it (the career record, say). Providers cache a prompt's opening, so calls after the first pay the
   * cached price for it. Anything that changes from call to call goes in `user`, never here.
   */
  prefix?: string;
  /** Attributes for the call's span in the trace, such as which attempt this is. Phoenix only. */
  traceAttributes?: Record<string, string | number | boolean>;
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
        ...(opts.prefix ? [{ role: "system" as const, content: opts.prefix }] : []),
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
      attributes: opts.traceAttributes,
      // Checked inside the call, so a reply that cost tokens but cannot be used is recorded as a failed call with them.
      read: ({ content, finishReason, usage }): z.infer<T> => {
        if (usage) opts.onUsage?.(usage);

        if (finishReason === "length") {
          const partial = opts.salvage ? closeCutJson(byPrompt ? stripFences(content).slice(Math.max(0, stripFences(content).indexOf("{"))) : stripFences(content)) : null;
          const saved = partial === null ? null : opts.salvage!(partial);
          const parsed = saved === null ? null : schema.safeParse(saved);
          if (parsed?.success) return parsed.data;
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

/**
 * JSON cut off part way, closed after its last complete value: `{"a":[{"x":1},{"x":` reads as `{"a":[{"x":1}]}`. A
 * value cut inside a string, or a key with no value yet, is dropped with whatever led to it. Null when nothing whole
 * was written.
 */
export function closeCutJson(text: string): unknown | null {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  // Where the text could end, with the brackets still open there.
  let cut: { at: number; open: string[] } | null = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "{" || c === "[") stack.push(c);
    else if (c === "}" || c === "]") {
      stack.pop();
      // A value that closes inside an array is whole; one inside an object is whole when its key came with it.
      cut = { at: i + 1, open: [...stack] };
      if (stack.length === 0) break;
    }
  }
  if (!cut) return null;
  const closers = cut.open.reverse().map((b) => (b === "{" ? "}" : "]")).join("");
  try {
    return JSON.parse(text.slice(0, cut.at) + closers);
  } catch {
    return null;
  }
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
