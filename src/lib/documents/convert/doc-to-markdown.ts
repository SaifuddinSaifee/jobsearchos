import type { DocJSON } from "../build";
import { children, textOf } from "../read";

/** Characters that would turn into Markdown formatting if left as they are. */
const escape = (s: string) => s.replace(/([\\*[\]`])/g, "\\$1").replace(/(^|\s)_|_(\s|$)/g, (m) => m.replace("_", "\\_"));

/** One text block with its bold, italic and link formatting. Underline has no Markdown form and is dropped. */
export function inlineToMarkdown(block: DocJSON | undefined): string {
  if (!block) return "";
  let out = "";
  for (const n of children(block)) {
    if (n.type !== "text" || !n.text) continue;
    let t = escape(n.text);
    const marks = n.marks ?? [];
    if (marks.some((m) => m.type === "bold")) t = `**${t}**`;
    if (marks.some((m) => m.type === "italic")) t = `*${t}*`;
    const link = marks.find((m) => m.type === "link");
    if (link && typeof link.attrs?.href === "string") t = `[${t}](${link.attrs.href})`;
    out += t;
  }
  return out.trim();
}

const field = (n: DocJSON, type: string) => inlineToMarkdown(children(n).find((c) => c.type === type));
const join = (parts: string[], sep: string) => parts.filter(Boolean).join(sep);

/** A document as Markdown, for reading, copying into other tools and prompts. */
export function docToMarkdown(doc: DocJSON): string {
  const out: string[] = [];

  const bullets = (list: DocJSON | undefined, depth: number) => {
    for (const b of children(list)) {
      const p = children(b).find((c) => c.type === "paragraph");
      out.push(`${"  ".repeat(depth)}- ${inlineToMarkdown(p)}`);
      bullets(children(b).find((c) => c.type === "bulletList"), depth + 1);
    }
  };

  const block = (n: DocJSON) => {
    switch (n.type) {
      case "header": {
        const name = field(n, "headerName");
        const headline = field(n, "headerHeadline");
        const contact = field(n, "headerContact");
        if (name) out.push(`# ${name}`);
        if (headline) out.push("", headline);
        if (contact) out.push("", contact);
        out.push("");
        break;
      }
      case "section":
        out.push(`## ${textOf(n, "sectionTitle")}`, "");
        for (const c of children(n)) if (c.type !== "sectionTitle") block(c);
        break;
      case "role": {
        out.push(`### ${join([field(n, "roleTitle"), field(n, "roleCompany"), field(n, "roleLocation")], ", ")}`);
        const dates = field(n, "roleDates");
        if (dates) out.push("", `*${dates}*`);
        out.push("");
        bullets(children(n).find((c) => c.type === "bulletList"), 0);
        out.push("");
        break;
      }
      case "project": {
        out.push(`### ${join([field(n, "projectName"), field(n, "projectDetail")], " - ")}`, "");
        if (field(n, "projectTech")) out.push(field(n, "projectTech"), "");
        bullets(children(n).find((c) => c.type === "bulletList"), 0);
        out.push("");
        break;
      }
      case "education": {
        out.push(`### ${join([field(n, "eduDegree"), field(n, "eduInstitution")], ", ")}`);
        if (field(n, "eduDates")) out.push("", `*${field(n, "eduDates")}*`);
        if (field(n, "eduDetails")) out.push("", field(n, "eduDetails"));
        out.push("");
        bullets(children(n).find((c) => c.type === "bulletList"), 0);
        break;
      }
      case "skillsLine":
        out.push(`**${field(n, "skillsLabel")}:** ${field(n, "skillsItems")}`, "");
        break;
      case "bulletList":
        bullets(n, 0);
        out.push("");
        break;
      case "divider":
        out.push("---", "");
        break;
      case "paragraph":
        out.push(inlineToMarkdown(n), "");
        break;
    }
  };

  for (const n of children(doc)) block(n);
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
