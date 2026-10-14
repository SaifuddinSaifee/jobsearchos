import { chunkProfile, chunkText, type ResumeChunk } from "@/lib/resume/chunk";
import type { DocJSON } from "../build";
import { children, headerOf, sectionsOf, textOf } from "../read";
import { docToProfile } from "./doc-to-profile";
import { docToText } from "./doc-to-text";

/** Item types a section of this kind is built from. Anything else in it is free text the profile cannot hold. */
const STRUCTURED: Record<string, string[]> = {
  summary: ["paragraph"],
  experience: ["role"],
  projects: ["project"],
  skills: ["skillsLine"],
  education: ["education"],
  certifications: ["bulletList"],
  achievements: ["bulletList"],
};

const wrap = (nodes: DocJSON[]): DocJSON => ({ type: "doc", content: nodes });

/**
 * Pieces of a document for the search index. Structured parts go through `chunkProfile`, so a role stays together
 * with its bullets. Anything that is not structured (custom sections, a resume that was only split into headings and
 * bullets, loose paragraphs, cover letters) is split by paragraph.
 */
export function chunkDocument(doc: DocJSON): ResumeChunk[] {
  if (!headerOf(doc) && sectionsOf(doc).length === 0) return chunkText(docToText(doc));

  const out: ResumeChunk[] = chunkProfile(docToProfile(doc));

  const loose = (label: string, section: string, nodes: DocJSON[]) => {
    const body = docToText(wrap(nodes));
    if (!body) return;
    const parts = chunkText(body);
    parts.forEach((c, i) => out.push({ ...c, section, label: parts.length > 1 ? `${label} (part ${i + 1})` : label }));
  };

  const topLevel = children(doc).filter((c) => c.type !== "header" && c.type !== "section");
  if (topLevel.length > 0) loose("Other", "text", topLevel);

  for (const s of sectionsOf(doc)) {
    const kind = String(s.attrs?.kind ?? "custom");
    const title = textOf(s, "sectionTitle") || kind;
    const known = STRUCTURED[kind];
    const items = children(s).filter((c) => c.type !== "sectionTitle");
    const unstructured = known ? items.filter((c) => !known.includes(c.type ?? "")) : items;
    if (unstructured.length > 0) loose(title, known ? kind : "custom", unstructured);
  }
  return out;
}
