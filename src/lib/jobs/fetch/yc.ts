import { JSDOM } from "jsdom";
import { asObj, joinSections, str, type Obj } from "./ats/common";
import { htmlToText } from "./text";
import type { Hints } from "./types";

/**
 * Y Combinator's Work at a Startup job pages carry the whole posting as JSON in a `data-page` attribute.
 * The page only shows part of it to logged-out visitors: the company's tech stack, the application questions
 * and the founders are in the data but not in the visible text, so reading the data gets the full posting
 * without a browser.
 */
export function ycJobFromHtml(html: string): { text: string; hints: Hints } | null {
  const props = dataPageProps(html);
  const job = asObj(props?.job);
  const description = str(job.descriptionHtml);
  if (!description) return null;
  const company = asObj(props?.company);
  const name = str(company.name);
  const list = (v: unknown) => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);

  const facts: Array<[string, string]> = [
    ["Company", [name, str(company.description)].filter(Boolean).join(": ")],
    ["Location", str(job.location)],
    ["Job type", str(job.jobType)],
    ["Salary", str(job.salaryRange)],
    ["Equity", str(job.equityRange)],
    ["Experience", str(job.minExperience)],
    ["Visa", str(job.sponsorsVisa)],
    ["Skills", list(job.skills).join(", ")],
    ["YC batch", str(company.batch)],
    ["Team size", typeof company.teamSize === "number" ? String(company.teamSize) : ""],
    ["Industry", list(company.industries).join(", ") || str(company.industry)],
    ["Website", str(company.url)],
  ];
  const header = [str(job.title), ...facts.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`)].filter(Boolean).join("\n");

  const questions = (Array.isArray(props?.customQuestions) ? props.customQuestions : [])
    .map(asObj)
    .filter((q) => str(q.label))
    .map((q) => `- ${str(q.label)}${q.required === false ? " (optional)" : ""}`);
  const founders = (Array.isArray(company.founders) ? company.founders : [])
    .map(asObj)
    .filter((f) => str(f.name))
    .map((f) => `- ${str(f.name)}, ${str(f.title) || "Founder"}`);

  const text = joinSections([
    ["", header],
    ["About the role", htmlToText(description)],
    ["Technology", htmlToText(str(company.techDescriptionHtml))],
    ["Interview process", htmlToText(str(job.interviewProcessHtml))],
    [name ? `About ${name}` : "About the company", htmlToText(str(company.hiringDescriptionHtml))],
    ["Application questions", questions.join("\n")],
    ["Founders", founders.join("\n")],
  ]);

  return {
    text,
    hints: {
      title: str(job.title) || undefined,
      company: name || undefined,
      location: str(job.location) || undefined,
      employmentType: str(job.jobType) || undefined,
      ...salaryHints(str(job.salaryRange)),
    },
  };
}

function dataPageProps(html: string): Obj | null {
  const m = /data-page="([^"]*)"/.exec(html);
  if (!m) return null;
  // The attribute is HTML-escaped JSON; let the HTML parser undo the escaping.
  const raw = JSDOM.fragment(`<div data-page="${m[1]}"></div>`).firstElementChild?.getAttribute("data-page");
  try {
    return asObj(asObj(JSON.parse(raw ?? "")).props);
  } catch {
    return null;
  }
}

/** "$140K - $200K" or "$90K - $120K CAD" to numbers. Anything it cannot read is left to the model. */
export function salaryHints(range: string): Hints {
  const values = [...range.matchAll(/(\d+(?:\.\d+)?)\s*([km])?/gi)].map(
    ([, n, unit]) => Number(n) * (unit?.toLowerCase() === "k" ? 1_000 : unit?.toLowerCase() === "m" ? 1_000_000 : 1),
  );
  if (!values.length) return {};
  const currency = /\b([A-Z]{3})\b/.exec(range)?.[1] ?? (range.includes("$") ? "USD" : undefined);
  const period = /hour|\/hr\b/i.test(range) ? "hour" : values[0] >= 1_000 ? "year" : undefined;
  return {
    salaryMin: values[0],
    salaryMax: values.length > 1 ? values[1] : undefined,
    salaryCurrency: currency,
    salaryPeriod: period,
  };
}
