import { type AtsMatch } from "../url";
import { htmlToText } from "../text";
import type { FetchedPosting, Fetcher } from "../types";
import { asObj, getJson, joinSections, requireText, str } from "./common";

type Match = Extract<AtsMatch, { ats: "workable" }>;

export function parseWorkable(body: string, json: unknown, m: Match, sourceUrl: string): FetchedPosting {
  const j = asObj(json);
  const loc = asObj(j.location);
  return requireText({
    method: "workable",
    sourceUrl,
    applicationUrl: str(j.url) || sourceUrl,
    ats: "workable",
    atsJobId: m.shortcode,
    raw: { body, mime: "application/json" },
    text: joinSections([
      ["", htmlToText(str(j.description))],
      ["Requirements", htmlToText(str(j.requirements))],
      ["Benefits", htmlToText(str(j.benefits))],
    ]),
    hints: {
      title: str(j.title) || undefined,
      location: [str(loc.city), str(loc.region), str(loc.country)].filter(Boolean).join(", ") || undefined,
      employmentType: str(j.type) || undefined,
      remoteType: j.remote === true || str(j.workplace) === "remote" ? "remote" : str(j.workplace) === "hybrid" ? "hybrid" : str(j.workplace) === "on_site" ? "onsite" : undefined,
      postedAt: str(j.published).slice(0, 10) || undefined,
    },
  });
}

export async function fetchWorkable(m: Match, sourceUrl: string, fetcher: Fetcher) {
  const { body, json } = await getJson(fetcher, `https://apply.workable.com/api/v2/accounts/${m.account}/jobs/${m.shortcode}`);
  return parseWorkable(body, json, m, sourceUrl);
}
