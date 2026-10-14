import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { llmCalls } from "@/lib/db/schema";
import { createDb } from "@/lib/db";
import { flushLlmCalls, recordLlmCall, type LlmCallEntry } from "@/lib/llm/usage";
import { resetDb, testDb, TEST_URL } from "./helpers";

process.env.DATABASE_URL ??= "postgres://unused";
const db = testDb();

const entry = (over: Partial<LlmCallEntry> = {}): LlmCallEntry => ({
  action: "add-job",
  step: "extract-job",
  model: "zai-org/GLM-5.3-Flash",
  status: "ok",
  durationMs: 1200,
  promptTokens: 1000,
  cachedTokens: 400,
  completionTokens: 500,
  reasoningTokens: 120,
  ...over,
});

beforeEach(() => resetDb(db));
afterAll(() => db.$client.end());

describe("recordLlmCall", () => {
  it("stores the numbers and works out the cost", async () => {
    await recordLlmCall(entry({ jobId: "11111111-1111-4111-8111-111111111111", reasoningEffort: "low" }), { db });
    const [row] = await db.select().from(llmCalls);
    expect(row).toMatchObject({
      action: "add-job",
      step: "extract-job",
      status: "ok",
      reasoningEffort: "low",
      promptTokens: 1000,
      cachedTokens: 400,
      completionTokens: 500,
      reasoningTokens: 120,
      costUsd: 0.000352,
      jobId: "11111111-1111-4111-8111-111111111111",
      companyId: null,
    });
    expect(row.createdAt).toBeInstanceOf(Date);
  });

  it("keeps the tokens null when the provider reported none, and the cost with them", async () => {
    await recordLlmCall(entry({ status: "error", error: "404", promptTokens: null, cachedTokens: null, completionTokens: null, reasoningTokens: null }), { db });
    const [row] = await db.select().from(llmCalls);
    expect(row).toMatchObject({ status: "error", error: "404", promptTokens: null, costUsd: null });
  });

  it("stores no cost for a model with no known price", async () => {
    await recordLlmCall(entry({ model: "someone/unknown-model" }), { db });
    const [row] = await db.select().from(llmCalls);
    expect(row.costUsd).toBeNull();
    expect(row.promptTokens).toBe(1000);
  });

  it("shortens a long error", async () => {
    await recordLlmCall(entry({ status: "error", error: "x".repeat(1000) }), { db });
    const [row] = await db.select().from(llmCalls);
    expect(row.error).toHaveLength(300);
  });

  it("never throws when the insert fails, and says so in the log", async () => {
    const closed = createDb(TEST_URL);
    await closed.$client.end();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(recordLlmCall(entry(), { db: closed })).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith("[llm] usage record failed", expect.any(String));
    log.mockRestore();
  });

  it("writes nothing under test when no database is passed, so tests cannot touch the dev database", async () => {
    await recordLlmCall(entry());
    await flushLlmCalls();
    expect(await db.select().from(llmCalls)).toHaveLength(0);
  });

  it("flush waits for records still being written", async () => {
    void recordLlmCall(entry(), { db });
    void recordLlmCall(entry({ step: "rank-contacts" }), { db });
    await flushLlmCalls();
    expect(await db.select().from(llmCalls)).toHaveLength(2);
  });
});
