import type { ChatCompletionCreateParamsBase } from "openai/resources/chat/completions";
import { currentAbortSignal } from "./abort";
import { currentLlmContext, currentTraceId, traceStep } from "./context";
import type { LlmCallStatus, LlmStep } from "./names";
import { UNKNOWN_ACTION } from "./names";
import { chatClient } from "./openai";
import { recordLlmCall } from "./usage";

export type ChatParams = Omit<ChatCompletionCreateParamsBase, "stream" | "stream_options">;

/** Token counts for one call. `reasoningTokens` is null when the model reports none (it did not think, or does not say). */
export type Usage = { promptTokens: number; completionTokens: number; reasoningTokens: number | null; cachedTokens: number };

export type Reply = { content: string; finishReason: string | null; usage: Usage | null };

export type ChatMeta<T> = {
  /** The kind of call, for the trace and the usage record. */
  step: LlmStep;
  /**
   * Turns the reply into the caller's result. If it throws, the call is recorded as failed, with the tokens it spent:
   * a reply that arrives but cannot be used (cut off, not JSON, off schema) is still a call that cost money.
   */
  read?: (reply: Reply) => T;
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

    let reply: Reply | null = null;
    let status: LlmCallStatus = "ok";
    let error: string | null = null;
    try {
      // A stopped background job (see withAbortSignal) cancels the request and the stream with it.
      const stream = await chatClient().chat.completions.create({ ...params, stream: true, stream_options: { include_usage: true } }, { signal });
      let content = "";
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
        if (choice.finish_reason) finishReason = choice.finish_reason;
      }
      reply = { content, finishReason, usage };
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
