/** USD per million tokens. `cachedInput` is the rate for prompt-cache hits. */
type Price = { input: number; cachedInput: number; output: number };

/**
 * Prices for the models the app is, or may be, configured with. Taken from Together's catalog as recorded in
 * docs/ai-models-for-jso.md (October 2026); check them against Together's pricing page before relying on the dollar
 * figures. Raw token counts are stored with every call, so cost can be recomputed if a price here changes.
 * Where no cache price is listed the input price is used.
 *
 * Keys are the exact Together model ids, matched without regard to case. A model not listed has no known price:
 * its calls are recorded with a null cost and counted as "unpriced" on the usage page.
 */
const PRICES: Record<string, Price> = {
  "zai-org/glm-5.3-flash": { input: 0.15, cachedInput: 0.03, output: 0.5 },
  "minimaxai/minimax-m3": { input: 0.3, cachedInput: 0.06, output: 1.2 },
  "deepseek-ai/deepseek-v4.1-flash": { input: 0.3, cachedInput: 0.006, output: 1.2 },
  "qwen/qwen3.8-flash": { input: 0.15, cachedInput: 0.15, output: 0.47 },
  "openai/gpt-oss-120b": { input: 0.15, cachedInput: 0.15, output: 0.6 },
};

export type CostInput = { promptTokens: number | null; cachedTokens: number | null; completionTokens: number | null };

/**
 * Dollar cost of one call, or null when the model has no known price or the provider reported no usage. Reasoning
 * tokens are already part of the completion count (they are billed as output), so they are not added again.
 */
export function costUsd(model: string, usage: CostInput): number | null {
  const price = PRICES[model.toLowerCase()];
  if (!price || usage.promptTokens === null || usage.completionTokens === null) return null;
  const cached = Math.min(usage.cachedTokens ?? 0, usage.promptTokens);
  const dollars = ((usage.promptTokens - cached) * price.input + cached * price.cachedInput + usage.completionTokens * price.output) / 1_000_000;
  return Math.round(dollars * 1e8) / 1e8;
}
