import { asObj, num, str, type Obj } from "./ats/common";
import { decodeEntities, htmlToText } from "./text";
import type { Hints } from "./types";

export type JobPostingLd = { hints: Hints; description: string; applicationUrl: string | null; raw: Obj };

function findJobPosting(node: unknown): Obj | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const f = findJobPosting(n);
      if (f) return f;
    }
    return null;
  }
  const o = asObj(node);
  const type = o["@type"];
  if (type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting"))) return o;
  return findJobPosting(o["@graph"]);
}

/** First schema.org JobPosting found in the page's ld+json scripts, mapped to hints. */
export function extractJsonLd(html: string): JobPostingLd | null {
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of html.matchAll(re)) {
    let json: unknown;
    try {
      json = JSON.parse(m[1].trim());
    } catch {
      continue;
    }
    const job = findJobPosting(json);
    if (job) return mapJobPosting(job);
  }
  return null;
}

function locationText(loc: unknown): string {
  const first = asObj(Array.isArray(loc) ? loc[0] : loc);
  const a = asObj(first.address);
  return [str(a.addressLocality), str(a.addressRegion), str(a.addressCountry) || str(asObj(a.addressCountry).name)]
    .filter(Boolean)
    .join(", ");
}

export function mapJobPosting(job: Obj): JobPostingLd {
  const salary = asObj(job.baseSalary);
  const value = asObj(salary.value);
  const unit = str(value.unitText).toLowerCase();
  const rawDesc = str(job.description);
  const desc = htmlToText(rawDesc.includes("&lt;") ? decodeEntities(rawDesc) : rawDesc);
  const empl = Array.isArray(job.employmentType) ? str(job.employmentType[0]) : str(job.employmentType);
  const org = asObj(job.hiringOrganization);
  return {
    description: desc,
    applicationUrl: str(job.url) || null,
    raw: job,
    hints: {
      title: str(job.title) || undefined,
      company: str(org.name) || undefined,
      location: locationText(job.jobLocation) || undefined,
      employmentType: empl || undefined,
      remoteType: str(job.jobLocationType) === "TELECOMMUTE" ? "remote" : undefined,
      postedAt: str(job.datePosted).slice(0, 10) || undefined,
      salaryMin: num(value.minValue) ?? num(value.value),
      salaryMax: num(value.maxValue),
      salaryCurrency: str(salary.currency) || undefined,
      salaryPeriod: unit || undefined,
    },
  };
}
