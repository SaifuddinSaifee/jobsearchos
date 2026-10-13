import { describe, expect, it } from "vitest";
import { profileToDoc } from "@/lib/documents/convert/profile-to-doc";
import { defaultPageSettings } from "@/lib/documents/page-settings";
import { renderBodyHtml, renderPageHtml, renderPrintHtml } from "@/lib/documents/render/html";
import { fontFaceCss, printCss } from "@/lib/documents/render/template-css";
import { emptyProfile } from "@/lib/profile/schema";

const profile = {
  ...emptyProfile(),
  contact: { name: "Ada <Lovelace>", email: "ada@example.com", phone: "", location: "", links: [] },
  experience: [{ company: "Acme", title: "Engineer", location: "Remote", start: "2020", end: "", current: true, bullets: ["Did a thing"] }],
};

describe("renderBodyHtml", () => {
  const html = renderBodyHtml(profileToDoc(profile, () => "x"));

  it("uses the class names the template CSS styles", () => {
    expect(html).toContain('class="rs-header"');
    expect(html).toContain('class="rs-name"');
    expect(html).toContain('class="rs-section-title"');
    expect(html).toContain('class="rs-role-title"');
    expect(html).toContain('class="rs-role-dates"');
    expect(html).toContain("<li");
    expect(html).toContain("Did a thing");
  });

  it("escapes text", () => {
    expect(html).toContain("Ada &lt;Lovelace&gt;");
    expect(html).not.toContain("<Lovelace>");
  });

  it("renders a link with a safe rel", () => {
    expect(html).toContain('href="mailto:ada@example.com"');
    expect(html).toContain("noopener noreferrer");
  });
});

describe("renderPrintHtml", () => {
  const settings = defaultPageSettings();
  const doc = profileToDoc(profile, () => "x");

  it("makes a full A4 document with fonts, content styles and the page variables", () => {
    const html = renderPrintHtml(doc, settings, { title: "A & B" });
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<title>A &amp; B</title>");
    expect(html).toContain("@page{size:A4;margin:12.7mm}");
    expect(html).toContain('font-family:"Carlito"');
    expect(html).toContain("--rs-font-size:10.4pt");
    expect(html).toContain(".rs-edu{display:grid");
    expect(html).toContain(".rs-role{display:flex");
  });

  it("keeps the page style attribute valid even though font names have quotes", () => {
    const page = renderPageHtml(doc, settings);
    expect(page).toMatch(/^<div class="rs-page" style="[^"]*">/);
  });

  it("serves fonts from the given base", () => {
    const css = fontFaceCss("https://print.local");
    expect(css).toContain('url("https://print.local/fonts/carlito-latin-400-normal.woff2")');
    expect(css).toContain('url("https://print.local/fonts/tinos-latin-ext-700-italic.woff2")');
    expect(css.split("@font-face").length - 1).toBe(24);
  });

  it("follows the margin setting in the print rules", () => {
    expect(printCss({ ...settings, margins: "wide" })).toContain("margin:25.4mm");
    expect(printCss({ ...settings, overrides: { marginMm: 20 } })).toContain("margin:20mm");
  });
});
