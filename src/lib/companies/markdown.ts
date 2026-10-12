import type { CompanyProfileBase } from "./types";

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

type Profile = Pick<CompanyProfileBase, "name" | "website" | "about" | "principles" | "culture" | "notes" | "sources">;
export type CompanyMarkdownInput = Profile & { parent?: Profile | null };

/** The profile's own subsections, with headings `depth` hashes deep. */
function blocks(c: Profile, depth: number, withSources: boolean, withNotes: boolean): string[] {
  const h = "#".repeat(depth);
  const parts: string[] = [];
  if (c.website) parts.push(`- **Website:** ${oneLine(c.website)}`);
  const sub = (heading: string, text: string) => text.trim() && parts.push(`${h} ${heading}\n\n${text.trim()}`);
  sub("What they do", c.about);
  sub("Mission, values and principles", c.principles);
  sub("Culture and ways of working", c.culture);
  if (withNotes) sub("My notes about the company", c.notes);
  if (withSources && c.sources.length) {
    parts.push(`${h} Sources\n\n${c.sources.map((s) => `- [${oneLine(s.title)}](${s.url})`).join("\n")}`);
  }
  return parts;
}

/**
 * Markdown for a company profile. `level` is the heading depth of the section title (2 inside a job export,
 * 1 for a standalone company export); subsections are one level deeper. `fromPosting` is the job's own
 * description of the employer, shown when it adds something beyond the saved profile. When the company is
 * part of a group, the parent's profile follows under its own heading.
 */
export function companySection(c: CompanyMarkdownInput | null, fromPosting: string, level: 1 | 2, title?: string): string {
  const parts: string[] = c ? blocks({ ...c, notes: "" }, level + 1, false, false) : [];
  const posting = fromPosting.trim();
  if (posting && posting !== c?.about.trim()) parts.push(`${"#".repeat(level + 1)} As described in this job posting\n\n${posting}`);
  if (c) parts.push(...blocks({ name: "", website: "", about: "", principles: "", culture: "", notes: c.notes, sources: [] }, level + 1, false, true));
  if (c?.sources.length) {
    parts.push(`${"#".repeat(level + 1)} Sources\n\n${c.sources.map((s) => `- [${oneLine(s.title)}](${s.url})`).join("\n")}`);
  }
  if (c?.parent) {
    const parent = blocks(c.parent, level + 2, true, true);
    if (parent.length) parts.push(`${"#".repeat(level + 1)} Parent company: ${oneLine(c.parent.name)}\n\n${parent.join("\n\n")}`);
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
