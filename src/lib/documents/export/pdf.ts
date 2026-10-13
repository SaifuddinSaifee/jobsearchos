import { readFile } from "node:fs/promises";
import path from "node:path";
import { getDocumentProxy } from "unpdf";
import { withContext } from "@/lib/browser";
import type { DocJSON } from "../build";
import type { PageSettings } from "../page-settings";
import { renderPrintHtml } from "../render/html";

const ORIGIN = "https://print.local";
const RENDER_TIMEOUT_MS = 20_000;
/** Only the bundled font files can be requested, by plain file name. */
const FONT_FILE = /^[a-z]+(?:-[a-z]+)*-\d{3}-(?:normal|italic)\.woff2$/;

export type PdfResult = { bytes: Buffer; pages: number };

/**
 * Prints a document to PDF in headless Chromium, from the same HTML and CSS the editor shows, with real selectable
 * text. The page is served from a private origin and every other request is blocked, so a link or image in a document
 * can never make the server fetch anything.
 */
export async function renderPdf(content: DocJSON, settings: PageSettings, opts: { title: string; fontDir?: string }): Promise<PdfResult> {
  const html = renderPrintHtml(content, settings, { title: opts.title, fontBase: ORIGIN });
  const fontDir = opts.fontDir ?? path.join(process.cwd(), "public", "fonts");

  const bytes = await withContext(async (context) => {
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== ORIGIN) return route.abort();
      if (url.pathname === "/doc") return route.fulfill({ contentType: "text/html; charset=utf-8", body: html });
      const file = url.pathname.startsWith("/fonts/") ? url.pathname.slice("/fonts/".length) : "";
      if (!FONT_FILE.test(file)) return route.fulfill({ status: 404, body: "" });
      try {
        return await route.fulfill({ contentType: "font/woff2", body: await readFile(path.join(fontDir, file)) });
      } catch {
        return route.fulfill({ status: 404, body: "" });
      }
    });
    const page = await context.newPage();
    page.setDefaultTimeout(RENDER_TIMEOUT_MS);
    await page.goto(`${ORIGIN}/doc`, { waitUntil: "load" });
    // Fonts load lazily; printing before they arrive would use the fallback font and change the layout.
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    return Buffer.from(await page.pdf({ preferCSSPageSize: true, printBackground: true, tagged: true }));
  });

  return { bytes, pages: await countPdfPages(bytes) };
}

/** The number of pages in a PDF. */
export async function countPdfPages(bytes: Buffer): Promise<number> {
  return (await getDocumentProxy(new Uint8Array(bytes))).numPages;
}
