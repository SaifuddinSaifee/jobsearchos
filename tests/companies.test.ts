import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { companies, companyAliases, jobs } from "@/lib/db/schema";
import { companySection, companyToMarkdown, companyFilename } from "@/lib/companies/markdown";
import { companySiteBase, pageScore, rankResults, researchCompany, ResearchError } from "@/lib/companies/research";
import { SearchError, TavilyProvider, type WebSearchProvider } from "@/lib/companies/search";
import {
  applyResearch,
  backfillCompanies,
  companyJobUrls,
  createCompany,
  findCompanyByName,
  getCompanyDetail,
  listCompanies,
  mergeCompanies,
  needsResearch,
  normalizeCompanyName,
  resolveCompany,
  updateCompany,
} from "@/lib/companies/service";
import { jobToMarkdown, detailToMarkdownJob } from "@/lib/jobs/markdown";
import { emptyExtraction, type JobDraft } from "@/lib/jobs/schema";
import { saveJob } from "@/lib/jobs/service";
import { getJobDetail } from "@/lib/jobs/tracker";
import { resetDb, testDb } from "./helpers";

process.env.DATABASE_URL ??= "postgres://unused";
vi.mock("@/lib/llm/client", () => ({ together: () => ({}) }));
const chatStructured = vi.fn();
vi.mock("@/lib/llm/structured", () => ({ chatStructured: (...a: unknown[]) => chatStructured(...a) }));

const db = testDb();
beforeEach(async () => {
  await resetDb(db);
  await db.execute(sql`TRUNCATE company_aliases, companies RESTART IDENTITY CASCADE`);
  chatStructured.mockReset();
});
afterAll(() => db.$client.end());

function draft(n: number, over: Partial<JobDraft> = {}): JobDraft {
  const e = { ...emptyExtraction(), company: "Google LLC", title: `Engineer ${n}`, location: "Austin, TX", aboutCompany: "Google organizes the world's information." };
  return {
    ...e,
    sourceUrl: `https://example.com/jobs/${n}`,
    fetchMethod: "html",
    ats: null,
    atsJobId: null,
    rawFileId: null,
    rawText: "raw",
    normalized: e,
    ...over,
  };
}

const research = (over = {}) => ({
  website: "https://about.google",
  about: "Search and cloud company.",
  principles: "1. Focus on the user.",
  culture: "",
  sources: [{ url: "https://about.google/", title: "About Google" }],
  ...over,
});

describe("matching", () => {
  it("normalizes names by dropping case, punctuation and suffixes", () => {
    expect(normalizeCompanyName("Google LLC")).toBe("google");
    expect(normalizeCompanyName("ACME, Inc.")).toBe(normalizeCompanyName("acme"));
    expect(normalizeCompanyName("Inc.")).toBe("inc."); // never empty
  });

  it("links name variants to one company", async () => {
    const a = await resolveCompany({ name: "Google" }, db);
    const b = await resolveCompany({ name: "Google LLC" }, db);
    const c = await resolveCompany({ name: "  GOOGLE  " }, db);
    expect(new Set([a.id, b.id, c.id]).size).toBe(1);
    expect(await db.select().from(companies)).toHaveLength(1);
  });

  it("links aliases (YouTube -> Google)", async () => {
    const g = await resolveCompany({ name: "Google" }, db);
    await updateCompany(g.id, { aliases: ["YouTube"] }, db);
    expect((await findCompanyByName("youtube", db))?.id).toBe(g.id);
    expect((await resolveCompany({ name: "YouTube" }, db)).id).toBe(g.id);
  });

  it("creates a company only once under concurrent saves", async () => {
    const rows = await Promise.all(Array.from({ length: 5 }, () => resolveCompany({ name: "Initech" }, db)));
    expect(new Set(rows.map((r) => r.id)).size).toBe(1);
  });
});

describe("saving a job", () => {
  it("links the job to a shared company and keeps the posting's own about text", async () => {
    const r1 = await saveJob(draft(1), db);
    const r2 = await saveJob(draft(2, { company: "Google" }), db);
    if (!r1.ok || !r2.ok) throw new Error("save failed");
    const rows = await db.select().from(jobs);
    expect(new Set(rows.map((j) => j.companyId)).size).toBe(1);
    expect(rows[0].aboutCompany).toBe("Google organizes the world's information.");
    const [c] = await db.select().from(companies);
    expect(c).toMatchObject({ about: "Google organizes the world's information.", provenance: { about: "posting" } });
  });

  it("applies research from the draft but never over fields the user wrote", async () => {
    const first = await saveJob(draft(1), db);
    if (!first.ok) throw new Error("save failed");
    const [c] = await db.select().from(companies);
    await updateCompany(c.id, { principles: "My own principles" }, db);
    await saveJob(draft(2, { companyResearch: research({ principles: "Web principles", culture: "Web culture" }) }), db);
    const [after] = await db.select().from(companies);
    expect(after.principles).toBe("My own principles");
    expect(after.culture).toBe("Web culture");
    expect(after.provenance).toMatchObject({ principles: "user", culture: "web" });
    expect(after.researchedAt).not.toBeNull();
  });

  it("rolls the company back with a failed save", async () => {
    await expect(saveJob(draft(1, { fetchMethod: "bogus" as never }), db)).rejects.toThrow();
    expect(await db.select().from(companies)).toHaveLength(0);
  });
});

describe("editing", () => {
  it("marks changed fields as user-owned and hands cleared fields back", async () => {
    const c = await createCompany("Acme", db);
    await updateCompany(c.id, { about: "We make anvils", notes: "private" }, db);
    let [row] = await db.select().from(companies).where(eq(companies.id, c.id));
    expect(row.provenance).toEqual({ about: "user" });
    expect(row.notes).toBe("private");
    await updateCompany(c.id, { about: "" }, db);
    [row] = await db.select().from(companies).where(eq(companies.id, c.id));
    expect(row.provenance).toEqual({});
  });

  it("renames, and refuses a name another company already uses", async () => {
    const a = await createCompany("Acme", db);
    await createCompany("Globex", db);
    await updateCompany(a.id, { name: "Acme Corporation" }, db);
    expect((await findCompanyByName("acme", db))?.name).toBe("Acme Corporation");
    await expect(updateCompany(a.id, { name: "Globex" }, db)).rejects.toThrow(/already exists/);
  });

  it("refuses an alias that belongs to another company, and replaces the alias list", async () => {
    const a = await createCompany("Acme", db);
    const b = await createCompany("Globex", db);
    await updateCompany(a.id, { aliases: ["Road Runner Co", "RR"] }, db);
    await expect(updateCompany(b.id, { aliases: ["RR"] }, db)).rejects.toThrow(/already uses/);
    await updateCompany(a.id, { aliases: ["RR"] }, db);
    expect((await db.select().from(companyAliases)).map((x) => x.alias)).toEqual(["RR"]);
  });

  it("limits field length and rejects unknown companies", async () => {
    const a = await createCompany("Acme", db);
    await expect(updateCompany(a.id, { about: "x".repeat(20_001) }, db)).rejects.toThrow(/at most/);
    await expect(updateCompany("00000000-0000-4000-8000-000000000000", { about: "x" }, db)).rejects.toThrow(/not found/);
    await expect(createCompany("   ", db)).rejects.toThrow(/name/);
  });
});

describe("applyResearch", () => {
  it("fills empty and web fields, skips user fields, never blanks existing text", async () => {
    const c = await createCompany("Acme", db);
    await updateCompany(c.id, { culture: "Mine" }, db);
    const applied = await applyResearch(c.id, research({ about: "A", principles: "", culture: "Web" }), db);
    expect(applied).toEqual(["about"]);
    const [row] = await db.select().from(companies).where(eq(companies.id, c.id));
    expect(row).toMatchObject({ about: "A", principles: "", culture: "Mine", website: "https://about.google" });
    // a later empty result keeps what is there
    await applyResearch(c.id, research({ about: "" }), db);
    expect((await db.select().from(companies).where(eq(companies.id, c.id)))[0].about).toBe("A");
  });

  it("stores the research log and the owned/third-party label of each source", async () => {
    const c = await createCompany("Acme", db);
    const log = {
      via: "web-search" as const,
      queries: ["Acme company about mission values culture"],
      pages: [{ url: "https://acme.com/about", title: "About Acme", kind: "owned" as const, origin: "search" as const }],
    };
    await applyResearch(c.id, research({ sources: [{ url: "https://acme.com/about", title: "About Acme", kind: "owned" }], log }), db);
    const detail = (await getCompanyDetail(c.id, db))!;
    expect(detail.researchLog).toEqual(log);
    expect(detail.sources).toEqual([{ url: "https://acme.com/about", title: "About Acme", kind: "owned" }]);
  });

  it("knows when research is still worth running", () => {
    const base = { about: "", principles: "", culture: "", researchedAt: null };
    expect(needsResearch(base)).toBe(true);
    expect(needsResearch({ ...base, researchedAt: new Date() })).toBe(false);
    expect(needsResearch({ about: "a", principles: "b", culture: "c", researchedAt: null })).toBe(false);
  });
});

describe("merging", () => {
  it("moves jobs and aliases, keeps the old name as an alias and fills empty fields", async () => {
    const r1 = await saveJob(draft(1, { company: "Google LLC" }), db);
    const r2 = await saveJob(draft(2, { company: "YouTube", aboutCompany: "Video platform" }), db);
    if (!r1.ok || !r2.ok) throw new Error("save failed");
    const [google, youtube] = [await findCompanyByName("Google", db), await findCompanyByName("YouTube", db)];
    await updateCompany(youtube!.id, { notes: "creator tools", aliases: ["YT"] }, db);
    await mergeCompanies(youtube!.id, google!.id, db);

    expect(await db.select().from(companies)).toHaveLength(1);
    const detail = (await getCompanyDetail(google!.id, db))!;
    expect(detail.jobs).toHaveLength(2);
    expect(detail.aliases.sort()).toEqual(["YT", "YouTube"]);
    expect(detail.notes).toBe("creator tools");
    expect((await findCompanyByName("YT", db))?.id).toBe(google!.id);
  });

  it("refuses to merge a company into itself", async () => {
    const a = await createCompany("Acme", db);
    await expect(mergeCompanies(a.id, a.id, db)).rejects.toThrow(/different/);
  });
});

describe("directory", () => {
  it("lists companies with job counts and backfills jobs saved before the directory", async () => {
    await saveJob(draft(1, { company: "Acme" }), db);
    await saveJob(draft(2, { company: "Acme" }), db);
    await saveJob(draft(3, { company: "Globex", aboutCompany: "" }), db);
    await db.execute(sql`UPDATE jobs SET company_id = NULL`);
    await db.execute(sql`DELETE FROM company_aliases`);
    await db.execute(sql`DELETE FROM companies`);
    await backfillCompanies(db);
    const list = await listCompanies(db);
    expect(list.map((c) => [c.name, c.jobCount])).toEqual([["Acme", 2], ["Globex", 1]]);
    expect(list[0].hasAbout).toBe(true);
  });
});

describe("job detail and Markdown", () => {
  it("includes the directory profile and the posting's own text", async () => {
    const r = await saveJob(draft(1, { companyResearch: research() }), db);
    if (!r.ok) throw new Error("save failed");
    const c = (await findCompanyByName("Google", db))!;
    await updateCompany(c.id, { notes: "Dream job", principles: "1. Focus on the user\n2. Fast is better than slow" }, db);
    const detail = (await getJobDetail(r.jobId, db))!;
    expect(detail.companyProfile?.name).toBe("Google LLC");
    const md = jobToMarkdown(detailToMarkdownJob(detail));
    expect(md).toContain("## About the company");
    expect(md).toContain("- **Website:** https://about.google");
    expect(md).toContain("### Mission, values and principles\n\n1. Focus on the user\n2. Fast is better than slow");
    expect(md).toContain("### My notes about the company\n\nDream job");
    expect(md).toContain("- [About Google](https://about.google/)");
    expect(md.indexOf("## About the company")).toBeLessThan(md.indexOf("## Full job posting text"));
  });
});

describe("company Markdown", () => {
  const c = { name: "Google", website: "https://about.google", about: "Search.", principles: "1. Users first", culture: "", notes: "", sources: [] };
  it("renders a standalone profile and omits empty sections", () => {
    const md = companyToMarkdown(c);
    expect(md.startsWith("# Google\n")).toBe(true);
    expect(md).toContain("## What they do\n\nSearch.");
    expect(md).toContain("## Mission, values and principles");
    expect(md).not.toContain("Culture");
    expect(md).not.toContain("Sources");
  });
  it("says so when nothing is written", () => {
    expect(companyToMarkdown({ ...c, website: "", about: "", principles: "" })).toContain("No profile written yet.");
  });
  it("shows the posting text only when it adds something", () => {
    expect(companySection(c, "Search.", 2)).not.toContain("As described in this job posting");
    expect(companySection(c, "We also do ads.", 2)).toContain("### As described in this job posting\n\nWe also do ads.");
    expect(companySection(null, "", 2)).toBe("");
  });
  it("names the file", () => {
    expect(companyFilename("Google LLC")).toBe("google-llc-profile.md");
  });
});

describe("company research (free sources first; every search here is a fake)", () => {
  const results = [
    { title: "Google - LinkedIn", url: "https://www.linkedin.com/company/google", content: "li" },
    { title: "Wikipedia", url: "https://en.wikipedia.org/wiki/Google", content: "Google LLC is..." },
    { title: "About Google", url: "https://about.google/", content: "Our mission is to organize information." },
    { title: "Jobs", url: "https://boards.greenhouse.io/google/jobs/1", content: "job" },
    { title: "About Google", url: "https://about.google/", content: "dup" },
  ];
  const LONG = "Google builds products used by billions of people around the world every single day. ".repeat(12);
  const page = (body = LONG) => `<html><body><main><p>${body}</p></main></body></html>`;
  // Complete answer: no follow-up search is needed.
  const full = { website: "", about: "Search and cloud.", principles: "1. Users", culture: "Small teams.", usedSources: [] as number[] };

  type Call = { query: string; includeDomains?: string[] };
  /** A fake search; the test fails loudly if it is called when it should not be. */
  const fakeSearch = (rows = results, byCall: (n: number) => typeof results = () => rows) => {
    const calls: Call[] = [];
    const provider: WebSearchProvider = {
      search: async (query, opts) => (calls.push({ query, includeDomains: opts?.includeDomains }), byCall(calls.length)),
    };
    return { calls, provider };
  };
  const noSearch: WebSearchProvider = { search: async () => { throw new Error("the paid search must not be called"); } };
  const siteFetcher = (pages: Record<string, string>) => async (url: string) => {
    const hit = pages[new URL(url).pathname];
    return hit === undefined ? new Response("", { status: 404 }) : new Response(hit);
  };
  const failFetch = async () => new Response("", { status: 500 });

  describe("rankResults", () => {
    it("drops job boards and duplicates, marks owned pages and puts them first", () => {
      expect(rankResults("Google LLC", results).map((r) => [r.url, r.kind])).toEqual([
        ["https://about.google/", "owned"],
        ["https://en.wikipedia.org/wiki/Google", "third-party"],
      ]);
    });

    it("does not treat a video on the company's host as the company (the YouTube case)", () => {
      const youtube = [
        { title: "Your Mission, Vision, and Values (with Examples)", url: "https://www.youtube.com/watch?v=Z4_YNeVsZhw", content: "generic video" },
        { title: "YouTube Mission, Vision & Values | Comparably", url: "https://www.comparably.com/companies/youtube/mission", content: "survey stats" },
        { title: "@YouTube", url: "https://www.youtube.com/@YouTube", content: "channel" },
        { title: "Inside YouTube", url: "https://blog.youtube/inside-youtube", content: "blog" },
        { title: "About YouTube", url: "https://www.youtube.com/about/", content: "about" },
        { title: "YouTube - Wikipedia", url: "https://en.wikipedia.org/wiki/YouTube", content: "wiki" },
      ];
      expect(rankResults("YouTube", youtube).map((r) => [r.url, r.kind])).toEqual([
        ["https://www.youtube.com/about/", "owned"], // About-style path first
        ["https://blog.youtube/inside-youtube", "owned"],
        ["https://en.wikipedia.org/wiki/YouTube", "third-party"],
      ]);
    });

    it("scores About-style paths and about. subdomains above plain pages", () => {
      expect(pageScore("https://x.com/about")).toBeGreaterThan(pageScore("https://x.com/pricing"));
      expect(pageScore("https://about.x.com/")).toBeGreaterThan(pageScore("https://blog.x.com/post"));
      expect(pageScore("not a url")).toBe(0);
    });

    it("treats a known company host as owned even when its name is not in the host", () => {
      const r = rankResults("Alphabet", [{ title: "G", url: "https://abc.xyz/investor", content: "" }], ["abc.xyz"]);
      expect(r[0].kind).toBe("owned");
    });
  });

  describe("companySiteBase", () => {
    it("uses the company's own hosts and ignores ATS, job boards and unrelated sites", () => {
      expect(companySiteBase("Stripe", ["https://stripe.com/jobs/search?gh_jid=1"])).toBe("https://stripe.com");
      expect(companySiteBase("Google LLC", ["https://careers.google.com/jobs/results/1"])).toBe("https://google.com");
      expect(companySiteBase("Google", [null, "https://boards.greenhouse.io/google/jobs/1", "https://acme-recruiters.com/job/9", "https://www.google.com/about"])).toBe("https://google.com");
      expect(companySiteBase("Stripe", ["https://boards.greenhouse.io/stripe/jobs/1", "https://www.linkedin.com/jobs/view/1"])).toBeNull();
      expect(companySiteBase("Ab", ["https://ab.com"])).toBeNull(); // too short to trust
    });
    it("prefers a saved website over job URLs", () => {
      expect(companySiteBase("Google", ["https://about.google/", "https://careers.google.com/x"])).toBe("https://about.google");
    });
  });

  it("uses only the company's own site when it has enough, and never calls the search", async () => {
    chatStructured.mockResolvedValue({ ...full, usedSources: [2] });
    const out = await researchCompany("Google", {
      search: noSearch,
      siteBase: "https://google.com",
      fetcher: siteFetcher({ "/about": page() }),
      postingAbout: "Google organizes the world's information and makes it universally accessible and useful to everyone.",
    });
    expect(out.via).toBe("company-site");
    expect(out).toMatchObject({ about: "Search and cloud.", website: "https://google.com" });
    expect(out.sources).toEqual([{ url: "https://google.com/about", title: "google.com/about", kind: "owned" }]);
    expect(out.log).toEqual({
      via: "company-site",
      queries: [],
      pages: [{ url: "https://google.com/about", title: "google.com/about", kind: "owned", origin: "site" }],
    });
    const prompt = chatStructured.mock.calls[0][1];
    expect(prompt.user).toContain("[1] (company-owned) Job posting: what it says about the company\nGoogle organizes the world's information");
    expect(prompt.user).toContain("[2] (company-owned) google.com/about (https://google.com/about)");
    expect(prompt.system).toMatch(/untrusted/);
    expect(prompt.system).toMatch(/Use ONLY company-owned sources/);
    expect(prompt.system).toMatch(/acquisition prices/);
  });

  it("renders a thin page that loaded (JS shell) in the browser, and skips pages that 404", async () => {
    chatStructured.mockResolvedValue(full);
    const rendered: string[] = [];
    const out = await researchCompany("Google", {
      search: noSearch,
      siteBase: "https://google.com",
      fetcher: siteFetcher({ "/about": "<html><body><div id=root></div></body></html>" }),
      render: async (url) => (rendered.push(url), page()),
    });
    expect(rendered).toEqual(["https://google.com/about"]); // the other paths were 404: not rendered
    expect(out.via).toBe("company-site");
  });

  it("limits headless-browser renders", async () => {
    chatStructured.mockResolvedValue(full);
    const rendered: string[] = [];
    const shell = "<html><body><div id=root></div></body></html>";
    await researchCompany("Google", {
      search: fakeSearch([]).provider,
      siteBase: "https://google.com",
      fetcher: siteFetcher({ "/about": shell, "/about-us": shell, "/company": shell, "/values": shell }),
      render: async (url) => (rendered.push(url), shell),
    }).catch(() => {});
    expect(rendered.length).toBeLessThanOrEqual(2);
  });

  it("falls back to ONE combined search when the site is thin, and merges both kinds of source", async () => {
    const { calls, provider } = fakeSearch();
    chatStructured.mockResolvedValue({ ...full, website: "https://about.google", usedSources: [1, 2] });
    const out = await researchCompany("Google", {
      search: provider,
      siteBase: "https://google.com",
      fetcher: async (url) => (new URL(url).pathname === "/about" ? new Response(page("Short but real page. ".repeat(30))) : new Response("", { status: 404 })),
    });
    expect(calls).toEqual([{ query: "Google company about mission values culture", includeDomains: undefined }]);
    expect(out.via).toBe("web-search");
    expect(out.website).toBe("https://about.google");
    expect(out.sources.map((s) => [s.url, s.kind])).toEqual([["https://google.com/about", "owned"], ["https://about.google/", "owned"]]);
    expect(out.log.queries).toEqual(["Google company about mission values culture"]);
  });

  it("searches once when there is no company site at all, using snippets when pages cannot be fetched", async () => {
    const { calls, provider } = fakeSearch();
    chatStructured.mockResolvedValue(full);
    const out = await researchCompany("Google", { search: provider, fetcher: failFetch });
    expect(calls).toHaveLength(1);
    expect(out.via).toBe("web-search");
    expect(chatStructured.mock.calls[0][1].user).toContain("[1] (company-owned) About Google (https://about.google/)\nOur mission is to organize information.");
    expect(chatStructured.mock.calls[0][1].user).toContain("(third-party) Wikipedia");
  });

  it("prefers fetched page text over the snippet", async () => {
    chatStructured.mockResolvedValue(full);
    await researchCompany("Google", { search: fakeSearch().provider, fetcher: async () => new Response(page()) });
    expect(chatStructured.mock.calls[0][1].user).toContain("Google builds products used by billions");
  });

  describe("owned-source rule", () => {
    const wiki = [{ title: "Wikipedia", url: "https://en.wikipedia.org/wiki/Initech", content: "Initech makes TPS reports." }];

    it("throws away mission and culture when only third-party sources were used", async () => {
      chatStructured.mockResolvedValue({ website: "", about: "Initech makes software.", principles: "- Synergy", culture: "- 90% say it is great", usedSources: [1] });
      const out = await researchCompany("Initech", { search: fakeSearch(wiki).provider, fetcher: failFetch });
      expect(out).toMatchObject({ about: "Initech makes software.", principles: "", culture: "" });
      expect(out.sources).toEqual([{ url: "https://en.wikipedia.org/wiki/Initech", title: "Wikipedia", kind: "third-party" }]);
    });

    it("fails when only third-party text exists and the model returns nothing for 'about'", async () => {
      chatStructured.mockResolvedValue({ website: "", about: "", principles: "- x", culture: "- y", usedSources: [1] });
      await expect(researchCompany("Initech", { search: fakeSearch(wiki).provider, fetcher: failFetch })).rejects.toBeInstanceOf(ResearchError);
    });
  });

  describe("conditional second query", () => {
    const official = [{ title: "About Google", url: "https://about.google/", content: "Our mission is to organize information." }];

    it("runs one follow-up restricted to the company's own domains when mission/values are missing", async () => {
      const { calls, provider } = fakeSearch(official);
      chatStructured
        .mockResolvedValueOnce({ ...full, principles: "", culture: "" })
        .mockResolvedValueOnce({ ...full, principles: "1. Focus on the user" });
      const out = await researchCompany("Google", { search: provider, fetcher: failFetch });
      expect(calls).toHaveLength(2);
      expect(calls[0].includeDomains).toBeUndefined();
      expect(calls[1]).toEqual({ query: "Google mission values principles culture", includeDomains: ["about.google"] });
      expect(chatStructured).toHaveBeenCalledTimes(2);
      expect(out.principles).toBe("1. Focus on the user");
      expect(out.log.queries).toEqual(["Google company about mission values culture", "Google mission values principles culture (only about.google)"]);
    });

    it("never makes more than two searches", async () => {
      const { calls, provider } = fakeSearch(official);
      chatStructured.mockResolvedValue({ ...full, principles: "", culture: "" });
      await researchCompany("Google", { search: provider, fetcher: failFetch });
      expect(calls).toHaveLength(2);
    });

    it("skips the follow-up when everything was found", async () => {
      const { calls, provider } = fakeSearch(official);
      chatStructured.mockResolvedValue(full);
      await researchCompany("Google", { search: provider, fetcher: failFetch });
      expect(calls).toHaveLength(1);
    });

    it("skips the follow-up when no company-owned domain is known to restrict it to", async () => {
      const { calls, provider } = fakeSearch([{ title: "Wikipedia", url: "https://en.wikipedia.org/wiki/Initech", content: "Initech makes TPS reports." }]);
      chatStructured.mockResolvedValue({ website: "", about: "About.", principles: "", culture: "", usedSources: [] });
      await researchCompany("Initech", { search: provider, fetcher: failFetch });
      expect(calls).toHaveLength(1);
    });

    it("after a free-tier read with no values, makes a single domain-restricted search", async () => {
      const { calls, provider } = fakeSearch([{ title: "Our values", url: "https://google.com/about/values", content: "x" }]);
      chatStructured
        .mockResolvedValueOnce({ ...full, principles: "" })
        .mockResolvedValueOnce({ ...full, principles: "1. Users" });
      const out = await researchCompany("Google", { search: provider, siteBase: "https://google.com", fetcher: siteFetcher({ "/about": page() }) });
      expect(calls).toEqual([{ query: "Google mission values principles culture", includeDomains: ["google.com"] }]);
      expect(out.principles).toBe("1. Users");
      expect(out.via).toBe("web-search");
    });

    it("keeps the first result when the follow-up search fails", async () => {
      let n = 0;
      const provider: WebSearchProvider = {
        search: async () => {
          if (++n === 2) throw new SearchError("rate limit");
          return official;
        },
      };
      chatStructured.mockResolvedValue({ ...full, principles: "" });
      const out = await researchCompany("Google", { search: provider, fetcher: failFetch });
      expect(out.about).toBe("Search and cloud.");
      expect(chatStructured).toHaveBeenCalledTimes(1);
    });
  });

  it("without a search key, explains what is missing instead of searching", async () => {
    await expect(researchCompany("Google", { fetcher: failFetch })).rejects.toThrow(/No company website to read.*TAVILY_API_KEY/);
    await expect(researchCompany("Google", { siteBase: "https://google.com", fetcher: failFetch, postingAbout: "x".repeat(200) })).rejects.toThrow(/Not enough about the company/);
    expect(chatStructured).not.toHaveBeenCalled();
  });

  it("fails clearly when nothing usable is found", async () => {
    await expect(researchCompany("Zed", { search: fakeSearch([]).provider, fetcher: failFetch })).rejects.toThrow(/No web results/);
    await expect(researchCompany("Zed", { search: fakeSearch([results[0]]).provider, fetcher: failFetch })).rejects.toThrow(/job boards, videos and review sites/);
    chatStructured.mockResolvedValue({ website: "", about: "", principles: "", culture: "", usedSources: [] });
    await expect(researchCompany("Google", { search: fakeSearch().provider, fetcher: failFetch })).rejects.toBeInstanceOf(ResearchError);
  });

  it("reports a search failure from the provider", async () => {
    const broken: WebSearchProvider = { search: async () => { throw new SearchError("rate limit"); } };
    await expect(researchCompany("Google", { search: broken, fetcher: failFetch })).rejects.toThrow(/rate limit/);
  });
});

describe("parent companies", () => {
  it("links a brand to its parent, shows both ways, and refuses loops", async () => {
    const google = await createCompany("Google", db);
    const yt = await createCompany("YouTube", db);
    await updateCompany(yt.id, { parentId: google.id }, db);
    expect((await getCompanyDetail(yt.id, db))).toMatchObject({ parentId: google.id, parent: { name: "Google" } });
    expect((await getCompanyDetail(google.id, db))!.children).toEqual([{ id: yt.id, name: "YouTube" }]);
    expect((await listCompanies(db)).find((c) => c.name === "YouTube")?.parentName).toBe("Google");
    await expect(updateCompany(google.id, { parentId: yt.id }, db)).rejects.toThrow(/part of each other/);
    await expect(updateCompany(yt.id, { parentId: yt.id }, db)).rejects.toThrow(/itself/);
    await expect(updateCompany(yt.id, { parentId: "00000000-0000-4000-8000-000000000000" }, db)).rejects.toThrow(/not found/);
    await updateCompany(yt.id, { parentId: null }, db);
    expect((await getCompanyDetail(yt.id, db))!.parent).toBeNull();
  });

  it("goes with the job: detail carries the parent, and Markdown adds the parent's profile", async () => {
    const r = await saveJob(draft(1, { company: "YouTube", aboutCompany: "Video platform" }), db);
    if (!r.ok) throw new Error("save failed");
    const yt = (await findCompanyByName("YouTube", db))!;
    const google = await createCompany("Google", db);
    await updateCompany(google.id, { about: "Search and cloud", principles: "1. Focus on the user", culture: "Small teams" }, db);
    await updateCompany(yt.id, { parentId: google.id, principles: "Four freedoms" }, db);
    const detail = (await getJobDetail(r.jobId, db))!;
    expect(detail.companyProfile?.parent?.name).toBe("Google");
    const md = jobToMarkdown(detailToMarkdownJob(detail));
    expect(md).toContain("### Mission, values and principles\n\nFour freedoms");
    expect(md).toContain("### Parent company: Google");
    expect(md).toContain("#### Mission, values and principles\n\n1. Focus on the user");
    expect(md.indexOf("### Parent company: Google")).toBeGreaterThan(md.indexOf("Four freedoms"));
  });

  it("merging moves brands to the target and inherits a missing parent", async () => {
    const group = await createCompany("Alphabet", db);
    const google = await createCompany("Google", db);
    const youtube = await createCompany("YouTube", db);
    const dup = await createCompany("Google Inc Search", db);
    await updateCompany(youtube.id, { parentId: dup.id }, db);
    await updateCompany(dup.id, { parentId: group.id }, db);
    await mergeCompanies(dup.id, google.id, db);
    expect((await getCompanyDetail(youtube.id, db))!.parentId).toBe(google.id);
    expect((await getCompanyDetail(google.id, db))!.parentId).toBe(group.id);
  });

  it("collects the posting URLs of a group's brands to find the group's own site", async () => {
    const google = await createCompany("Google", db);
    const r = await saveJob(draft(1, { company: "YouTube", sourceUrl: "https://www.google.com/about/careers/jobs/1" }), db);
    if (!r.ok) throw new Error("save failed");
    const yt = (await findCompanyByName("YouTube", db))!;
    expect(await companyJobUrls(google.id, db)).toEqual([]);
    await updateCompany(yt.id, { parentId: google.id }, db);
    expect(await companyJobUrls(google.id, db)).toEqual(["https://www.google.com/about/careers/jobs/1"]);
  });
});

describe("TavilyProvider", () => {
  it("posts the query with a bearer key and maps results", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const p = new TavilyProvider("tvly-key", async (url, init) => {
      seen = { url, init };
      return new Response(JSON.stringify({ results: [{ title: "T", url: "https://a.com", content: "c" }, { title: "no url" }] }));
    });
    expect(await p.search("google mission", { maxResults: 3 })).toEqual([{ title: "T", url: "https://a.com", content: "c" }]);
    expect(seen!.url).toBe("https://api.tavily.com/search");
    expect((seen!.init.headers as Record<string, string>).authorization).toBe("Bearer tvly-key");
    expect(JSON.parse(seen!.init.body as string)).toMatchObject({ query: "google mission", max_results: 3 });
  });

  it("explains auth and rate-limit failures", async () => {
    const status = (n: number) => new TavilyProvider("k", async () => new Response("", { status: n })).search("q");
    await expect(status(401)).rejects.toThrow(/API key/);
    await expect(status(429)).rejects.toThrow(/rate limit/);
    await expect(status(500)).rejects.toThrow(/HTTP 500/);
  });
});
