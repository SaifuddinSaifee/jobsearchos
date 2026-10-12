import { describe, expect, it, vi } from "vitest";
import { EMBEDDING_DIMENSIONS, embedQuery, embedTexts } from "@/lib/resume/embed";

process.env.DATABASE_URL ??= "postgres://unused";

const vec = (n = EMBEDDING_DIMENSIONS) => Array.from({ length: n }, (_, i) => i / n);
const ok = (embeddings: number[][]) => new Response(JSON.stringify({ embeddings }), { status: 200 });

describe("embedTexts", () => {
  it("asks Ollama for the stored size and returns vectors in order", async () => {
    const f = vi.fn(async (_url: unknown, init?: RequestInit) => ok(JSON.parse(String(init?.body)).input.map(() => vec())));
    const out = await embedTexts(["a", "b"], { fetch: f as unknown as typeof fetch, baseUrl: "http://ollama.test/", model: "m" });
    expect(out).toHaveLength(2);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("http://ollama.test/api/embed");
    expect(JSON.parse(String(init?.body))).toEqual({ model: "m", input: ["a", "b"], dimensions: EMBEDDING_DIMENSIONS });
  });

  it("sends large inputs in batches of 16", async () => {
    const f = vi.fn(async (_url: unknown, init?: RequestInit) => ok(JSON.parse(String(init?.body)).input.map(() => vec())));
    const out = await embedTexts(Array.from({ length: 35 }, (_, i) => `t${i}`), { fetch: f as unknown as typeof fetch });
    expect(out).toHaveLength(35);
    expect(f).toHaveBeenCalledTimes(3);
  });

  it("explains when Ollama is not running", async () => {
    const f = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(embedTexts(["a"], { fetch: f as unknown as typeof fetch, baseUrl: "http://localhost:1" })).rejects.toThrow(/Could not reach Ollama at http:\/\/localhost:1/);
  });

  it("suggests pulling the model when it is missing", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ error: 'model "m" not found' }), { status: 404 }));
    await expect(embedTexts(["a"], { fetch: f as unknown as typeof fetch, model: "m" })).rejects.toThrow(/ollama pull m/);
  });

  it("rejects vectors of the wrong size or count", async () => {
    await expect(embedTexts(["a"], { fetch: (async () => ok([vec(8)])) as unknown as typeof fetch })).rejects.toThrow(/expected 1024/);
    await expect(embedTexts(["a", "b"], { fetch: (async () => ok([vec()])) as unknown as typeof fetch })).rejects.toThrow(/wrong number/);
  });

  it("does nothing for no input", async () => {
    const f = vi.fn();
    expect(await embedTexts([], { fetch: f as unknown as typeof fetch })).toEqual([]);
    expect(f).not.toHaveBeenCalled();
  });
});

describe("embedQuery", () => {
  it("adds the task instruction Qwen3 expects for searches", async () => {
    const f = vi.fn(async (_url: unknown, init?: RequestInit) => ok(JSON.parse(String(init?.body)).input.map(() => vec())));
    await embedQuery("payments platform", { fetch: f as unknown as typeof fetch });
    const input = JSON.parse(String(f.mock.calls[0][1]?.body)).input[0] as string;
    expect(input).toMatch(/^Instruct: .+\nQuery: payments platform$/);
  });
});
