import type { CompletionCreateParamsBase, CompletionCreateParamsStreaming } from "together-ai/resources/chat/completions";
import { currentAbortSignal } from "./abort";
import { together } from "./client";

export type ChatParams = Omit<CompletionCreateParamsBase, "stream">;

/** Token counts for one call. `reasoningTokens` is null when the model reports none (it did not think, or does not say). */
export type Usage = { promptTokens: number; completionTokens: number; reasoningTokens: number | null };

/** The usage object Together sends in the last chunk. The SDK's type leaves out `completion_tokens_details`. */
type RawUsage = { prompt_tokens?: number; completion_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number } | null };

const toUsage = (u: RawUsage): Usage => ({
  promptTokens: u.prompt_tokens ?? 0,
  completionTokens: u.completion_tokens ?? 0,
  reasoningTokens: u.completion_tokens_details?.reasoning_tokens ?? null,
});

/**
 * One chat completion, always streamed and joined into the full reply. Some models on Together only accept streaming
 * requests ("streaming_required"), and streaming works for every model, so every call goes through here.
 */
export async function chatCompletion(params: ChatParams): Promise<{ content: string; finishReason: string | null; usage: Usage | null }> {
  // `stream_options` is not in the SDK's types, but Together honours it: the stream then ends with a usage-only chunk.
  const request = { ...params, stream: true, stream_options: { include_usage: true } } as CompletionCreateParamsStreaming;
  // A stopped background job (see withAbortSignal) cancels the request and the stream with it.
  const stream = await together().chat.completions.create(request, { signal: currentAbortSignal() });
  let content = "";
  let finishReason: string | null = null;
  let usage: Usage | null = null;
  for await (const chunk of stream) {
    if (chunk.usage) usage = toUsage(chunk.usage as RawUsage);
    const choice = chunk.choices[0];
    if (!choice) continue;
    content += choice.delta?.content ?? "";
    if (choice.finish_reason) finishReason = choice.finish_reason;
  }
  return { content, finishReason, usage };
}
