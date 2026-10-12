import { type AtsMatch } from "../url";
import { htmlToText } from "../text";
import type { FetchedPosting, Fetcher } from "../types";
import { asObj, getJson, joinSections, requireText, str } from "./common";

type Match = Extract<AtsMatch, { ats: "workday" }>;

export function parseWorkday(body: string, json: unknown, m: Match, sourceUrl: string): FetchedPosting {
  const j = asObj(json);
  const info = asObj(j.jobPostingInfo);
  const remote = str(info.remoteType).toLowerCase();
  return requireText({
    method: "workday",
    sourceUrl,
    applicationUrl: str(info.externalUrl) || sourceUrl,
    ats: "workday",
    atsJobId: str(info.jobReqId) || m.path.split("_").pop() || null,
    raw: { body, mime: "application/json" },
    text: joinSections([["", htmlToText(str(info.jobDescription))]]),
    hints: {
      title: str(info.title) || undefined,
      // hiringOrganization is an internal legal entity ("2100 NVIDIA USA"), so the model reads the company from the text.
      location: str(info.location) || undefined,
      employmentType: str(info.timeType) || undefined,
      remoteType: remote.includes("remote") ? "remote" : remote.includes("hybrid") ? "hybrid" : remote.includes("on-site") || remote.includes("onsite") ? "onsite" : undefined,
      postedAt: str(info.startDate).slice(0, 10) || undefined,
    },
  });
}

export async function fetchWorkday(m: Match, sourceUrl: string, fetcher: Fetcher) {
  const { body, json } = await getJson(fetcher, `https://${m.host}/wday/cxs/${m.tenant}/${m.site}/job/${m.path}`);
  return parseWorkday(body, json, m, sourceUrl);
}
