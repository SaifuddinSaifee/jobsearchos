import { escapeHTML, escapeHTMLAttribute } from "@tiptap/static-renderer";
import { renderToHTMLString } from "@tiptap/static-renderer/pm/html-string";
import type { DocJSON } from "../build";
import { documentExtensions } from "../nodes";
import { styleVars, type PageSettings } from "../page-settings";
import { CONTENT_CSS, fontFaceCss, printCss } from "./template-css";

/** The document's markup, with the same class names the editor shows. No wrapper. */
export function renderBodyHtml(content: DocJSON): string {
  return renderToHTMLString({ content, extensions: documentExtensions });
}

export function styleAttr(settings: PageSettings): string {
  return escapeHTMLAttribute(
    Object.entries(styleVars(settings))
      .map(([k, v]) => `${k}:${v}`)
      .join(";"),
  );
}

/** The page element: variables for this document's settings, around the body markup. */
export function renderPageHtml(content: DocJSON, settings: PageSettings): string {
  return `<div class="rs-page" style="${styleAttr(settings)}">${renderBodyHtml(content)}</div>`;
}

/** A complete HTML document ready to print to PDF. Fonts load from `fontBase` + /fonts. */
export function renderPrintHtml(content: DocJSON, settings: PageSettings, opts: { title?: string; fontBase?: string } = {}): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHTML(opts.title ?? "Document")}</title><style>${fontFaceCss(opts.fontBase ?? "")}\n${CONTENT_CSS}\n${printCss(settings)}</style></head><body>${renderPageHtml(content, settings)}</body></html>`;
}
