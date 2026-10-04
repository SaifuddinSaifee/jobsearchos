import { fetchAshby } from "./ats/ashby";
import { fetchGreenhouse } from "./ats/greenhouse";
import { fetchLever } from "./ats/lever";
import { fetchSmartRecruiters } from "./ats/smartrecruiters";
import { fetchWorkable } from "./ats/workable";
import { fetchWorkday } from "./ats/workday";
import { renderPage } from "./browser";
import { defaultFetcher } from "./fetcher";
import { fetchHtmlPage, postingFromHtml } from "./html";
import { FetchError, type FetchedPosting, type FetchStep, type Fetcher } from "./types";
import { canonicalizeUrl, detectSource, guessGreenhouse, isBlockedHost, parseJobUrl } from "./url";

export type FetchJobOptions = {
  fetcher?: Fetcher;
  render?: (url: string) => Promise<string>;
  onStep?: (step: FetchStep) => void;
};

/** ATS API → JSON-LD → HTML/Readability → Playwright. Cheapest, most reliable method first. */
export async function fetchJob(input: string, opts: FetchJobOptions = {}): Promise<FetchedPosting> {
  const fetcher = opts.fetcher ?? defaultFetcher;
  const render = opts.render ?? renderPage;
  const step = opts.onStep ?? (() => {});

  step({ step: "detect", status: "running" });
  parseJobUrl(input);
  if (isBlockedHost(input)) {
    throw new FetchError("blocked", "This site does not allow automated fetching. Paste the job description text instead.");
  }
  const sourceUrl = canonicalizeUrl(input);
  // Canonical form is for storage/dedup; fetch the URL as given (minus fragment) so http-only sites still work.
  const pageUrl = parseJobUrl(input);
  pageUrl.hash = "";
  const fetchUrl = pageUrl.toString();
  const match = detectSource(input) ?? guessGreenhouse(input);
  step({ step: "detect", status: "done", detail: match ? match.ats : "career page" });

  step({ step: "fetch", status: "running" });
  if (match) {
    try {
      const posting = await (
        match.ats === "greenhouse" ? fetchGreenhouse(match, sourceUrl, fetcher)
        : match.ats === "lever" ? fetchLever(match, sourceUrl, fetcher)
        : match.ats === "ashby" ? fetchAshby(match, sourceUrl, fetcher)
        : match.ats === "workday" ? fetchWorkday(match, sourceUrl, fetcher)
        : match.ats === "smartrecruiters" ? fetchSmartRecruiters(match, sourceUrl, fetcher)
        : fetchWorkable(match, sourceUrl, fetcher)
      );
      step({ step: "fetch", status: "done", detail: `${match.ats} API` });
      step({ step: "render", status: "skipped" });
      return posting;
    } catch (err) {
      // A known ATS whose API fails (not found, blocked) falls through to the page itself.
      if (!(err instanceof FetchError)) throw err;
    }
  }

  const { posting } = await fetchHtmlPage(fetchUrl, sourceUrl, fetcher);
  if (posting) {
    step({ step: "fetch", status: "done", detail: posting.method === "jsonld" ? "JSON-LD" : "page text" });
    step({ step: "render", status: "skipped" });
    return posting;
  }
  step({ step: "fetch", status: "done", detail: "page is JS-rendered" });

  step({ step: "render", status: "running" });
  const rendered = postingFromHtml(await render(fetchUrl), sourceUrl, "playwright");
  if (!rendered) throw new FetchError("empty", "Could not find a job description on that page. Paste the JD text instead.");
  step({ step: "render", status: "done" });
  return rendered;
}
