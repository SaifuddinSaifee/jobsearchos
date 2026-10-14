import { db as defaultDb, type Db } from "@/lib/db";
import { llmCalls, type NewLlmCall } from "@/lib/db/schema";
import { costUsd } from "./prices";

/** What `chatCompletion` knows about one finished call. The cost is worked out here. */
export type LlmCallEntry = Omit<NewLlmCall, "id" | "createdAt" | "costUsd">;

const ERROR_MAX = 300;
const pending = new Set<Promise<void>>();

/**
 * Saves one model call's numbers. Fire and forget: it never throws and the model call never waits for it, so a
 * database that is down or slow cannot break or stall a call. A lost record is only logged. Pass `db` in tests.
 */
export function recordLlmCall(entry: LlmCallEntry, opts: { db?: Db } = {}): Promise<void> {
  // Tests load .env, which points at the dev database: never let a test call write there.
  if (process.env.VITEST && !opts.db) return Promise.resolve();

  const write = (async () => {
    try {
      const database = opts.db ?? defaultDb();
      const cost = costUsd(entry.model, {
        promptTokens: entry.promptTokens ?? null,
        cachedTokens: entry.cachedTokens ?? null,
        completionTokens: entry.completionTokens ?? null,
      });
      await database.insert(llmCalls).values({ ...entry, error: entry.error?.slice(0, ERROR_MAX) ?? null, costUsd: cost });
    } catch (err) {
      console.error("[llm] usage record failed", err instanceof Error ? err.message : err);
    }
  })();
  pending.add(write);
  void write.finally(() => pending.delete(write));
  return write;
}

/** Waits for records still being written. Scripts call this before closing the database, so the last ones are not lost. */
export async function flushLlmCalls(): Promise<void> {
  await Promise.all([...pending]);
}
