import { type AtsMatch } from "../url";
import { htmlToText } from "../text";
import { FetchError, type FetchedPosting, type Fetcher } from "../types";
import { asObj, getJson, joinSections, requireText, str } from "./common";

type Match = Extract<AtsMatch, { ats: "ashby" }>;

export function parseAshby(body: string, json: unknown, m: Match, sourceUrl: string): FetchedPosting {
  const jobs = (Array.isArray(asObj(json).jobs) ? (asObj(json).jobs as unknown[]) : []).map(asObj);
  const job = jobs.find((j) => str(j.id) === m.id);
  if (!job) throw new FetchError("not_found", "The posting is no longer on the company's Ashby board");
  const comp = asObj(job.compensation);
  const workplace = str(job.workplaceType).toLowerCase();
  return requireText({
    method: "ashby",
    sourceUrl,
    applicationUrl: str(job.applyUrl) || str(job.jobUrl) || sourceUrl,
    ats: "ashby",
    atsJobId: m.id,
    raw: { body: JSON.stringify(job), mime: "application/json" },
    text: joinSections([
      ["", str(job.descriptionPlain) || htmlToText(str(job.descriptionHtml))],
      ["Compensation", str(comp.compensationTierSummary) || str(comp.scrapeableCompensationSalarySummary)],
    ]),
    hints: {
      title: str(job.title) || undefined,
      location: str(job.location) || undefined,
      employmentType: str(job.employmentType) || undefined,
      // isRemote is true for hybrid roles too, so workplaceType wins when present.
      remoteType: workplace === "remote" ? "remote" : workplace === "hybrid" ? "hybrid" : workplace === "onsite" ? "onsite" : job.isRemote === true ? "remote" : undefined,
      postedAt: str(job.publishedAt).slice(0, 10) || undefined,
    },
  });
}

export async function fetchAshby(m: Match, sourceUrl: string, fetcher: Fetcher) {
  const { body, json } = await getJson(
    fetcher,
    `https://api.ashbyhq.com/posting-api/job-board/${m.org}?includeCompensation=true`,
  );
  return parseAshby(body, json, m, sourceUrl);
}
