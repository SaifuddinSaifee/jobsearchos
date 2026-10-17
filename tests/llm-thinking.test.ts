import { beforeEach, describe, expect, it, vi } from "vitest";

const create = vi.fn();
vi.mock("@/lib/llm/openai", () => ({ chatClient: () => ({ chat: { completions: { create } } }) }));
vi.mock("@/lib/llm/usage", () => ({ recordLlmCall: vi.fn(), flushLlmCalls: async () => {} }));
const setStepAttributes = vi.fn();
vi.mock("@/lib/llm/context", async (original) => ({ ...(await original<typeof import("@/lib/llm/context")>()), setStepAttributes }));

process.env.DATABASE_URL ??= "postgres://unused";
const { chatCompletion, thinkingIn } = await import("@/lib/llm/chat");

const USAGE = { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30, completion_tokens_details: { reasoning_tokens: 15 } };
// Thinking first, under the provider's own name for it, then the answer, then the usage-only chunk.
const reply = (finish: string, thinking: object[]) =>
  (async function* () {
    for (const delta of thinking) yield { choices: [{ finish_reason: null, delta }] };
    yield { choices: [{ finish_reason: finish, delta: { content: finish === "stop" ? "Yes." : "" } }] };
    yield { choices: [], usage: USAGE };
  })();

beforeEach(() => {
  create.mockReset();
  setStepAttributes.mockReset();
});

describe("the model's thinking", () => {
  it("is read from the stream under whatever name the provider uses", () => {
    expect(thinkingIn({ reasoning: "Count: let" })).toBe("Count: let");
    expect(thinkingIn({ reasoning_content: "Hmm" })).toBe("Hmm");
    expect(thinkingIn({ content: "Yes.", role: "assistant" })).toBe("");
    expect(thinkingIn(undefined)).toBe("");
  });

  it("is joined into the reply, and saved to the trace only for a reply cut off at the limit", async () => {
    create.mockResolvedValue(reply("stop", [{ reasoning: "17 is " }, { reasoning: "prime." }]));
    const done = await chatCompletion({ model: "m", messages: [] }, { step: "write-resume" });
    expect(done).toMatchObject({ content: "Yes.", reasoning: "17 is prime.", finishReason: "stop" });
    expect(setStepAttributes).not.toHaveBeenCalled();

    create.mockResolvedValue(reply("length", [{ reasoning_content: "Count: let me count the characters" }]));
    await chatCompletion({ model: "m", messages: [] }, { step: "write-resume" });
    expect(setStepAttributes).toHaveBeenCalledWith({ "llm.reasoning.text": "Count: let me count the characters", "llm.reasoning.saved": "cut off at the output limit" });
  });

  it("tags the call's span with what the caller says about it", async () => {
    create.mockResolvedValue(reply("stop", []));
    await chatCompletion({ model: "m", messages: [] }, { step: "write-resume", attributes: { "resume.attempt": 2, "resume.fallback": true } });
    expect(setStepAttributes).toHaveBeenCalledWith({ "resume.attempt": 2, "resume.fallback": true });
  });
});
