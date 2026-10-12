import { env } from "@/lib/env";

export type SearchResult = { title: string; url: string; content: string };

/** Pluggable web search so the provider can be swapped (or faked in tests). */
export interface WebSearchProvider {
  /** `includeDomains` restricts results to those sites (used for the targeted second query). */
  search(query: string, opts?: { maxResults?: number; includeDomains?: string[] }): Promise<SearchResult[]>;
}

export class SearchError extends Error {}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** Tavily (https://docs.tavily.com): a search API that returns result snippets, built for LLM use. */
export class TavilyProvider implements WebSearchProvider {
  constructor(
    private apiKey: string,
    private fetcher: FetchLike = (url, init) => fetch(url, init),
  ) {}

  async search(query: string, opts: { maxResults?: number; includeDomains?: string[] } = {}): Promise<SearchResult[]> {
    const res = await this.fetcher("https://api.tavily.com/search", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        query,
        search_depth: "basic",
        max_results: opts.maxResults ?? 5,
        include_answer: false,
        ...(opts.includeDomains?.length ? { include_domains: opts.includeDomains } : {}),
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status === 401 || res.status === 403) throw new SearchError("The search service rejected the API key (check TAVILY_API_KEY)");
    if (res.status === 429 || res.status === 432 || res.status === 433) throw new SearchError("The search service rate limit or plan limit was reached");
    if (!res.ok) throw new SearchError(`The search service returned HTTP ${res.status}`);
    const json = (await res.json()) as { results?: { title?: string; url?: string; content?: string }[] };
    return (json.results ?? [])
      .filter((r) => typeof r.url === "string" && r.url)
      .map((r) => ({ title: r.title ?? r.url!, url: r.url!, content: r.content ?? "" }));
  }
}

/** The configured provider, or null when no search key is set. */
export function webSearch(): WebSearchProvider | null {
  const key = env().TAVILY_API_KEY;
  return key ? new TavilyProvider(key) : null;
}
