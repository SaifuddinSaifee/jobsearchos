import type { JSONContent } from "@tiptap/core";
import { SAFE_LINK, type SectionKind } from "./nodes";

// Small helpers for building editor documents as plain JSON. Used by the converters and the tests.

export type DocJSON = JSONContent;
export type IdGen = () => string;

export const newId: IdGen = () => crypto.randomUUID().replace(/-/g, "").slice(0, 12);

export type Mark = { type: "bold" | "italic" | "underline" | "link"; attrs?: { href: string } };

/** Inline content for one line of text. Empty text gives no nodes, because the editor forbids empty text nodes. */
export function inline(text: string, marks?: Mark[]): DocJSON[] {
  const clean = text.replace(/\s*\n\s*/g, " ");
  if (!clean) return [];
  return [{ type: "text", text: clean, ...(marks && marks.length > 0 ? { marks } : {}) }];
}

export function linkMark(href: string): Mark {
  return { type: "link", attrs: { href } };
}

/** Adds a scheme to a bare web address, and refuses anything that is not http, https or mailto. */
export function safeHref(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : value.includes("@") && !value.includes("/") ? `mailto:${value}` : `https://${value}`;
  return SAFE_LINK.test(withScheme) ? withScheme : null;
}

export const textField = (type: string, text: string, marks?: Mark[]): DocJSON => ({
  type,
  ...(text ? { content: inline(text, marks) } : {}),
});

export const paragraph = (text: string, marks?: Mark[]): DocJSON => ({ type: "paragraph", ...(text ? { content: inline(text, marks) } : {}) });

export function bulletList(items: string[], id: IdGen = newId): DocJSON | null {
  const clean = items.map((t) => t.trim()).filter(Boolean);
  if (clean.length === 0) return null;
  return {
    type: "bulletList",
    content: clean.map((t) => ({ type: "bullet", attrs: { id: id() }, content: [paragraph(t)] })),
  };
}

/** A bullet list with one empty bullet, for a new entry to type into. */
export function emptyBullets(id: IdGen = newId): DocJSON {
  return { type: "bulletList", content: [{ type: "bullet", attrs: { id: id() }, content: [paragraph("")] }] };
}

export function section(kind: SectionKind, title: string, items: (DocJSON | null)[], id: IdGen = newId): DocJSON {
  return {
    type: "section",
    attrs: { id: id(), kind },
    content: [textField("sectionTitle", title), ...items.filter((x): x is DocJSON => x !== null)],
  };
}
