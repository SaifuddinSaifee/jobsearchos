type PwBrowser = import("playwright").Browser;
type PwContext = import("playwright").BrowserContext;

/** Playwright's Chromium could not be started (usually it was never installed). */
export class BrowserUnavailableError extends Error {
  constructor(reason: string) {
    super(`Browser rendering is unavailable (${reason}). Run "npm run browsers:install".`);
    this.name = "BrowserUnavailableError";
  }
}

/** Closed after this long without use, so a server that is not exporting is not holding a browser in memory. */
const IDLE_MS = 5 * 60_000;
/** At most this many pages render at once; the rest wait their turn. */
const MAX_CONCURRENT = 2;

type State = { browser?: Promise<PwBrowser>; idle?: ReturnType<typeof setTimeout>; active: number; waiting: (() => void)[] };
const g = globalThis as unknown as { __sharedBrowser?: State };
const state = (): State => (g.__sharedBrowser ??= { active: 0, waiting: [] });

/** The one shared headless Chromium, launched on first use. Playwright is only imported when it is needed. */
function launch(): Promise<PwBrowser> {
  const s = state();
  return (s.browser ??= import("playwright")
    .then((pw) => pw.chromium.launch({ headless: true }))
    .then((b) => {
      b.on("disconnected", () => {
        s.browser = undefined;
      });
      return b;
    })
    .catch((err) => {
      s.browser = undefined;
      throw new BrowserUnavailableError(err instanceof Error ? err.message.split("\n")[0] : "launch failed");
    }));
}

function touch() {
  const s = state();
  if (s.idle) clearTimeout(s.idle);
  s.idle = setTimeout(() => {
    if (s.active > 0) return touch();
    const b = s.browser;
    s.browser = undefined;
    void b?.then((x) => x.close()).catch(() => {});
  }, IDLE_MS);
  s.idle.unref?.();
}

/**
 * Runs `fn` in a fresh, isolated browser context (closed afterwards), waiting if too many are already running.
 * Each caller gets its own cookies and storage, so renders cannot see each other.
 */
export async function withContext<T>(fn: (context: PwContext) => Promise<T>): Promise<T> {
  const s = state();
  if (s.active >= MAX_CONCURRENT) await new Promise<void>((resolve) => s.waiting.push(resolve));
  s.active++;
  try {
    const context = await (await launch()).newContext();
    try {
      return await fn(context);
    } finally {
      await context.close().catch(() => {});
    }
  } finally {
    s.active--;
    s.waiting.shift()?.();
    touch();
  }
}

/** Closes the shared browser now (for tests and shutdown). */
export async function closeBrowser(): Promise<void> {
  const s = state();
  if (s.idle) clearTimeout(s.idle);
  const b = s.browser;
  s.browser = undefined;
  await b?.then((x) => x.close()).catch(() => {});
}
