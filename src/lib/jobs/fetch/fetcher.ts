import { FetchError, type Fetcher } from "./types";

const MAX_BYTES = 5 * 1024 * 1024;
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/** Default fetcher: browser-like UA and a 15 s timeout. */
export const defaultFetcher: Fetcher = (url, init) =>
  fetch(url, {
    redirect: "follow",
    ...init,
    headers: { "user-agent": USER_AGENT, accept: "text/html,application/json;q=0.9,*/*;q=0.8", ...init?.headers },
    signal: AbortSignal.timeout(15_000),
  });

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
