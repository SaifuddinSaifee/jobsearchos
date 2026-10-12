import { describe, expect, it, vi } from "vitest";
import { fetchYcCompany, parseYcHtml, ycTarget } from "@/lib/outreach/yc";

/** The pages carry their data as HTML-escaped JSON in a data-page attribute. */
const page = (props: unknown) => `<html><body><div id="app" data-page="${JSON.stringify({ component: "X", props }).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;")}"></div></body></html>`;

// Shapes copied from the real pages (workatastartup.com, ycombinator.com), trimmed.
const workAtAStartup = page({
  company: {
    name: "Bloom",
    slug: "trybloom",
    url: "https://trybloom.ai",
    batch: "P26",
    teamSize: 3,
    founders: [{ name: "Ray Fitzgerald", bio: "Founder of Bloom - the brand layer for agents.\nBloom turns brand into infrastructure.", linkedin: "https://www.linkedin.com/in/ray-fitzgerald-86b451148" }],
  },
});
const ycombinator = page({
  company: {
    name: "Bloom",
    slug: "trybloom",
    website: "https://trybloom.ai",
    batch: "P26",
    team_size: 3,
    founders: [
      { is_active: true, full_name: "Ray Fitzgerald", title: "Founder/CEO", founder_bio: "Founder of Bloom.", linkedin_url: "https://www.linkedin.com/in/ray-fitzgerald-86b451148" },
      { is_active: false, full_name: "Left Already", title: "Co-founder" },
      { is_active: true, full_name: "Solo", title: "Co-founder" },
    ],
  },
});

describe("ycTarget", () => {
  it("recognises Y Combinator job and company URLs", () => {
    expect(ycTarget(["https://www.workatastartup.com/jobs/113897"])).toBe("https://www.workatastartup.com/jobs/113897");
    expect(ycTarget(["https://workatastartup.com/companies/trybloom?x=1"])).toBe("https://www.workatastartup.com/companies/trybloom");
    expect(ycTarget(["https://www.ycombinator.com/companies/trybloom/jobs/8eQxoBN-founding-engineer"])).toBe("https://www.ycombinator.com/companies/trybloom");
  });
  it("tries every URL and ignores everything else", () => {
    expect(ycTarget([null, "not a url", "https://boards.greenhouse.io/x/jobs/1", "https://www.workatastartup.com/jobs/5"])).toBe("https://www.workatastartup.com/jobs/5");
    expect(ycTarget(["https://example.com/jobs/1", undefined])).toBeNull();
    expect(ycTarget(["https://www.ycombinator.com/blog/post"])).toBeNull();
  });
});

describe("parseYcHtml", () => {
  it("reads the workatastartup.com layout", () => {
    expect(parseYcHtml(workAtAStartup)).toEqual({
      slug: "trybloom",
      name: "Bloom",
      website: "https://trybloom.ai",
      teamSize: 3,
      batch: "P26",
      founders: [
        {
          name: "Ray Fitzgerald",
          title: "Founder",
          linkedinUrl: "https://www.linkedin.com/in/ray-fitzgerald-86b451148",
          bio: "Founder of Bloom - the brand layer for agents. Bloom turns brand into infrastructure.",
        },
      ],
    });
  });

  it("reads the ycombinator.com layout, skipping people who left and anyone without a full name", () => {
    const c = parseYcHtml(ycombinator)!;
    expect(c.website).toBe("https://trybloom.ai");
    expect(c.teamSize).toBe(3);
    expect(c.founders).toEqual([
      { name: "Ray Fitzgerald", title: "Founder/CEO", linkedinUrl: "https://www.linkedin.com/in/ray-fitzgerald-86b451148", bio: "Founder of Bloom." },
    ]);
  });

  it("returns null for pages without company data", () => {
    expect(parseYcHtml("<html>nothing</html>")).toBeNull();
    expect(parseYcHtml('<div data-page="not json"></div>')).toBeNull();
    expect(parseYcHtml(page({ other: 1 }))).toBeNull();
  });

  it("keeps long bios short", () => {
    const long = page({ company: { name: "A", slug: "a", founders: [{ name: "Ann Lee", bio: "x".repeat(900) }] } });
    expect(parseYcHtml(long)!.founders[0].bio).toHaveLength(280);
  });
});

describe("fetchYcCompany", () => {
  const ok = (html: string) => vi.fn(async () => new Response(html, { status: 200 }));

  it("fetches the page with browser-like headers", async () => {
    const fetcher = ok(workAtAStartup);
    const c = await fetchYcCompany(["https://www.workatastartup.com/jobs/113897"], fetcher);
    expect(c?.founders[0].name).toBe("Ray Fitzgerald");
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://www.workatastartup.com/jobs/113897");
    expect((init.headers as Record<string, string>)["User-Agent"]).toMatch(/Mozilla/);
  });

  it("does nothing for jobs that are not on Y Combinator", async () => {
    const fetcher = vi.fn();
    expect(await fetchYcCompany(["https://boards.greenhouse.io/x/jobs/1"], fetcher)).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("explains failures", async () => {
    await expect(fetchYcCompany(["https://www.workatastartup.com/jobs/1"], vi.fn(async () => new Response("", { status: 406 })))).rejects.toThrow(/HTTP 406/);
    await expect(fetchYcCompany(["https://www.workatastartup.com/jobs/1"], ok("<html></html>"))).rejects.toThrow(/expected company data/);
  });
});
