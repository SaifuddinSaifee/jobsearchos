import { type AtsMatch } from "../url";
import { htmlToText } from "../text";
import type { FetchedPosting, Fetcher } from "../types";
import { asObj, getJson, joinSections, num, requireText, str } from "./common";

type Match = Extract<AtsMatch, { ats: "lever" }>;

export function parseLever(body: string, json: unknown, m: Match, sourceUrl: string): FetchedPosting {
  const j = asObj(json);
  const cats = asObj(j.categories);
  const lists = (Array.isArray(j.lists) ? j.lists : []).map(asObj);
  const salary = asObj(j.salaryRange);
  const created = num(j.createdAt);
  const workplace = str(j.workplaceType);
  return requireText({
    method: "lever",
    sourceUrl,
    applicationUrl: str(j.applyUrl) || str(j.hostedUrl) || sourceUrl,
    ats: "lever",
    atsJobId: m.id,
    raw: { body, mime: "application/json" },
    text: joinSections([
      ["", str(j.descriptionPlain) || htmlToText(str(j.description))],
      ...lists.map((l): [string, string] => [str(l.text), htmlToText(str(l.content))]),
      ["", str(j.additionalPlain) || htmlToText(str(j.additional))],
    ]),
    hints: {
      title: str(j.text) || undefined,
      location: str(cats.location) || undefined,
      employmentType: str(cats.commitment) || undefined,
      remoteType:
        workplace === "remote" ? "remote" : workplace === "hybrid" ? "hybrid" : workplace === "on-site" ? "onsite" : undefined,
      postedAt: created ? new Date(created).toISOString().slice(0, 10) : undefined,
      salaryMin: num(salary.min),
      salaryMax: num(salary.max),
      salaryCurrency: str(salary.currency) || undefined,
      salaryPeriod: str(salary.interval).replace(/^per-/, "").replace("-salary", "") || undefined,
    },
  });
}

export async function fetchLever(m: Match, sourceUrl: string, fetcher: Fetcher) {
  const { body, json } = await getJson(fetcher, `https://${m.host}/v0/postings/${m.company}/${m.id}`);
  return parseLever(body, json, m, sourceUrl);
}
