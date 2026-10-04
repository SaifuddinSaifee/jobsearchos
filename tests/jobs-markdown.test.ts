import { describe, expect, it } from "vitest";
import { jobToMarkdown, markdownFilename, type MarkdownJob } from "@/lib/jobs/markdown";

const job: MarkdownJob = {
  title: "Backend Engineer",
  company: "Acme Inc.",
  location: "Austin, TX",
  remoteType: "hybrid",
  employmentType: "Full-time",
  salaryMin: 150000,
  salaryMax: 180000,
  salaryCurrency: "USD",
  salaryPeriod: "year",
  postedAt: "2026-05-01",
  source: "greenhouse",
  postingUrl: "https://boards.greenhouse.io/acme/jobs/1",
  applyUrl: "https://boards.greenhouse.io/acme/jobs/1/apply",
  responsibilities: ["Build APIs", "Own\non-call"],
  requirements: { required: ["3y Go", "SQL"], preferred: ["Kafka"] },
  technologies: ["Go", "Postgres"],
  keywords: ["distributed systems", "backend"],
  aboutCompany: "",
  companyProfile: null,
  rawText: "About the role\n- Build things\n# not a heading",
};

describe("jobToMarkdown", () => {
  it("includes every extracted field", () => {
    const md = jobToMarkdown(job);
    expect(md).toContain("# Backend Engineer at Acme Inc.");
    for (const line of [
      "- **Company:** Acme Inc.",
      "- **Location:** Austin, TX",
      "- **Work type:** Hybrid",
      "- **Employment type:** Full-time",
      "- **Salary:** $150,000–$180,000 per year",
      "- **Posted:** 2026-05-01",
      "- **Source:** Greenhouse",
      "- **Job posting:** https://boards.greenhouse.io/acme/jobs/1",
      "- **Application page:** https://boards.greenhouse.io/acme/jobs/1/apply",
      "## Responsibilities",
      "- Build APIs",
      "- Own on-call",
      "### Required",
      "- 3y Go",
      "### Preferred",
      "- Kafka",
      "## Technologies\n\nGo, Postgres",
      "## Keywords\n\ndistributed systems, backend",
      "## Full job posting text",
    ]) {
      expect(md).toContain(line);
    }
  });

  it("keeps the posting text verbatim inside a fence so it cannot add headings", () => {
    const md = jobToMarkdown(job);
    expect(md).toContain("```text\nAbout the role\n- Build things\n# not a heading\n```");
  });

  it("uses a longer fence when the posting itself contains backticks", () => {
    const md = jobToMarkdown({ ...job, rawText: "Use ```code``` blocks" });
    expect(md).toContain("````text\nUse ```code``` blocks\n````");
  });

  it("omits empty sections and unknown facts", () => {
    const md = jobToMarkdown({
      ...job,
      remoteType: "unknown",
      employmentType: null,
      salaryMin: null,
      salaryMax: null,
      postedAt: "",
      source: null,
      applyUrl: job.postingUrl,
      responsibilities: [],
      requirements: { required: [], preferred: [] },
      technologies: [],
      keywords: [],
      aboutCompany: "",
      companyProfile: null,
      rawText: "",
    });
    expect(md).not.toMatch(/Work type|Employment type|Salary|Posted|Source|Application page/);
    expect(md).not.toMatch(/## (Responsibilities|Requirements|Technologies|Keywords|Full job posting text)/);
    expect(md).toContain("- **Job posting:**");
  });

  it("formats single-sided and hourly pay", () => {
    expect(jobToMarkdown({ ...job, salaryMin: null, salaryMax: 90000, salaryPeriod: "" })).toContain("- **Salary:** $90,000\n");
    expect(jobToMarkdown({ ...job, salaryMin: 50, salaryMax: 70, salaryCurrency: "EUR", salaryPeriod: "hour" })).toContain("€50–€70 per hour");
  });

  it("ends with one newline", () => {
    expect(jobToMarkdown(job).endsWith("```\n")).toBe(true);
  });
});

describe("markdownFilename", () => {
  it("slugs company and title", () => {
    expect(markdownFilename({ company: "Acme, Inc.", title: "Sr. Backend Engineer (Remote)" })).toBe("acme-inc-sr-backend-engineer-remote.md");
    expect(markdownFilename({ company: "Zürich AG", title: "Ingénieur" })).toBe("zurich-ag-ingenieur.md");
    expect(markdownFilename({ company: "", title: "" })).toBe("job.md");
  });
});
