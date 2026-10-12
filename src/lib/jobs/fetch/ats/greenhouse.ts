import { type AtsMatch } from "../url";
import { decodeEntities, htmlToText } from "../text";
import type { FetchedPosting, Fetcher } from "../types";
import { asObj, getJson, joinSections, num, requireText, str } from "./common";

type Match = Extract<AtsMatch, { ats: "greenhouse" }>;

export function parseGreenhouse(body: string, json: unknown, m: Match, sourceUrl: string): FetchedPosting {
  const j = asObj(json);
  const range = asObj((Array.isArray(j.pay_input_ranges) ? j.pay_input_ranges : [])[0]);
  const min = num(range.min_cents);
  const max = num(range.max_cents);
  return requireText({
    method: "greenhouse",
    sourceUrl,
    applicationUrl: str(j.absolute_url) || sourceUrl,
    ats: "greenhouse",
    atsJobId: m.id,
    raw: { body, mime: "application/json" },
    text: joinSections([["", htmlToText(decodeEntities(str(j.content)))]]),
    hints: {
      title: str(j.title) || undefined,
      company: str(j.company_name) || undefined,
      location: str(asObj(j.location).name) || undefined,
      postedAt: (str(j.first_published) || str(j.updated_at)).slice(0, 10) || undefined,
      salaryMin: min !== undefined ? Math.round(min / 100) : undefined,
      salaryMax: max !== undefined ? Math.round(max / 100) : undefined,
      salaryCurrency: str(range.currency_type) || undefined,
      salaryPeriod: min !== undefined ? "year" : undefined,
    },
  });
}

export async function fetchGreenhouse(m: Match, sourceUrl: string, fetcher: Fetcher) {
  const url = `https://boards-api.greenhouse.io/v1/boards/${m.board}/jobs/${m.id}?pay_transparency=true`;
  const { body, json } = await getJson(fetcher, url);
  return parseGreenhouse(body, json, m, sourceUrl);
}
