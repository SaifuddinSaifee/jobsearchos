import { assertPublicUrl } from "./guard";
import { FetchError, type Fetcher } from "./types";

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/**
 * Default fetcher: browser-like UA and a 15 s timeout. Redirects are followed here rather than by `fetch`, so every
 * hop is checked to be a public address first (see guard.ts).
 */
export const defaultFetcher: Fetcher = async (url, init) => {
  const signal = AbortSignal.timeout(15_000);
  const headers = { "user-agent": USER_AGENT, accept: "text/html,application/json;q=0.9,*/*;q=0.8", ...init?.headers };
  let target = url;
  let request: RequestInit = { ...init };
  for (let hop = 0; ; hop++) {
    await assertPublicUrl(target);
    const res = await fetch(target, { ...request, headers, redirect: "manual", signal });
    const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!location) return res;
    if (hop >= MAX_REDIRECTS) throw new FetchError("empty", "The site redirected too many times");
    await res.body?.cancel().catch(() => {});
    target = new URL(location, target).toString();
    // Like browsers: a 303, or a 301/302 after POST, continues as a GET without a body.
    if (res.status === 303 || ((res.status === 301 || res.status === 302) && request.method && request.method !== "GET")) {
      request = { ...request, method: "GET", body: undefined };
    }
  }
};

/** Reads a response body as text (5 MB cap) and maps blocking statuses to FetchError. */
export async function readBody(res: Response): Promise<string> {
  if (res.status === 404 || res.status === 410) throw new FetchError("not_found", "The posting was not found (it may have been removed)");
  if (res.status === 401 || res.status === 403 || res.status === 429) {
    throw new FetchError("blocked", `The site refused the request (HTTP ${res.status})`);
  }
  if (!res.ok) throw new FetchError("empty", `The site returned HTTP ${res.status}`);
  const text = await res.text();
  if (text.length > MAX_BYTES) throw new FetchError("empty", "The page is too large");
  return text;
}
