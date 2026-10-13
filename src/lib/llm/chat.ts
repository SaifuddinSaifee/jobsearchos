import type { CompletionCreateParamsBase } from "together-ai/resources/chat/completions";
import { together } from "./client";

export type ChatParams = Omit<CompletionCreateParamsBase, "stream">;

/**
 * One chat completion, always streamed and joined into the full reply. Some models on Together only accept streaming
 * requests ("streaming_required"), and streaming works for every model, so every call goes through here.
 */
export async function chatCompletion(params: ChatParams): Promise<{ content: string; finishReason: string | null }> {
  const stream = await together().chat.completions.create({ ...params, stream: true });
  let content = "";
  let finishReason: string | null = null;
  for await (const chunk of stream) {
    const choice = chunk.choices[0];
    if (!choice) continue;
    content += choice.delta?.content ?? "";
    if (choice.finish_reason) finishReason = choice.finish_reason;
  }
  return { content, finishReason };
}
