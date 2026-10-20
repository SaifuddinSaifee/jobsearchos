import { describe, expect, it, vi } from "vitest";
import { assertPublicUrl, isPrivateAddress, isPrivateHostLiteral, publicHostChecker } from "@/lib/jobs/fetch/guard";

vi.mock("node:dns/promises", () => ({ lookup: vi.fn(async () => [{ address: "93.184.215.14", family: 4 }]) }));

const resolvesTo = (...ips: string[]) => async () => ips;

describe("isPrivateAddress", () => {
  it.each(["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "::", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:c0a8:101"])(
    "rejects %s",
    (ip) => expect(isPrivateAddress(ip)).toBe(true),
  );
  it.each(["93.184.215.14", "8.8.8.8", "172.32.0.1", "2606:4700::1111", "::ffff:808:808"])("allows %s", (ip) =>
    expect(isPrivateAddress(ip)).toBe(false),
  );
});

describe("isPrivateHostLiteral", () => {
  it("catches local names and private literals without DNS", () => {
    for (const h of ["localhost", "app.localhost", "printer.local", "db.internal", "intranet", "127.0.0.1", "[::1]", "192.168.0.10"]) {
      expect(isPrivateHostLiteral(h), h).toBe(true);
    }
    for (const h of ["boards.greenhouse.io", "jobs.ashbyhq.com", "8.8.8.8"]) expect(isPrivateHostLiteral(h), h).toBe(false);
  });
  it("sees through the URL parser's normal forms", () => {
    // WHATWG URL turns these into 127.0.0.1 and [::ffff:7f00:1].
    expect(isPrivateHostLiteral(new URL("http://2130706433/").hostname)).toBe(true);
    expect(isPrivateHostLiteral(new URL("http://0x7f.1/").hostname)).toBe(true);
    expect(isPrivateHostLiteral(new URL("http://[::ffff:127.0.0.1]/").hostname)).toBe(true);
  });
});

describe("assertPublicUrl", () => {
  it("rejects a public-looking name that resolves to a private address", async () => {
    await expect(assertPublicUrl("https://jobs.example.com/1", resolvesTo("93.184.215.14", "192.168.1.5"))).rejects.toMatchObject({
      code: "invalid_url",
    });
  });
  it("allows a name that resolves only to public addresses", async () => {
    await expect(assertPublicUrl("https://jobs.example.com/1", resolvesTo("93.184.215.14"))).resolves.toBeUndefined();
  });
  it("rejects localhost and metadata addresses before any lookup", async () => {
    const resolve = vi.fn(resolvesTo("93.184.215.14"));
    await expect(assertPublicUrl("http://localhost:3000/new", resolve)).rejects.toMatchObject({ code: "invalid_url" });
    await expect(assertPublicUrl("http://169.254.169.254/latest/meta-data", resolve)).rejects.toMatchObject({ code: "invalid_url" });
    expect(resolve).not.toHaveBeenCalled();
  });
  it("leaves a name that does not resolve to the fetch", async () => {
    await expect(
      assertPublicUrl("https://nope.example.com/", async () => {
        throw new Error("ENOTFOUND");
      }),
    ).resolves.toBeUndefined();
  });
});

describe("publicHostChecker", () => {
  it("looks each host up once", async () => {
    const resolve = vi.fn(resolvesTo("93.184.215.14"));
    const check = publicHostChecker(resolve);
    expect(await check("https://cdn.example.com/a.js")).toBe(true);
    expect(await check("https://cdn.example.com/b.css")).toBe(true);
    expect(await check("http://127.0.0.1/admin")).toBe(false);
    expect(resolve).toHaveBeenCalledTimes(1);
  });
});

describe("defaultFetcher", () => {
  it("checks every redirect hop", async () => {
    const { defaultFetcher } = await import("@/lib/jobs/fetch/fetcher");
    const fetchMock = vi.fn<typeof fetch>(async (url) =>
      String(url).startsWith("https://jobs.example.com")
        ? new Response(null, { status: 302, headers: { location: "http://192.168.1.1/admin" } })
        : new Response("secret"),
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      await expect(defaultFetcher("https://jobs.example.com/1")).rejects.toMatchObject({ code: "invalid_url" });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("follows public redirects to the final page", async () => {
    const { defaultFetcher } = await import("@/lib/jobs/fetch/fetcher");
    const fetchMock = vi.fn<typeof fetch>(async (url) =>
      String(url) === "https://jobs.example.com/1"
        ? new Response(null, { status: 301, headers: { location: "/2" } })
        : new Response(`at ${String(url)}`),
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      const res = await defaultFetcher("https://jobs.example.com/1");
      expect(await res.text()).toBe("at https://jobs.example.com/2");
      expect(fetchMock.mock.calls.every(([, init]) => init?.redirect === "manual")).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
