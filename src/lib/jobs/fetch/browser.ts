import { BrowserUnavailableError, withContext } from "@/lib/browser";
import { assertPublicUrl, publicHostChecker } from "./guard";
import { FetchError } from "./types";

/**
 * Loads the page in Chromium, waits for it to settle, returns the rendered HTML. Chromium resolves names itself, so
 * every http(s) request it makes (redirects and assets included) is checked to be a public address and aborted if not.
 */
export async function renderPage(url: string): Promise<string> {
  await assertPublicUrl(url);
  try {
    return await withContext(async (context) => {
      const isPublic = publicHostChecker();
      await context.route("**/*", async (route) => {
        const target = route.request().url();
        if (!/^https?:/i.test(target) || (await isPublic(target))) return route.continue();
        return route.abort("blockedbyclient");
      });
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
