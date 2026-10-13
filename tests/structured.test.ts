import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const create = vi.fn();
vi.mock("@/lib/llm/client", () => ({ together: () => ({ chat: { completions: { create } } }) }));

process.env.DATABASE_URL ??= "postgres://unused";
const { chatStructured } = await import("@/lib/llm/structured");
const { withAbortSignal } = await import("@/lib/llm/abort");

const Schema = z.object({ name: z.string() });
const input = { system: "s", user: "u" };
// A streamed reply, split in two chunks so joining them is tested too.
const reply = (content: string, finish_reason = "stop") =>
  (async function* () {
    const mid = Math.floor(content.length / 2);
    yield { choices: [{ finish_reason: null, delta: { content: content.slice(0, mid) } }] };
    yield { choices: [{ finish_reason, delta: { content: content.slice(mid) } }] };
  })();

beforeEach(() => create.mockReset());

describe("chatStructured", () => {
  it("returns validated output and sends the schema on the extraction model", async () => {
    create.mockResolvedValue(reply('{"name":"Ada"}'));
    await expect(chatStructured(Schema, input)).resolves.toEqual({ name: "Ada" });

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
    await withAbortSignal(controller.signal, () => chatStructured(Schema, input));
    expect(create.mock.calls[0][1]).toEqual({ signal: controller.signal });
  });

  it("accepts JSON wrapped in code fences", async () => {
    create.mockResolvedValue(reply('```json\n{"name":"Ada"}\n```'));
    await expect(chatStructured(Schema, input)).resolves.toEqual({ name: "Ada" });
  });

  it("throws when output is truncated", async () => {
    create.mockResolvedValue(reply('{"na', "length"));
    await expect(chatStructured(Schema, input)).rejects.toThrow(/cut off/);
  });

  it("throws when output is not JSON", async () => {
    create.mockResolvedValue(reply("Sorry, I can't help with that."));
    await expect(chatStructured(Schema, input)).rejects.toThrow(/not valid JSON/);
  });

  it("throws when output does not match the schema", async () => {
    create.mockResolvedValue(reply('{"name":42}'));
    await expect(chatStructured(Schema, input)).rejects.toThrow(/schema/);
  });
});
