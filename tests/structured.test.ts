import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const create = vi.fn();
vi.mock("@/lib/llm/openai", () => ({ chatClient: () => ({ chat: { completions: { create } } }) }));
const record = vi.fn();
vi.mock("@/lib/llm/usage", () => ({ recordLlmCall: record, flushLlmCalls: async () => {} }));

process.env.DATABASE_URL ??= "postgres://unused";
const { chatStructured } = await import("@/lib/llm/structured");
const { withAbortSignal } = await import("@/lib/llm/abort");
const { withLlmContext } = await import("@/lib/llm/context");

const Schema = z.object({ name: z.string() });
const input = { system: "s", user: "u" };
const opts = { step: "extract-job" } as const;
const USAGE = { prompt_tokens: 100, completion_tokens: 40, total_tokens: 140, prompt_tokens_details: { cached_tokens: 30 }, completion_tokens_details: { reasoning_tokens: 12 } };

// A streamed reply, split in two chunks so joining them is tested too, and ending with the usage-only chunk.
const reply = (content: string, finish_reason = "stop", usage: object | null = USAGE) =>
  (async function* () {
    const mid = Math.floor(content.length / 2);
    yield { choices: [{ finish_reason: null, delta: { content: content.slice(0, mid) } }] };
    yield { choices: [{ finish_reason, delta: { content: content.slice(mid) } }] };
    if (usage) yield { choices: [], usage };
  })();

beforeEach(() => {
  create.mockReset();
  record.mockReset();
});

describe("chatStructured", () => {
  it("returns validated output and sends the schema on the extraction model", async () => {
    create.mockResolvedValue(reply('{"name":"Ada"}'));
    await expect(chatStructured(Schema, input, opts)).resolves.toEqual({ name: "Ada" });

    const args = create.mock.calls[0][0];
    expect(args.stream).toBe(true);
    expect(args.model).toBe(process.env.EXTRACTION_MODEL ?? "zai-org/GLM-5.3-Flash");
    expect(args.response_format.type).toBe("json_schema");
    expect(args.response_format.json_schema.schema.properties.name).toBeDefined();
    expect(args.messages[0].content).toContain('"name"');
  });

  it("passes the running job's abort signal to the request, so stopping the job cancels it", async () => {
    create.mockResolvedValue(reply('{"name":"Ada"}'));
    const controller = new AbortController();
    await withAbortSignal(controller.signal, () => chatStructured(Schema, input, opts));
    expect(create.mock.calls[0][1]).toEqual({ signal: controller.signal });
  });

  it("accepts JSON wrapped in code fences", async () => {
    create.mockResolvedValue(reply('```json\n{"name":"Ada"}\n```'));
    await expect(chatStructured(Schema, input, opts)).resolves.toEqual({ name: "Ada" });
  });

  it("throws when output is truncated", async () => {
    create.mockResolvedValue(reply('{"na', "length"));
    await expect(chatStructured(Schema, input, opts)).rejects.toThrow(/cut off/);
  });

  it("throws when output is not JSON", async () => {
    create.mockResolvedValue(reply("Sorry, I can't help with that."));
    await expect(chatStructured(Schema, input, opts)).rejects.toThrow(/not valid JSON/);
  });

  it("throws when output does not match the schema", async () => {
    create.mockResolvedValue(reply('{"name":42}'));
    await expect(chatStructured(Schema, input, opts)).rejects.toThrow(/schema/);
  });

  it("sends no reasoning effort unless asked, so other callers keep the model's default", async () => {
    create.mockResolvedValue(reply('{"name":"Ada"}'));
    await chatStructured(Schema, input, opts);
    expect(create.mock.calls[0][0]).not.toHaveProperty("reasoning_effort");

    create.mockResolvedValue(reply('{"name":"Ada"}'));
    await chatStructured(Schema, input, { ...opts, reasoningEffort: "low" });
    expect(create.mock.calls[1][0].reasoning_effort).toBe("low");
  });

  it("asks for usage and reports it from the final chunk, which has no choices", async () => {
    create.mockResolvedValue(reply('{"name":"Ada"}'));
    const onUsage = vi.fn();
    await expect(chatStructured(Schema, input, { ...opts, onUsage })).resolves.toEqual({ name: "Ada" });
    expect(create.mock.calls[0][0].stream_options).toEqual({ include_usage: true });
    expect(onUsage).toHaveBeenCalledWith({ promptTokens: 100, completionTokens: 40, reasoningTokens: 12, cachedTokens: 30 });
  });

  it("does not report usage when the provider sends none", async () => {
    create.mockResolvedValue(reply('{"name":"Ada"}', "stop", null));
    const onUsage = vi.fn();
    await chatStructured(Schema, input, { ...opts, onUsage });
    expect(onUsage).not.toHaveBeenCalled();
  });
});

describe("recording each call", () => {
  it("records a successful call with its step, model, effort, tokens and outcome", async () => {
    create.mockResolvedValue(reply('{"name":"Ada"}'));
    await chatStructured(Schema, input, { ...opts, model: "some/model", reasoningEffort: "low" });

    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0][0]).toMatchObject({
      action: "unknown",
      step: "extract-job",
      model: "some/model",
      reasoningEffort: "low",
      status: "ok",
      error: null,
      finishReason: "stop",
      promptTokens: 100,
      cachedTokens: 30,
      completionTokens: 40,
      reasoningTokens: 12,
      runId: null,
      traceId: null,
    });
    expect(record.mock.calls[0][0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it("files a call made outside any context as unknown, with no ids", async () => {
    create.mockResolvedValue(reply('{"name":"Ada"}'));
    await chatStructured(Schema, input, opts);
    expect(record.mock.calls[0][0]).toMatchObject({ action: "unknown", jobId: null, documentId: null, queueItemId: null });
  });

  it("gives a call the action and ids of the context it runs in, and each run its own id", async () => {
    create.mockImplementation(async () => reply('{"name":"Ada"}'));
    await withLlmContext("add-job", { queueItemId: "q1", jobId: "j1" }, () => chatStructured(Schema, input, opts));
    await withLlmContext("add-job", { queueItemId: "q2" }, () => chatStructured(Schema, input, opts));

    const [first, second] = record.mock.calls.map((c) => c[0]);
    expect(first).toMatchObject({ action: "add-job", queueItemId: "q1", jobId: "j1", companyId: null });
    expect(second).toMatchObject({ action: "add-job", queueItemId: "q2", jobId: null });
    expect(first.runId).toMatch(/^[0-9a-f-]{36}$/);
    expect(second.runId).not.toBe(first.runId);
  });

  it("keeps the same run id for every call inside one context", async () => {
    create.mockImplementation(async () => reply('{"name":"Ada"}'));
    await withLlmContext("research-company", { companyId: "c1" }, async () => {
      await chatStructured(Schema, input, opts);
      await chatStructured(Schema, input, opts);
    });
    expect(record.mock.calls[0][0].runId).toBe(record.mock.calls[1][0].runId);
    expect(record.mock.calls[0][0].runId).not.toBeNull();
  });

  it("works inside a context and an abort signal together", async () => {
    create.mockResolvedValue(reply('{"name":"Ada"}'));
    const controller = new AbortController();
    await withAbortSignal(controller.signal, () => withLlmContext("read-career-source", { proposalId: "p1" }, () => chatStructured(Schema, input, opts)));
    expect(create.mock.calls[0][1]).toEqual({ signal: controller.signal });
    expect(record.mock.calls[0][0]).toMatchObject({ action: "read-career-source", proposalId: "p1", status: "ok" });
  });

  it("records the tokens of a reply that was cut off, as a failed call", async () => {
    create.mockResolvedValue(reply('{"na', "length"));
    await expect(chatStructured(Schema, input, opts)).rejects.toThrow(/cut off/);
    expect(record.mock.calls[0][0]).toMatchObject({ status: "error", finishReason: "length", completionTokens: 40, error: expect.stringMatching(/cut off/) });
  });

  it("records the tokens of a reply that is not JSON or does not match, as a failed call", async () => {
    create.mockResolvedValueOnce(reply("not json"));
    await expect(chatStructured(Schema, input, opts)).rejects.toThrow();
    create.mockResolvedValueOnce(reply('{"name":42}'));
    await expect(chatStructured(Schema, input, opts)).rejects.toThrow();
    expect(record.mock.calls.map((c) => c[0].status)).toEqual(["error", "error"]);
    expect(record.mock.calls.every((c) => c[0].promptTokens === 100)).toBe(true);
  });

  it("records a request the API rejected, with no tokens", async () => {
    create.mockRejectedValue(new Error("404 model not found"));
    await expect(chatStructured(Schema, input, opts)).rejects.toThrow(/404/);
    expect(record.mock.calls[0][0]).toMatchObject({ status: "error", error: "404 model not found", promptTokens: null, completionTokens: null, finishReason: null });
  });

  it("records a stopped job as stopped, not as a failure", async () => {
    const controller = new AbortController();
    create.mockImplementation(async () => {
      controller.abort();
      throw new Error("Request was aborted.");
    });
    await expect(withAbortSignal(controller.signal, () => chatStructured(Schema, input, opts))).rejects.toThrow();
    expect(record.mock.calls[0][0]).toMatchObject({ status: "stopped", error: "Stopped" });
  });
});

describe("parseResume", () => {
  it("parses with low reasoning effort by default, as the parse step", async () => {
    const { parseResume } = await import("@/lib/resume/parse");
    const { emptyProfile } = await import("@/lib/profile/schema");
    create.mockResolvedValue(reply(JSON.stringify(emptyProfile())));
    await expect(parseResume("Ada Lovelace, analyst")).resolves.toEqual(emptyProfile());
    expect(create.mock.calls[0][0].reasoning_effort).toBe("low");
    expect(record.mock.calls[0][0]).toMatchObject({ step: "parse-resume", reasoningEffort: "low" });
  });
});
