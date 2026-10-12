import { describe, expect, it, vi } from "vitest";
import { SearchError, type WebSearchProvider } from "@/lib/companies/search";
import { resolveEmail, type EmailSteps, type EmailTarget } from "@/lib/outreach/email-finder";
import { applyPattern, detectPatterns, nameParts, suggestEmails } from "@/lib/outreach/patterns";
import { extractAddresses, findPublicEmail, localMatchesName } from "@/lib/outreach/public-email";
import { ProspeoError } from "@/lib/outreach/prospeo";

describe("patterns", () => {
  it("splits names and ignores accents and punctuation", () => {
    expect(nameParts("José O'Neil")).toEqual({ first: "jose", last: "oneil" });
    expect(nameParts("Madonna")).toBeNull();
    expect(nameParts("Mary Ann van der Berg")).toEqual({ first: "mary", last: "berg" });
  });

  it("applies and detects formats", () => {
    expect(applyPattern("flast", "Ray Fitzgerald", "bloom.ai")).toBe("rfitzgerald@bloom.ai");
    expect(applyPattern("first", "Ray Fitzgerald", "")).toBeNull();
    expect(detectPatterns("Ray Fitzgerald", "ray.fitzgerald@bloom.ai")).toEqual(["first.last"]);
    expect(detectPatterns("Ray Fitzgerald", "RAY@bloom.ai")).toEqual(["first"]);
    expect(detectPatterns("Ray Fitzgerald", "unrelated@bloom.ai")).toEqual([]);
  });

  it("puts formats seen at the company first, then the usual order", () => {
    expect(suggestEmails("Ray Fitzgerald", "bloom.ai", ["flast"]).slice(0, 3)).toEqual(["rfitzgerald@bloom.ai", "ray.fitzgerald@bloom.ai", "ray@bloom.ai"]);
    expect(suggestEmails("Ray Fitzgerald", "bloom.ai")).toHaveLength(6);
    expect(suggestEmails("Ray", "bloom.ai")).toEqual([]);
  });
});

describe("public email search helpers", () => {
  it("finds only addresses at the company's domain", () => {
    expect(extractAddresses("Mail Ray.Fitz@Bloom.ai or sam@bloomtech.ai or x@mail.bloom.ai, ray.fitz@bloom.ai.", "bloom.ai")).toEqual(["ray.fitz@bloom.ai"]);
    expect(extractAddresses("nothing here", "bloom.ai")).toEqual([]);
  });

  it("decides whether the part before the @ belongs to the person", () => {
    for (const ok of ["ray", "ray.fitzgerald", "rfitzgerald", "rayf", "fitzgerald", "ray_fitzgerald"]) expect(localMatchesName(ok, "Ray Fitzgerald")).toBe(true);
    for (const no of ["sam", "info", "rachel", "fitz"]) expect(localMatchesName(no, "Ray Fitzgerald")).toBe(false);
  });
});

describe("findPublicEmail", () => {
  const search = (hits: { title: string; url: string; content: string }[]): WebSearchProvider => ({ search: vi.fn(async () => hits) });

  it("accepts an address that looks like the person's name", async () => {
    const hit = { title: "Commit by Ray", url: "https://github.com/ray/repo", content: "Author: Ray Fitzgerald <rfitzgerald@bloom.ai>" };
    expect(await findPublicEmail({ name: "Ray Fitzgerald" }, "bloom.ai", search([hit]))).toEqual({ email: "rfitzgerald@bloom.ai", url: "https://github.com/ray/repo" });
  });

  it("accepts an unusual address only when the person's name is right next to it", async () => {
    const near = { title: "Press", url: "https://press.example/x", content: "For press, contact Ray Fitzgerald at founders@bloom.ai." };
    expect((await findPublicEmail({ name: "Ray Fitzgerald" }, "bloom.ai", search([near])))?.email).toBe("founders@bloom.ai");
    const far = { title: "Press", url: "https://press.example/x", content: `Contact founders@bloom.ai. ${"filler ".repeat(60)} Ray Fitzgerald is the CEO.` };
    expect(await findPublicEmail({ name: "Ray Fitzgerald" }, "bloom.ai", search([far]))).toBeNull();
  });

  it("ignores shared inboxes and other people's addresses", async () => {
    const hit = { title: "Contact", url: "https://bloom.ai/contact", content: "Reach us: info@bloom.ai, careers@bloom.ai, sam@bloom.ai" };
    expect(await findPublicEmail({ name: "Ray Fitzgerald" }, "bloom.ai", search([hit]))).toBeNull();
  });

  it("searches the web and GitHub, and reports a total search failure", async () => {
    const s = search([]);
    await findPublicEmail({ name: "Ray Fitzgerald" }, "bloom.ai", s);
    const calls = (s.search as ReturnType<typeof vi.fn>).mock.calls as [string, { includeDomains?: string[] }][];
    expect(calls).toHaveLength(2);
    expect(calls[0][0]).toBe('"Ray Fitzgerald" "@bloom.ai"');
    expect(calls[1][1].includeDomains).toEqual(["github.com"]);
    const failing: WebSearchProvider = { search: vi.fn(async () => { throw new SearchError("limit reached"); }) };
    await expect(findPublicEmail({ name: "Ray Fitzgerald" }, "bloom.ai", failing)).rejects.toThrow("limit reached");
  });
});

describe("resolveEmail", () => {
  const target: EmailTarget = { name: "Ray Fitzgerald", linkedinUrl: "https://www.linkedin.com/in/ray", providerId: null, domain: "bloom.ai" };
  const steps = (over: Partial<EmailSteps> = {}): EmailSteps => ({
    known: vi.fn(async () => null),
    publicSearch: vi.fn(async () => null),
    prospeo: vi.fn(async () => null),
    learned: vi.fn(async () => []),
    ...over,
  });

  it("stops at the first source that answers, so later (paid) sources are never called", async () => {
    const s = steps({ known: async () => ({ email: "ray@bloom.ai", status: "verified" }) });
    expect(await resolveEmail(target, s)).toEqual({ kind: "found", email: "ray@bloom.ai", status: "verified", source: "Saved from another job", cost: 0 });
    expect(s.publicSearch).not.toHaveBeenCalled();
    expect(s.prospeo).not.toHaveBeenCalled();
  });

  it("tries a public search before spending a credit", async () => {
    const s = steps({ publicSearch: async () => ({ email: "ray@bloom.ai", url: "https://www.github.com/x" }) });
    expect(await resolveEmail(target, s)).toMatchObject({ kind: "found", status: "unverified", source: "Seen publicly at github.com", cost: 0 });
    expect(s.prospeo).not.toHaveBeenCalled();
  });

  it("spends one credit on Prospeo only when the free sources found nothing", async () => {
    const s = steps({ prospeo: async () => ({ email: "ray@bloom.ai", status: "verified" }) });
    expect(await resolveEmail(target, s)).toEqual({ kind: "found", email: "ray@bloom.ai", status: "verified", source: "Prospeo", cost: 1 });
    expect(s.known).toHaveBeenCalled();
    expect(s.publicSearch).toHaveBeenCalled();
  });

  it("can be told not to spend", async () => {
    const prospeo = vi.fn(async () => ({ email: "x@bloom.ai", status: "verified" as const }));
    expect((await resolveEmail(target, steps({ prospeo }), { paid: false })).kind).toBe("guess");
    expect(prospeo).not.toHaveBeenCalled();
  });

  it("falls back to guesses led by the learned format", async () => {
    const res = await resolveEmail(target, steps({ learned: async () => ["flast"] }));
    expect(res).toMatchObject({ kind: "guess" });
    if (res.kind === "guess") expect(res.guesses[0]).toBe("rfitzgerald@bloom.ai");
  });

  it("gives no guesses without a domain, and skips the public search", async () => {
    const s = steps();
    expect(await resolveEmail({ ...target, domain: null }, s)).toEqual({ kind: "guess", guesses: [] });
    expect(s.publicSearch).not.toHaveBeenCalled();
  });

  it("carries on when a free source fails, and reports which sources answered", async () => {
    const trace = vi.fn();
    const s = steps({
      known: async () => { throw new Error("db"); },
      publicSearch: async () => { throw new SearchError("limit"); },
      prospeo: async () => ({ email: "ray@bloom.ai", status: "verified" }),
    });
    expect((await resolveEmail(target, s, { trace })).kind).toBe("found");
    expect(trace.mock.calls).toEqual([["known", "error"], ["public", "error"], ["prospeo", "found"]]);
  });

  it("raises Prospeo's own error when nothing else found an address", async () => {
    const s = steps({ prospeo: async () => { throw new ProspeoError("Your Prospeo credits are used up.", "INSUFFICIENT_CREDITS"); } });
    await expect(resolveEmail(target, s)).rejects.toThrow("credits are used up");
    const rescued = steps({ prospeo: async () => { throw new ProspeoError("x"); }, publicSearch: async () => ({ email: "ray@bloom.ai", url: "https://a.com" }) });
    expect((await resolveEmail(target, rescued)).kind).toBe("found");
  });
});
