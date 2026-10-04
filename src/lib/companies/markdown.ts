import type { CompanyProfile } from "./types";

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

export type CompanyMarkdownInput = Pick<CompanyProfile, "name" | "website" | "about" | "principles" | "culture" | "notes" | "sources">;

/**
 * Markdown for a company profile. `level` is the heading depth of the section title (2 inside a job export,
 * 1 for a standalone company export); subsections are one level deeper. `fromPosting` is the job's own
 * description of the employer, shown when it adds something beyond the saved profile.
 */
export function companySection(c: CompanyMarkdownInput | null, fromPosting: string, level: 1 | 2, title?: string): string {
  const h = (n: number) => "#".repeat(level + n);
  const parts: string[] = [];
  if (c?.website) parts.push(`- **Website:** ${oneLine(c.website)}`);
  const sub = (heading: string, text: string) => text.trim() && parts.push(`${h(1)} ${heading}\n\n${text.trim()}`);
  if (c) {
    sub("What they do", c.about);
    sub("Mission, values and principles", c.principles);
    sub("Culture and ways of working", c.culture);
  }
  const posting = fromPosting.trim();
  if (posting && posting !== c?.about.trim()) sub("As described in this job posting", posting);
  if (c) sub("My notes about the company", c.notes);
  if (c?.sources.length) {
    parts.push(`${h(1)} Sources\n\n${c.sources.map((s) => `- [${oneLine(s.title)}](${s.url})`).join("\n")}`);
  }
  if (parts.length === 0) return "";
  return `${"#".repeat(level)} ${title ?? "About the company"}\n\n${parts.join("\n\n")}`;
}

/** A standalone export of one company, e.g. to paste into a chat with the user's other material. */
export function companyToMarkdown(c: CompanyMarkdownInput): string {
  const body = companySection(c, "", 1, oneLine(c.name) || "Company");
  return (body || `# ${oneLine(c.name) || "Company"}\n\nNo profile written yet.`) + "\n";
}

export function companyFilename(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${slug || "company"}-profile.md`;
}
