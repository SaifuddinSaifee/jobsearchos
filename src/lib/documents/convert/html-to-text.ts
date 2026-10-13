import { JSDOM } from "jsdom";

/**
 * The HTML that mammoth makes from a DOCX, as the plain text `textToDoc` reads, keeping what the raw text loses:
 * list items become "- " lines, and lines in a real heading style are reported so they are treated as headings.
 * Tables are read row by row, cell by cell, which suits the two-column layouts many resumes use.
 */
export function htmlToResumeText(html: string): { text: string; headings: Set<string> } {
  const dom = new JSDOM(`<body>${html}</body>`);
  const lines: string[] = [];
  const headings = new Set<string>();
  const squash = (s: string | null) => (s ?? "").replace(/\s+/g, " ").trim();

  /** The text of a list item, not counting lists nested inside it. */
  const ownText = (li: Element) => {
    const clone = li.cloneNode(true) as Element;
    clone.querySelectorAll("ul, ol").forEach((n) => n.remove());
    return squash(clone.textContent);
  };

  const list = (el: Element) => {
    for (const li of Array.from(el.children)) {
      if (li.tagName.toLowerCase() !== "li") continue;
      const t = ownText(li);
      if (t) lines.push(`- ${t}`);
      for (const nested of Array.from(li.children)) if (/^(ul|ol)$/i.test(nested.tagName)) list(nested);
    }
  };

  const walk = (el: Element) => {
    for (const child of Array.from(el.children)) {
      const tag = child.tagName.toLowerCase();
      if (/^h[1-6]$/.test(tag)) {
        const t = squash(child.textContent);
        if (t) {
          headings.add(t);
          lines.push("", t);
        }
      } else if (tag === "ul" || tag === "ol") {
        list(child);
      } else if (tag === "p") {
        const t = squash(child.textContent);
        lines.push(t); // an empty paragraph is a blank line, which separates blocks
      } else if (tag === "table") {
        for (const row of Array.from(child.querySelectorAll("tr"))) for (const cell of Array.from(row.children)) walk(cell);
      } else {
        walk(child);
      }
    }
    // Text directly inside a cell or div (no paragraph around it).
    if (el.children.length === 0 && /^(td|th|div|li)$/i.test(el.tagName)) {
      const t = squash(el.textContent);
      if (t) lines.push(t);
    }
  };

  walk(dom.window.document.body);
  return { text: lines.join("\n"), headings };
}
