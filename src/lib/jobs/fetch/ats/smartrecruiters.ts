import { type AtsMatch } from "../url";
import { htmlToText } from "../text";
import type { FetchedPosting, Fetcher } from "../types";
import { asObj, getJson, joinSections, requireText, str } from "./common";

type Match = Extract<AtsMatch, { ats: "smartrecruiters" }>;

export function parseSmartRecruiters(body: string, json: unknown, m: Match, sourceUrl: string): FetchedPosting {
  const j = asObj(json);
  const loc = asObj(j.location);
  const sections = asObj(asObj(j.jobAd).sections);
  const section = (k: string): [string, string] => {
    const s = asObj(sections[k]);
    return [str(s.title), htmlToText(str(s.text))];
  };
  return requireText({
    method: "smartrecruiters",
    sourceUrl,
    applicationUrl: str(j.applyUrl) || sourceUrl,
    ats: "smartrecruiters",
    atsJobId: m.id,
    raw: { body, mime: "application/json" },
    text: joinSections([
      section("companyDescription"),
      section("jobDescription"),
      section("qualifications"),
      section("additionalInformation"),
    ]),
    hints: {
      title: str(j.name) || undefined,
      company: str(asObj(j.company).name) || undefined,
      location: [str(loc.city), str(loc.region), str(loc.country).toUpperCase()].filter(Boolean).join(", ") || undefined,
      employmentType: str(asObj(j.typeOfEmployment).label) || undefined,
      remoteType: loc.remote === true ? "remote" : undefined,
      postedAt: str(j.releasedDate).slice(0, 10) || undefined,
    },
  });
}

export async function fetchSmartRecruiters(m: Match, sourceUrl: string, fetcher: Fetcher) {
  const { body, json } = await getJson(fetcher, `https://api.smartrecruiters.com/v1/companies/${m.company}/postings/${m.id}`);
  return parseSmartRecruiters(body, json, m, sourceUrl);
}
