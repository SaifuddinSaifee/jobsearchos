import { BrowserUnavailableError, withContext } from "@/lib/browser";
import { FetchError } from "./types";

/** Loads the page in Chromium, waits for it to settle, returns the rendered HTML. */
export async function renderPage(url: string): Promise<string> {
  try {
    return await withContext(async (context) => {
      const page = await context.newPage();
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
      await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
      return page.content();
    });
  } catch (err) {
    if (err instanceof BrowserUnavailableError) throw new FetchError("blocked", `${err.message} Or paste the JD text.`);
    throw err;
  }
}
