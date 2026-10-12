import { describe, expect, it } from "vitest";
import { parseAshby } from "@/lib/jobs/fetch/ats/ashby";
import { parseGreenhouse } from "@/lib/jobs/fetch/ats/greenhouse";
import { parseLever } from "@/lib/jobs/fetch/ats/lever";
import { parseSmartRecruiters } from "@/lib/jobs/fetch/ats/smartrecruiters";
import { parseWorkable } from "@/lib/jobs/fetch/ats/workable";
import { parseWorkday } from "@/lib/jobs/fetch/ats/workday";
import { fetchJob } from "@/lib/jobs/fetch";
import { postingFromHtml } from "@/lib/jobs/fetch/html";
import { extractJsonLd } from "@/lib/jobs/fetch/jsonld";
import { htmlToText, readableText } from "@/lib/jobs/fetch/text";
import { FetchError } from "@/lib/jobs/fetch/types";
import { canonicalizeUrl, detectSource } from "@/lib/jobs/fetch/url";

const LONG = "We are hiring an engineer to build and operate distributed systems. ".repeat(6);

describe("canonicalizeUrl", () => {
  it("drops tracking params, fragments and trailing slashes", () => {
    expect(canonicalizeUrl("http://Boards.Greenhouse.io/acme/jobs/1/?utm_source=x&gh_src=y#apply")).toBe(
      "https://boards.greenhouse.io/acme/jobs/1",
    );
  });
  it("keeps meaningful params, sorted", () => {
    expect(canonicalizeUrl("https://x.com/careers?b=2&a=1&utm_medium=z")).toBe("https://x.com/careers?a=1&b=2");
  });
  it("rejects non-http URLs", () => {
    expect(() => canonicalizeUrl("ftp://x.com")).toThrow(FetchError);
    expect(() => canonicalizeUrl("nope")).toThrow(FetchError);
  });
});

describe("detectSource", () => {
  const cases: Array<[string, unknown]> = [
    ["https://boards.greenhouse.io/acme/jobs/4001", { ats: "greenhouse", board: "acme", id: "4001" }],
    ["https://job-boards.greenhouse.io/acme/jobs/4001?gh_src=a", { ats: "greenhouse", board: "acme", id: "4001" }],
    ["https://jobs.lever.co/acme/abc-123/apply", { ats: "lever", company: "acme", id: "abc-123", host: "api.lever.co" }],
    ["https://jobs.eu.lever.co/acme/abc-123", { ats: "lever", company: "acme", id: "abc-123", host: "api.eu.lever.co" }],
    ["https://jobs.ashbyhq.com/acme/9f8e", { ats: "ashby", org: "acme", id: "9f8e" }],
    [
      "https://acme.wd5.myworkdayjobs.com/en-US/Careers/job/New-York/Software-Engineer_R100",
      { ats: "workday", host: "acme.wd5.myworkdayjobs.com", tenant: "acme", site: "Careers", path: "New-York/Software-Engineer_R100" },
    ],
    ["https://jobs.smartrecruiters.com/Acme/743999-software-engineer", { ats: "smartrecruiters", company: "Acme", id: "743999" }],
    ["https://apply.workable.com/acme/j/ABC123/", { ats: "workable", account: "acme", shortcode: "ABC123" }],
    ["https://acme.com/careers/engineer", null],
    ["https://boards.greenhouse.io/acme", null],
  ];
  it.each(cases)("%s", (url, expected) => {
    expect(detectSource(url)).toEqual(expected);
  });
});

describe("ATS adapters", () => {
  it("greenhouse: decodes escaped HTML and converts pay cents", () => {
    const json = {
      title: "Backend Engineer",
      company_name: "Acme",
      location: { name: "Remote - US" },
      first_published: "2026-05-01T10:00:00-04:00",
      absolute_url: "https://boards.greenhouse.io/acme/jobs/1",
      content: `&lt;p&gt;${LONG}&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Go&lt;/li&gt;&lt;/ul&gt;`,
      pay_input_ranges: [{ min_cents: 15000000, max_cents: 18000000, currency_type: "USD" }],
    };
    const p = parseGreenhouse(JSON.stringify(json), json, { ats: "greenhouse", board: "acme", id: "1" }, "https://x");
    expect(p.hints).toMatchObject({
      title: "Backend Engineer",
      company: "Acme",
      location: "Remote - US",
      postedAt: "2026-05-01",
      salaryMin: 150000,
      salaryMax: 180000,
      salaryCurrency: "USD",
    });
    expect(p.text).toContain("- Go");
    expect(p.text).not.toContain("<p>");
  });

  it("lever: maps workplace type, list sections and salary", () => {
    const json = {
      text: "Platform Engineer",
      categories: { location: "Berlin", commitment: "Full-time" },
      descriptionPlain: LONG,
      lists: [{ text: "Requirements", content: "<li>Kubernetes</li><li>Terraform</li>" }],
      workplaceType: "hybrid",
      createdAt: Date.UTC(2026, 4, 2),
      salaryRange: { min: 90000, max: 110000, currency: "EUR", interval: "per-year-salary" },
      applyUrl: "https://jobs.lever.co/acme/1/apply",
    };
    const p = parseLever(JSON.stringify(json), json, { ats: "lever", company: "acme", id: "1", host: "api.lever.co" }, "https://x");
    expect(p.hints).toMatchObject({ title: "Platform Engineer", remoteType: "hybrid", postedAt: "2026-05-02", salaryCurrency: "EUR", salaryPeriod: "year" });
    expect(p.text).toContain("Requirements");
    expect(p.text).toContain("Kubernetes");
  });

  it("ashby: selects the posting by id and 404s when missing", () => {
    const json = { jobs: [{ id: "a", title: "A", descriptionPlain: LONG, isRemote: true }, { id: "b", title: "B", descriptionPlain: LONG }] };
    const m = { ats: "ashby" as const, org: "acme", id: "a" };
    expect(parseAshby("", json, m, "https://x").hints).toMatchObject({ title: "A", remoteType: "remote" });
    const hybrid = { jobs: [{ id: "a", title: "A", descriptionPlain: LONG, isRemote: true, workplaceType: "Hybrid" }] };
    expect(parseAshby("", hybrid, m, "https://x").hints.remoteType).toBe("hybrid");
    expect(() => parseAshby("", json, { ...m, id: "zzz" }, "https://x")).toThrow(/no longer/);
  });

  it("workday: reads jobPostingInfo", () => {
    const json = {
      jobPostingInfo: { title: "SWE", jobDescription: `<p>${LONG}</p>`, location: "Austin, TX", timeType: "Full time", startDate: "2026-04-01", jobReqId: "R100", remoteType: "Hybrid" },
      hiringOrganization: { name: "Acme Corp" },
    };
    const p = parseWorkday("", json, { ats: "workday", host: "h", tenant: "t", site: "s", path: "NY/SWE_R100" }, "https://x");
    expect(p.hints).toMatchObject({ remoteType: "hybrid", postedAt: "2026-04-01" });
    expect(p.hints.company).toBeUndefined(); // legal-entity name is unreliable
    expect(p.atsJobId).toBe("R100");
  });

  it("smartrecruiters: joins ad sections", () => {
    const json = {
      name: "Data Engineer",
      company: { name: "Acme" },
      location: { city: "Paris", country: "fr", remote: false },
      typeOfEmployment: { label: "Full-time" },
      jobAd: { sections: { jobDescription: { title: "Job Description", text: `<p>${LONG}</p>` }, qualifications: { title: "Qualifications", text: "<p>SQL</p>" } } },
    };
    const p = parseSmartRecruiters("", json, { ats: "smartrecruiters", company: "Acme", id: "1" }, "https://x");
    expect(p.hints.location).toBe("Paris, FR");
    expect(p.text).toContain("Qualifications\nSQL");
  });

  it("workable: reads description, requirements and workplace", () => {
    const json = { title: "QA", description: `<p>${LONG}</p>`, requirements: "<p>Selenium</p>", location: { city: "Lisbon", country: "Portugal" }, workplace: "on_site", published: "2026-03-03" };
    const p = parseWorkable("", json, { ats: "workable", account: "acme", shortcode: "X" }, "https://x");
    expect(p.hints).toMatchObject({ location: "Lisbon, Portugal", remoteType: "onsite" });
    expect(p.text).toContain("Requirements\nSelenium");
  });

  it("rejects postings with no description", () => {
    expect(() => parseWorkable("", { title: "QA", description: "" }, { ats: "workable", account: "a", shortcode: "X" }, "https://x")).toThrow(/no readable/);
  });
});

describe("JSON-LD", () => {
  const page = (ld: unknown, body = "") =>
    `<html><head><script type="application/ld+json">${JSON.stringify(ld)}</script></head><body>${body}</body></html>`;
  const posting = {
    "@type": "JobPosting",
    title: "SRE",
    description: `<p>${LONG}</p>`,
    datePosted: "2026-06-01T00:00:00Z",
    employmentType: ["FULL_TIME"],
    jobLocationType: "TELECOMMUTE",
    hiringOrganization: { "@type": "Organization", name: "Acme" },
    jobLocation: { address: { addressLocality: "Denver", addressRegion: "CO", addressCountry: "US" } },
    baseSalary: { currency: "USD", value: { minValue: 140000, maxValue: 170000, unitText: "YEAR" } },
  };

  it("finds a JobPosting at top level, in arrays and in @graph", () => {
    for (const ld of [posting, [{ "@type": "WebSite" }, posting], { "@graph": [{ "@type": "Org" }, posting] }]) {
      expect(extractJsonLd(page(ld))?.hints.title).toBe("SRE");
    }
  });
  it("maps fields", () => {
    expect(extractJsonLd(page(posting))?.hints).toMatchObject({
      company: "Acme",
      location: "Denver, CO, US",
      remoteType: "remote",
      postedAt: "2026-06-01",
      salaryMin: 140000,
      salaryMax: 170000,
      salaryPeriod: "year",
    });
  });
  it("ignores malformed JSON and pages without a posting", () => {
    expect(extractJsonLd(`<script type="application/ld+json">{oops</script>`)).toBeNull();
    expect(extractJsonLd(page({ "@type": "WebSite" }))).toBeNull();
  });
  it("postingFromHtml prefers JSON-LD, falls back to page text, and signals thin pages", () => {
    expect(postingFromHtml(page(posting), "https://x", "html")?.method).toBe("jsonld");
    const article = `<html><body><main><p>${LONG.repeat(3)}</p></main></body></html>`;
    expect(postingFromHtml(article, "https://x", "html")?.method).toBe("html");
    expect(postingFromHtml("<html><body><div id=root></div></body></html>", "https://x", "html")).toBeNull();
    expect(() => postingFromHtml("<html><body>Please complete the CAPTCHA</body></html>", "https://x", "html")).toThrow(/bot check/);
  });
});

describe("text helpers", () => {
  it("htmlToText keeps bullets and paragraph breaks", () => {
    expect(htmlToText("<p>Intro</p><ul><li>One</li><li>Two &amp; three</li></ul>")).toBe("Intro\n- One\n- Two & three");
  });
  it("readableText drops scripts and styles", () => {
    const { text } = readableText(`<html><body><script>var secret=1</script><style>.a{}</style><p>Hello world</p></body></html>`);
    expect(text).toBe("Hello world");
  });
});

describe("fetchJob orchestration", () => {
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
  const gh = { title: "BE", company_name: "Acme", content: `<p>${LONG}</p>`, location: { name: "NYC" } };

  it("uses the ATS API and skips rendering", async () => {
    const steps: string[] = [];
    const posting = await fetchJob("https://boards.greenhouse.io/acme/jobs/1", {
      fetcher: async (u) => {
        expect(u).toContain("boards-api.greenhouse.io/v1/boards/acme/jobs/1");
        return json(gh);
      },
      render: async () => {
        throw new Error("should not render");
      },
      onStep: (s) => steps.push(`${s.step}:${s.status}`),
    });
    expect(posting.method).toBe("greenhouse");
    expect(steps).toContain("render:skipped");
  });

  it("falls back to the page when the ATS API 404s", async () => {
    const html = `<html><body><main><p>${LONG.repeat(3)}</p></main></body></html>`;
    const posting = await fetchJob("https://boards.greenhouse.io/acme/jobs/1", {
      fetcher: async (u) => (u.includes("boards-api") ? new Response("", { status: 404 }) : new Response(html)),
    });
    expect(posting.method).toBe("html");
  });

  it("renders with the browser when the page is an empty SPA shell", async () => {
    const posting = await fetchJob("https://acme.com/careers/1", {
      fetcher: async () => new Response("<html><body><div id=root></div></body></html>"),
      render: async () => `<html><body><main><p>${LONG.repeat(3)}</p></main></body></html>`,
    });
    expect(posting.method).toBe("playwright");
  });

  it("refuses LinkedIn and Indeed without fetching", async () => {
    await expect(fetchJob("https://www.linkedin.com/jobs/view/1", { fetcher: async () => { throw new Error("no"); } })).rejects.toMatchObject({ code: "blocked" });
  });

  it("maps 403 to a blocked error", async () => {
    await expect(fetchJob("https://acme.com/careers/1", { fetcher: async () => new Response("", { status: 403 }) })).rejects.toMatchObject({ code: "blocked" });
  });
});
