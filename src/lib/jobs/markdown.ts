import { companySection, type CompanyMarkdownInput } from "@/lib/companies/markdown";
import { sourceLabel } from "./links";
import type { JobDraft } from "./schema";
import type { JobDetail } from "./types";

/** Everything the extraction produced, in one shape shared by the saved-job panel and the review form. */
export type MarkdownJob = {
  title: string;
  company: string;
  location: string;
  remoteType: string;
  employmentType: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  salaryPeriod: string | null;
  postedAt: string | null;
  source: string | null;
  postingUrl: string | null;
  applyUrl: string | null;
  responsibilities: string[];
  requirements: { required: string[]; preferred: string[] };
  technologies: string[];
  keywords: string[];
  /** What the posting says about the employer, and the shared directory profile (either may be empty). */
  aboutCompany: string;
  companyProfile: CompanyMarkdownInput | null;
  /** The posting text the model read, verbatim. */
  rawText: string;
};

const REMOTE: Record<string, string> = { remote: "Remote", hybrid: "Hybrid", onsite: "On-site" };
const SYMBOL: Record<string, string> = { USD: "$", EUR: "€", GBP: "£", INR: "₹", CAD: "C$", AUD: "A$" };
const PER: Record<string, string> = { year: "per year", month: "per month", hour: "per hour" };

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

/** Exact figures (not the table's compact `$150k`), since this goes to a person or model to read. */
function salaryText(j: MarkdownJob): string {
  const lo = j.salaryMin ?? j.salaryMax;
  const hi = j.salaryMax ?? j.salaryMin;
  if (lo == null || hi == null) return "";
  const cur = j.salaryCurrency ? (SYMBOL[j.salaryCurrency.toUpperCase()] ?? `${j.salaryCurrency.toUpperCase()} `) : "";
  const n = (v: number) => `${cur}${v.toLocaleString("en-US")}`;
  const range = lo === hi ? n(lo) : `${n(lo)}–${n(hi)}`;
  const per = j.salaryPeriod ? PER[j.salaryPeriod] : undefined;
  return per ? `${range} ${per}` : range;
}

function bullets(items: string[]): string {
  return items.map(oneLine).filter(Boolean).map((i) => `- ${i}`).join("\n");
}

/** A code fence longer than any backtick run inside the text, so the posting can never break out of it. */
function fenced(text: string): string {
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  const fence = "`".repeat(longest + 1);
  return `${fence}text\n${text.trim()}\n${fence}`;
}

export function jobToMarkdown(j: MarkdownJob): string {
  const facts: [string, string][] = [
    ["Company", j.company],
    ["Title", j.title],
    ["Location", j.location],
    ["Work type", REMOTE[j.remoteType] ?? ""],
    ["Employment type", j.employmentType ?? ""],
    ["Salary", salaryText(j)],
    ["Posted", j.postedAt ?? ""],
    ["Source", j.source ? sourceLabel(j.source) : ""],
    ["Job posting", j.postingUrl ?? ""],
    ["Application page", j.applyUrl && j.applyUrl !== j.postingUrl ? j.applyUrl : ""],
  ];

  const out: string[] = [`# ${oneLine(j.title) || "Job"}${j.company ? ` at ${oneLine(j.company)}` : ""}`];
  out.push(facts.filter(([, v]) => v.trim()).map(([k, v]) => `- **${k}:** ${oneLine(v)}`).join("\n"));

  const section = (heading: string, body: string) => body && out.push(`${heading}\n\n${body}`);
  section("## Responsibilities", bullets(j.responsibilities));
  const req = [
    j.requirements.required.length ? `### Required\n\n${bullets(j.requirements.required)}` : "",
    j.requirements.preferred.length ? `### Preferred\n\n${bullets(j.requirements.preferred)}` : "",
  ].filter(Boolean);
  if (req.length) out.push(`## Requirements\n\n${req.join("\n\n")}`);
  section("## Technologies", j.technologies.map(oneLine).filter(Boolean).join(", "));
  section("## Keywords", j.keywords.map(oneLine).filter(Boolean).join(", "));
  out.push(companySection(j.companyProfile, j.aboutCompany, 2));
  if (j.rawText.trim()) out.push(`## Full job posting text\n\n${fenced(j.rawText)}`);

  return out.filter(Boolean).join("\n\n") + "\n";
}

export function markdownFilename(j: Pick<MarkdownJob, "company" | "title">): string {
  const slug = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40);
  const name = [slug(j.company), slug(j.title)].filter(Boolean).join("-");
  return `${name || "job"}.md`;
}

export function detailToMarkdownJob(d: JobDetail): MarkdownJob {
  return {
    title: d.title,
    company: d.company,
    location: d.location,
    remoteType: d.remoteType,
    employmentType: d.employmentType,
    salaryMin: d.salaryMin,
    salaryMax: d.salaryMax,
    salaryCurrency: d.salaryCurrency,
    salaryPeriod: d.salaryPeriod,
    postedAt: d.postedAt,
    source: d.source,
    postingUrl: d.postingUrl,
    applyUrl: d.applyUrl,
    responsibilities: d.responsibilities,
    requirements: d.requirements,
    technologies: d.technologies,
    keywords: d.keywords,
    aboutCompany: d.aboutCompany,
    companyProfile: d.companyProfile,
    rawText: d.snapshot?.rawText ?? "",
  };
}

/** The review form's current (possibly edited) values, before the job is saved. */
export function draftToMarkdownJob(d: JobDraft): MarkdownJob {
  return {
    title: d.title,
    company: d.company,
    location: d.location,
    remoteType: d.remoteType,
    employmentType: d.employmentType,
    salaryMin: d.salaryMin,
    salaryMax: d.salaryMax,
    salaryCurrency: d.salaryCurrency,
    salaryPeriod: d.salaryPeriod,
    postedAt: d.postedAt,
    source: d.ats ?? d.fetchMethod,
    postingUrl: d.sourceUrl || null,
    applyUrl: d.applicationUrl || null,
    responsibilities: d.responsibilities,
    requirements: d.requirements,
    technologies: d.technologies,
    keywords: d.keywords,
    aboutCompany: d.aboutCompany,
    // The review form shows the employer text from the posting; the directory profile is added once saved.
    companyProfile: null,
    rawText: d.rawText,
  };
}
