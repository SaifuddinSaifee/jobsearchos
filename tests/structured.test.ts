import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const parse = vi.fn();
vi.mock("@/lib/llm/client", () => ({ anthropic: () => ({ messages: { parse } }) }));

process.env.DATABASE_URL ??= "postgres://unused";
const { chatStructured } = await import("@/lib/llm/structured");

const Schema = z.object({ name: z.string() });
const input = { system: "s", user: "u" };

beforeEach(() => parse.mockReset());

describe("chatStructured", () => {
  it("returns parsed output and requests low effort on the extraction model", async () => {
    parse.mockResolvedValue({ stop_reason: "end_turn", parsed_output: { name: "Ada" } });
    await expect(chatStructured(Schema, input)).resolves.toEqual({ name: "Ada" });

    const args = parse.mock.calls[0][0];
    expect(args.model).toBe("claude-sonnet-5-5");
    expect(args.output_config.effort).toBe("low");
  });

  it("throws on refusal", async () => {
    parse.mockResolvedValue({ stop_reason: "refusal", parsed_output: null });
    await expect(chatStructured(Schema, input)).rejects.toThrow(/declined/);
  });

  it("throws when output is truncated", async () => {
    parse.mockResolvedValue({ stop_reason: "max_tokens", parsed_output: null });
    await expect(chatStructured(Schema, input)).rejects.toThrow(/cut off/);
  });

  it("throws when output does not match the schema", async () => {
    parse.mockResolvedValue({ stop_reason: "end_turn", parsed_output: null });
    await expect(chatStructured(Schema, input)).rejects.toThrow(/schema/);
  });
});
