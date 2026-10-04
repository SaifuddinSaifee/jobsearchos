import { JSDOM, VirtualConsole } from "jsdom";
import { Readability } from "@mozilla/readability";

const BLOCK = /<\/(p|div|li|ul|ol|h[1-6]|tr|section|article)>|<br\s*\/?>/gi;

/** HTML fragment (e.g. an ATS description field) → plain text with paragraph breaks and bullets. */
export function htmlToText(html: string): string {
  const withBreaks = html
    .replace(/<li[^>]*>/gi, "- ")
    .replace(BLOCK, "\n")
    .replace(/<[^>]+>/g, "");
  const dom = new JSDOM(`<body>${withBreaks}</body>`);
  return normalizeText(dom.window.document.body.textContent ?? "");
}

export function normalizeText(text: string): string {
  return text
    .replace(/ /g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Full HTML page → main article text, falling back to the whole body. */
export function readableText(html: string, url?: string): { title: string; text: string } {
  const virtualConsole = new VirtualConsole(); // jsdom logs CSS parse errors otherwise
  const dom = new JSDOM(html, { url, virtualConsole });
  const doc = dom.window.document;
  doc.querySelectorAll("script, style, noscript, svg").forEach((el) => el.remove());
  const bodyText = normalizeText(doc.body?.textContent ?? "");
  const article = new Readability(doc.cloneNode(true) as Document).parse();
  const articleText = article?.textContent ? normalizeText(article.textContent) : "";
  // Readability can over-prune job pages; keep it only when it kept most of the content.
  const text = articleText.length >= bodyText.length * 0.5 ? articleText : bodyText;
  return { title: article?.title || doc.title || "", text };
}

/** Decodes HTML entities (Greenhouse returns its description entity-escaped). */
export function decodeEntities(text: string): string {
  return new JSDOM(`<body>${text}</body>`).window.document.body.textContent ?? "";
}
