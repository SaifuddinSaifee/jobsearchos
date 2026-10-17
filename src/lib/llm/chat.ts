import type { ChatCompletionCreateParamsBase } from "openai/resources/chat/completions";
import { currentAbortSignal } from "./abort";
import { countAttempts, retryStats, type Attempts } from "./attempts";
import { currentLlmContext, currentTraceId, setStepAttributes, traceStep } from "./context";
import type { LlmCallStatus, LlmStep } from "./names";
import { UNKNOWN_ACTION } from "./names";
import { chatClient } from "./openai";
import { recordLlmCall } from "./usage";

export type ChatParams = Omit<ChatCompletionCreateParamsBase, "stream" | "stream_options">;

/** Token counts for one call. `reasoningTokens` is null when the model reports none (it did not think, or does not say). */
export type Usage = { promptTokens: number; completionTokens: number; reasoningTokens: number | null; cachedTokens: number };

/**
 * One reply. `reasoning` is the model's thinking as the provider streamed it, "" when it sends none (some send only the
 * count). It is never stored in the database; a reply cut off at the output limit saves it to the trace (`saveThinking`).
 */
export type Reply = { content: string; reasoning: string; finishReason: string | null; usage: Usage | null };

/** Characters of thinking saved to a trace: about 75,000 tokens, past any limit set here. */
const THINKING_CHARS = 300_000;

/** The thinking in one streamed delta, under whatever name the provider sends it ("reasoning", "reasoning_content"). */
export function thinkingIn(delta: object | undefined): string {
  if (!delta) return "";
  return Object.entries(delta)
    .filter(([key, value]) => key !== "content" && typeof value === "string" && /reason|think/i.test(key))
    .map(([, value]) => value as string)
    .join("");
}

export type ChatMeta<T> = {
  /** The kind of call, for the trace and the usage record. */
  step: LlmStep;
  /**
   * Turns the reply into the caller's result. If it throws, the call is recorded as failed, with the tokens it spent:
   * a reply that arrives but cannot be used (cut off, not JSON, off schema) is still a call that cost money.
   */
  read?: (reply: Reply) => T;
  /** What the caller knows about this call, for its span in the trace ("resume.attempt": 2). Never stored in the database. */
  attributes?: Record<string, string | number | boolean>;
};

/**
 * One chat completion, always streamed and joined into the full reply. Some models on Together only accept streaming
 * requests ("streaming_required"), and streaming works for every model, so every call goes through here. This is also
 * where each call is traced into Phoenix (by the OpenAI instrumentation) and recorded in `llm_calls`.
 */
export async function chatCompletion(params: ChatParams, meta: ChatMeta<Reply> & { read?: undefined }): Promise<Reply>;
export async function chatCompletion<T>(params: ChatParams, meta: ChatMeta<T> & { read: (reply: Reply) => T }): Promise<T>;
export async function chatCompletion<T>(params: ChatParams, meta: ChatMeta<T>): Promise<Reply | T> {
  return traceStep(meta.step, async () => {
    const ctx = currentLlmContext();
    const traceId = currentTraceId();
    const signal = currentAbortSignal();
    const started = Date.now();
    const attempts: Attempts = { starts: [], ends: [] };
    if (meta.attributes) setStepAttributes(meta.attributes);

    let reply: Reply | null = null;
    let status: LlmCallStatus = "ok";
    let error: string | null = null;
    try {
      // A stopped background job (see withAbortSignal) cancels the request and the stream with it.
      // The SDK's own retries happen inside `create`; each try is noted for the record.
      const stream = await countAttempts(attempts, () => chatClient().chat.completions.create({ ...params, stream: true, stream_options: { include_usage: true } }, { signal }));
      let content = "";
      let reasoning = "";
      let finishReason: string | null = null;
      let usage: Usage | null = null;
      for await (const chunk of stream) {
        // The last chunk carries the usage and no choices.
        if (chunk.usage) {
          usage = {
            promptTokens: chunk.usage.prompt_tokens,
            completionTokens: chunk.usage.completion_tokens,
            reasoningTokens: chunk.usage.completion_tokens_details?.reasoning_tokens ?? null,
            cachedTokens: chunk.usage.prompt_tokens_details?.cached_tokens ?? 0,
          };
        }
        const choice = chunk.choices[0];
        if (!choice) continue;
        content += choice.delta?.content ?? "";
        reasoning += thinkingIn(choice.delta);
        if (choice.finish_reason) finishReason = choice.finish_reason;
      }
      reply = { content, reasoning, finishReason, usage };
      // A reply cut off at the limit keeps what the model was thinking, in the trace only, to see what it was stuck on.
      // Thinking repeats what the prompt holds (resume content), so it is saved for these runs and no others.
      if (finishReason === "length" && reasoning) {
        setStepAttributes({ "llm.reasoning.text": reasoning.slice(-THINKING_CHARS), "llm.reasoning.saved": "cut off at the output limit" });
      }
      // A stream cut by a stop can end quietly with what it had so far: say so, rather than reading it as a broken reply.
      if (signal?.aborted) throw new Error("Stopped");
      return meta.read ? meta.read(reply) : reply;
    } catch (err) {
      status = signal?.aborted ? "stopped" : "error";
      error = status === "stopped" ? "Stopped" : err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      void recordLlmCall({
        action: ctx?.action ?? UNKNOWN_ACTION,
        step: meta.step,
        runId: ctx?.runId ?? null,
        model: params.model,
        reasoningEffort: params.reasoning_effort ?? null,
        status,
        error,
        finishReason: reply?.finishReason ?? null,
        promptTokens: reply?.usage?.promptTokens ?? null,
        cachedTokens: reply?.usage?.cachedTokens ?? null,
        completionTokens: reply?.usage?.completionTokens ?? null,
        reasoningTokens: reply?.usage?.reasoningTokens ?? null,
        durationMs: Date.now() - started,
        ...retryStats(attempts),
        traceId,
        jobId: ctx?.jobId ?? null,
        companyId: ctx?.companyId ?? null,
        documentId: ctx?.documentId ?? null,
        documentVersionId: ctx?.documentVersionId ?? null,
        proposalId: ctx?.proposalId ?? null,
        searchId: ctx?.searchId ?? null,
        queueItemId: ctx?.queueItemId ?? null,
      });
    }
  });
}
