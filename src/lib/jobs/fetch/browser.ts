import { FetchError } from "./types";

type PwBrowser = import("playwright").Browser;

const g = globalThis as unknown as { __jobBrowser?: Promise<PwBrowser> };

/** Lazily launched, shared headless Chromium. Playwright is imported only when first needed. */
function browser(): Promise<PwBrowser> {
  return (g.__jobBrowser ??= import("playwright")
    .then((pw) => pw.chromium.launch({ headless: true }))
    .catch((err) => {
      g.__jobBrowser = undefined;
      throw new FetchError(
        "blocked",
        `Browser rendering is unavailable (${err instanceof Error ? err.message.split("\n")[0] : "launch failed"}). Run "npm run browsers:install", or paste the JD text.`,
      );
    }));
}

/** Loads the page in Chromium, waits for it to settle, returns the rendered HTML. */
export async function renderPage(url: string): Promise<string> {
  const context = await (await browser()).newContext();
  try {
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    return await page.content();
  } finally {
    await context.close();
  }
}
