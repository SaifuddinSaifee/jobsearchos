import type { DocJSON } from "../build";
import { children, isTextBlock, plainText, textOf } from "../read";

/**
 * Plain text of a whole document, one line per field and per bullet. Used for full-text search, the index, prompts
 * and to tell whether a document changed. Nested bullets are indented by two spaces per level.
 */
export function docToText(doc: DocJSON): string {
  const lines: string[] = [];

  const bullets = (list: DocJSON | undefined, depth: number) => {
    for (const b of children(list)) {
      const p = children(b).find((c) => c.type === "paragraph");
      lines.push(`${"  ".repeat(depth)}- ${plainText(p).trim()}`);
      bullets(children(b).find((c) => c.type === "bulletList"), depth + 1);
    }
  };

  const block = (n: DocJSON) => {
    switch (n.type) {
      case "header":
        for (const c of children(n)) {
          const t = plainText(c).trim();
          if (t) lines.push(t);
        }
        break;
      case "section":
        lines.push("", textOf(n, "sectionTitle"));
        for (const c of children(n)) if (c.type !== "sectionTitle") block(c);
        break;
      case "role":
      case "project":
      case "education":
        for (const c of children(n)) {
          if (c.type === "bulletList") bullets(c, 1);
          else {
            const t = plainText(c).trim();
            if (t) lines.push(t);
          }
        }
        break;
      case "skillsLine":
        lines.push(`${textOf(n, "skillsLabel")}: ${textOf(n, "skillsItems")}`);
        break;
      case "bulletList":
        bullets(n, 0);
        break;
      case "divider":
        break;
      default:
        if (isTextBlock(n)) {
          const t = plainText(n).trim();
          // An empty paragraph is a blank line between paragraphs; an empty field is nothing.
          if (t || n.type === "paragraph") lines.push(t);
        }
    }
  };

  for (const n of children(doc)) block(n);
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
