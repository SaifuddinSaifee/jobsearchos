import type { DocJSON } from "./build";

// Read-side helpers over editor JSON.

export const children = (n: DocJSON | undefined): DocJSON[] => n?.content ?? [];

/** Plain text of a node and everything inside it. Text blocks are joined with `sep`. */
export function plainText(n: DocJSON | undefined, sep = " "): string {
  if (!n) return "";
  if (n.type === "text") return n.text ?? "";
  return children(n).map((c) => plainText(c, sep)).filter(Boolean).join(isTextBlock(n) ? "" : sep);
}

const TEXT_BLOCKS = new Set([
  "paragraph",
  "headerName",
  "headerHeadline",
  "headerContact",
  "sectionTitle",
  "roleTitle",
  "roleDates",
  "roleCompany",
  "roleLocation",
  "projectName",
  "projectDetail",
  "projectTech",
  "eduInstitution",
  "eduDates",
  "eduDegree",
  "eduDetails",
  "skillsLabel",
  "skillsItems",
]);

export const isTextBlock = (n: DocJSON) => TEXT_BLOCKS.has(n.type ?? "");

export const firstOf = (n: DocJSON, type: string) => children(n).find((c) => c.type === type);
export const textOf = (n: DocJSON, type: string) => plainText(firstOf(n, type)).trim();

/** The bullet texts of a bullet list, flattened (nested bullets follow their parent). */
export function bulletTexts(list: DocJSON | undefined): string[] {
  const out: string[] = [];
  const walk = (l: DocJSON | undefined) => {
    for (const b of children(l)) {
      const p = children(b).find((c) => c.type === "paragraph");
      const t = plainText(p).trim();
      if (t) out.push(t);
      walk(children(b).find((c) => c.type === "bulletList"));
    }
  };
  walk(list);
  return out;
}

export const headerOf = (doc: DocJSON) => children(doc).find((c) => c.type === "header");
export const sectionsOf = (doc: DocJSON) => children(doc).filter((c) => c.type === "section");

const STRUCTURED_BLOCKS = new Set(["role", "project", "education", "skillsLine"]);

/** Whether a document has real resume entries (roles, projects...) and not just headings, bullets and paragraphs. */
export function hasStructure(doc: DocJSON): boolean {
  const walk = (n: DocJSON): boolean => STRUCTURED_BLOCKS.has(n.type ?? "") || (n.content ?? []).some(walk);
  return walk(doc);
}
