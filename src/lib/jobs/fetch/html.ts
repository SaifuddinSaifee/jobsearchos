import { readBody } from "./fetcher";
import { extractJsonLd } from "./jsonld";
import { readableText } from "./text";
import { FetchError, type FetchedPosting, type FetchMethodName } from "./types";

export const MIN_TEXT = 800;
const BLOCK_MARKERS = /captcha|access denied|are you a robot|verify you are human|enable javascript/i;

/**
 * Pure step shared by plain-HTML and Playwright fetches. Prefers a JSON-LD JobPosting,
 * then Readability text. Returns null when the page is too thin (likely JS-rendered).
 */
export function postingFromHtml(
  html: string,
  sourceUrl: string,
  method: Extract<FetchMethodName, "html" | "playwright" | "jsonld">,
): FetchedPosting | null {
  const ld = extractJsonLd(html);
  const page = readableText(html, sourceUrl);

  if (ld && ld.description.length >= 200) {
    return {
      method: method === "playwright" ? "playwright" : "jsonld",
      sourceUrl,
      applicationUrl: ld.applicationUrl ?? sourceUrl,
      ats: null,
      atsJobId: null,
      raw: { body: html, mime: "text/html" },
      text: ld.description,
      hints: ld.hints,
    };
  }
  if (page.text.length < MIN_TEXT) {
    if (BLOCK_MARKERS.test(page.text)) throw new FetchError("blocked", "The site served a bot check instead of the posting");
    return null;
  }
  return {
    method: method === "playwright" ? "playwright" : "html",
    sourceUrl,
    applicationUrl: sourceUrl,
    ats: null,
    atsJobId: null,
    raw: { body: html, mime: "text/html" },
    text: page.text,
    hints: ld?.hints ?? {},
  };
}

export async function fetchHtmlPage(fetchUrl: string, sourceUrl: string, fetcher: (u: string) => Promise<Response>) {
  const res = await fetcher(fetchUrl);
  const html = await readBody(res);
  return { html, posting: postingFromHtml(html, sourceUrl, "html") };
}
