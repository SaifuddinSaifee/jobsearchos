import { safeHref } from "@/lib/documents/build";

// The email body as the composer edits it: one paragraph per line (an empty paragraph is a blank line, the way Gmail
// writes mail), with bold, italic, underline and links. From it come the plain text (what the checks read and what
// a plain-text mail client shows) and the HTML that carries the formatting. Pure, so the composer and the server agree.

export type EmailMark = { type: "bold" } | { type: "italic" } | { type: "underline" } | { type: "link"; attrs: { href: string } };
export type EmailText = { type: "text"; text: string; marks?: EmailMark[] };
export type EmailLine = { type: "paragraph"; content?: EmailText[] };
export type EmailDoc = { type: "doc"; content: EmailLine[] };

const STYLE_MARKS = ["bold", "italic", "underline"] as const;
const MAX_LINES = 5000;

const URL_IN_TEXT = /\bhttps?:\/\/[^\s<>"]+[^\s<>".,;:!?)\]'"]/gi;

/** One line of plain text, with web addresses in it made into links. */
function lineOf(text: string): EmailLine {
  const content: EmailText[] = [];
  let at = 0;
  for (const m of text.matchAll(URL_IN_TEXT)) {
    const href = safeHref(m[0]);
    if (!href) continue;
    if (m.index > at) content.push({ type: "text", text: text.slice(at, m.index) });
    content.push({ type: "text", text: m[0], marks: [{ type: "link", attrs: { href } }] });
    at = m.index + m[0].length;
  }
  if (at < text.length) content.push({ type: "text", text: text.slice(at) });
  return content.length > 0 ? { type: "paragraph", content } : { type: "paragraph" };
}

/** Plain text (an older draft, a paste) as an email document: one line per paragraph, web addresses linked. */
export function textToEmailDoc(text: string): EmailDoc {
  return { type: "doc", content: text.replace(/\r\n?/g, "\n").split("\n").slice(0, MAX_LINES).map(lineOf) };
}

function cleanMarks(raw: unknown): EmailMark[] {
  if (!Array.isArray(raw)) return [];
  const out: EmailMark[] = [];
  for (const m of raw as { type?: unknown; attrs?: { href?: unknown } }[]) {
    if (STYLE_MARKS.includes(m?.type as (typeof STYLE_MARKS)[number]) && !out.some((x) => x.type === m.type)) out.push({ type: m.type as (typeof STYLE_MARKS)[number] });
    if (m?.type === "link" && typeof m.attrs?.href === "string" && !out.some((x) => x.type === "link")) {
      const href = safeHref(m.attrs.href);
      if (href) out.push({ type: "link", attrs: { href } });
    }
  }
  // A fixed order, so the same formatting always compares and renders the same.
  return out.sort((a, b) => ORDER.indexOf(a.type) - ORDER.indexOf(b.type));
}
const ORDER = ["link", "bold", "italic", "underline"];

/**
 * Whatever the editor (or a request) sent, reduced to what an email can hold: lines of text with the four marks. Unknown
 * nodes keep their text, links that are not web or email addresses lose the link, and empty text is dropped.
 */
export function normalizeEmailDoc(raw: unknown): EmailDoc {
  const blocks = (raw as { type?: unknown; content?: unknown })?.type === "doc" && Array.isArray((raw as { content?: unknown }).content) ? ((raw as { content: unknown[] }).content) : [];
  const lines: EmailLine[] = [];
  for (const block of blocks.slice(0, MAX_LINES)) {
    const content: EmailText[] = [];
    const walk = (node: unknown) => {
      const n = node as { type?: unknown; text?: unknown; marks?: unknown; content?: unknown };
      if (n?.type === "text" && typeof n.text === "string") {
        const text = n.text.replace(/[\r\n]+/g, " ");
        if (!text) return;
        const marks = cleanMarks(n.marks);
        const prev = content[content.length - 1];
        if (prev && JSON.stringify(prev.marks ?? []) === JSON.stringify(marks)) prev.text += text;
        else content.push({ type: "text", text, ...(marks.length > 0 ? { marks } : {}) });
      } else if (Array.isArray(n?.content)) n.content.forEach(walk);
    };
    walk(block);
    lines.push(content.length > 0 ? { type: "paragraph", content } : { type: "paragraph" });
  }
  return { type: "doc", content: lines.length > 0 ? lines : [{ type: "paragraph" }] };
}

const lineText = (l: EmailLine) => (l.content ?? []).map((t) => t.text).join("");

/** Without the blank lines at the start and end, the way the email is sent. */
export function trimEmailDoc(doc: EmailDoc): EmailDoc {
  const lines = [...doc.content];
  while (lines.length > 0 && !lineText(lines[0]).trim()) lines.shift();
  while (lines.length > 0 && !lineText(lines[lines.length - 1]).trim()) lines.pop();
  return { type: "doc", content: lines };
}

/** True when anything in the email is bold, italic, underlined or a link, so it needs an HTML version to show it. */
export function hasFormatting(doc: EmailDoc): boolean {
  return doc.content.some((l) => (l.content ?? []).some((t) => (t.marks?.length ?? 0) > 0));
}

const hrefOf = (t: EmailText) => t.marks?.find((m): m is Extract<EmailMark, { type: "link" }> => m.type === "link")?.attrs.href ?? null;

/** A line split into runs that share one link (or none), so a link with bold inside it stays one link. */
function runs(line: EmailLine): { href: string | null; parts: EmailText[] }[] {
  const out: { href: string | null; parts: EmailText[] }[] = [];
  for (const t of line.content ?? []) {
    const href = hrefOf(t);
    const last = out[out.length - 1];
    if (last && last.href === href) last.parts.push(t);
    else out.push({ href, parts: [t] });
  }
  return out;
}

/** What a reader sees of a link address: no "mailto:", and no "https://" when the text already says it. */
const shownHref = (href: string) => href.replace(/^mailto:/i, "");
const sameAddress = (text: string, href: string) => {
  const bare = (s: string) => s.trim().replace(/^(https?:\/\/|mailto:)/i, "").replace(/\/$/, "").toLowerCase();
  return bare(text) === bare(href);
};

/**
 * The plain-text version: what the checks read, what is stored as the body, and what mail clients without HTML show.
 * A link whose text is not its address is written "text <address>", as Gmail does.
 */
export function emailDocToText(doc: EmailDoc): string {
  return doc.content
    .map((line) =>
      runs(line)
        .map(({ href, parts }) => {
          const text = parts.map((p) => p.text).join("");
          return href && !sameAddress(text, href) ? `${text} <${shownHref(href)}>` : text;
        })
        .join(""),
    )
    .join("\n");
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const TAG = { bold: "b", italic: "i", underline: "u" } as const;

/** The HTML version, in the shape Gmail itself writes: a div per line, an empty div for a blank line. */
export function emailDocToHtml(doc: EmailDoc): string {
  const lines = doc.content.map((line) => {
    const html = runs(line)
      .map(({ href, parts }) => {
        const inner = parts
          .map((p) => (p.marks ?? []).reduceRight((acc, m) => (m.type === "link" ? acc : `<${TAG[m.type]}>${acc}</${TAG[m.type]}>`), escapeHtml(p.text)))
          .join("");
        return href ? `<a href="${escapeHtml(href)}">${inner}</a>` : inner;
      })
      .join("");
    return `<div>${html || "<br>"}</div>`;
  });
  return `<div dir="ltr">${lines.join("")}</div>`;
}

/** The runs of one line, for showing an email in the app with its formatting. */
export const lineRuns = runs;
