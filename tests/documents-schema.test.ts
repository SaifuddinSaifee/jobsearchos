import { describe, expect, it } from "vitest";
import type { DocJSON } from "@/lib/documents/build";
import { hashContent, stableStringify } from "@/lib/documents/hash";
import { defaultPageSettings, parsePageSettings, resolveMetrics, styleVars, contentHeightPx } from "@/lib/documents/page-settings";
import { assertValidDoc, DocContentSchema, emptyDoc, MAX_DOC_BYTES, validateDoc } from "@/lib/documents/schema";

const p = (text: string): DocJSON => ({ type: "paragraph", content: [{ type: "text", text }] });

describe("validateDoc", () => {
  it("accepts a plain document", () => {
    expect(validateDoc({ type: "doc", content: [p("Hello")] }).ok).toBe(true);
    expect(validateDoc(emptyDoc()).ok).toBe(true);
  });

  it("rejects unknown node and mark types", () => {
    expect(validateDoc({ type: "doc", content: [{ type: "heading" }] }).ok).toBe(false);
    const strike = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "strike" }] }] }] };
    expect(validateDoc(strike).ok).toBe(false);
  });

  it("rejects links that are not http, https or mailto", () => {
    const link = (href: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "link", attrs: { href } }] }] }] });
    expect(validateDoc(link("https://example.com")).ok).toBe(true);
    expect(validateDoc(link("mailto:a@b.co")).ok).toBe(true);
    const bad = validateDoc(link("javascript:alert(1)"));
    expect(bad.ok).toBe(false);
  });

  it("rejects blocks in places the editor does not allow", () => {
    const role = { type: "role", content: [{ type: "roleTitle" }] };
    const check = validateDoc({ type: "doc", content: [role] });
    expect(check.ok).toBe(false);
  });

  it("rejects oversize and over-deep documents", () => {
    const big = { type: "doc", content: [p("x".repeat(MAX_DOC_BYTES))] };
    expect(DocContentSchema.safeParse(big).success).toBe(false);
    let deep: DocJSON = p("deep");
    for (let i = 0; i < 20; i++) deep = { type: "bulletList", content: [{ type: "bullet", content: [deep] }] };
    expect(DocContentSchema.safeParse({ type: "doc", content: [deep] }).success).toBe(false);
  });

  it("assertValidDoc throws with the reason", () => {
    expect(() => assertValidDoc({ type: "nope" })).toThrow();
  });
});

describe("hashContent", () => {
  it("does not depend on key order", () => {
    const a = { type: "doc", content: [{ type: "paragraph", attrs: { id: "1", x: 2 } }] } as DocJSON;
    const b = { content: [{ attrs: { x: 2, id: "1" }, type: "paragraph" }], type: "doc" } as DocJSON;
    expect(hashContent(a)).toBe(hashContent(b));
    expect(stableStringify({ b: 1, a: undefined })).toBe('{"b":1}');
  });

  it("changes when the content or the subject changes", () => {
    const d: DocJSON = { type: "doc", content: [p("a")] };
    expect(hashContent(d)).not.toBe(hashContent({ type: "doc", content: [p("b")] }));
    expect(hashContent(d, "s1")).not.toBe(hashContent(d, "s2"));
  });
});

describe("page settings", () => {
  it("fills defaults and falls back on bad input", () => {
    expect(defaultPageSettings()).toMatchObject({ paper: "A4", font: "carlito", density: 3, fitOnePage: true });
    expect(parsePageSettings({ density: 99 })).toEqual(defaultPageSettings());
    expect(parsePageSettings(null)).toEqual(defaultPageSettings());
  });

  it("gets tighter as density rises, and fine controls win", () => {
    const s = defaultPageSettings();
    expect(resolveMetrics({ ...s, density: 8 }).fontSizePt).toBeLessThan(resolveMetrics({ ...s, density: 0 }).fontSizePt);
    expect(resolveMetrics({ ...s, density: 8 }).sectionGapPt).toBeLessThan(resolveMetrics({ ...s, density: 0 }).sectionGapPt);
    expect(resolveMetrics({ ...s, overrides: { marginMm: 25 } }).marginMm).toBe(25);
  });

  it("starts with half-inch margins, and has three presets that spacing does not change", () => {
    const s = defaultPageSettings();
    expect(s.margins).toBe("narrow");
    expect(resolveMetrics(s).marginMm).toBe(12.7);
    expect(resolveMetrics({ ...s, margins: "normal" }).marginMm).toBe(19.05);
    expect(resolveMetrics({ ...s, margins: "wide" }).marginMm).toBe(25.4);
    for (const density of [0, 4, 8]) expect(resolveMetrics({ ...s, density }).marginMm).toBe(12.7);
    expect(contentHeightPx({ ...s, margins: "wide" })).toBeLessThan(contentHeightPx(s));
  });

  it("gives CSS variables for the template", () => {
    expect(styleVars(defaultPageSettings())["--rs-font-size"]).toBe("10.4pt");
  });
});
