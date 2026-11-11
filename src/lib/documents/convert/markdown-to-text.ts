/**
 * A Markdown resume as the plain text `textToDoc` reads, the way `htmlToResumeText` does for a DOCX: "#" lines become
 * headings (reported so they are treated as headings, except a "#" title on the first line, which is the name), list items become "- " lines, and inline marks (bold, italic,
 * code, links, images) are reduced to their text.
 */
export function markdownToResumeText(markdown: string): { text: string; headings: Set<string> } {
  const lines: string[] = [];
  const headings = new Set<string>();
  let fence = false;

  for (const raw of markdown.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split("\n")) {
    if (/^\s*(```|~~~)/.test(raw)) {
      fence = !fence;
      continue;
    }
    if (fence) {
      lines.push(raw.trim());
      continue;
    }

    const line = raw.trim();
    if (!line) {
      lines.push("");
      continue;
    }
    // Horizontal rules and table separator rows carry no text.
    if (/^([-*_])(\s*\1){2,}$/.test(line) || /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/.test(line)) continue;

    const heading = line.match(/^(#{1,6})\s+(.*?)\s*#*$/);
    if (heading) {
      const t = inlineText(heading[2]);
      // A top-level title on the first line is the person's name, not a section.
      if (t && heading[1].length === 1 && !lines.some(Boolean)) lines.push(t);
      else if (t) {
        headings.add(t);
        lines.push("", t);
      }
      continue;
    }

    const item = raw.match(/^\s*(?:[-*+]|\d+[.)])\s+(.*)$/);
    if (item) {
      const t = inlineText(item[1].replace(/^\[[ xX]\]\s+/, ""));
      if (t) lines.push(`- ${t}`);
      continue;
    }

    const t = inlineText(line.replace(/^>\s?/, ""));
    if (t) lines.push(t);
  }
  return { text: lines.join("\n"), headings };
}

/** Inline Markdown reduced to its text: links keep their label, emphasis and code marks are dropped. */
function inlineText(s: string): string {
  return s
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<((?:https?:\/\/|mailto:)[^>]+)>/g, (_, u: string) => u.replace(/^mailto:/, ""))
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|[\s(])([*_])(\S(?:.*?\S)?)\2(?=$|[\s).,;:!?])/g, "$1$3")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\\([\\`*_{}[\]()#+\-.!|>~])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}
