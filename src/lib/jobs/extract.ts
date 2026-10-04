import { env } from "@/lib/env";
import { chatStructured } from "@/lib/llm/structured";
import type { Hints } from "./fetch/types";
import { JobExtractionSchema, type JobExtraction } from "./schema";

const MAX_CHARS = 60_000;
/** Some ATS boards store a literal placeholder (Stripe returns "LOCATION"). */
const PLACEHOLDER = /^\s*(location|n\/a|tbd|none|-)?\s*$/i;

const SYSTEM = `You convert a job posting into structured JSON.
Rules:
- Use only what the posting says. Never infer or invent; use "" or null when something is not stated.
- company: the hiring company (not the job board or staffing site). title: the job title as written.
- location: as written (e.g. "Austin, TX" or "Remote, US"). remoteType: remote, hybrid, onsite, or unknown if unclear.
- employmentType: e.g. "Full-time", "Contract", "Internship"; "" if not stated.
- Salary: numbers only, no symbols (120000, not "$120k"). salaryCurrency as an ISO code (USD, EUR); salaryPeriod one of year, month, hour, or "". Use null when no pay is stated.
- postedAt: ISO date (YYYY-MM-DD) if stated, else "".
- applicationUrl: only if the posting gives an explicit apply link, else "".
- responsibilities: what the person will do, one item per bullet, concise and in the posting's words.
- requirements.required: must-have qualifications; requirements.preferred: nice-to-haves, bonus points, "preferred".
- technologies: a flat list of every tool, language, framework, platform and cloud service named.
- keywords: 10-25 terms an ATS or recruiter would search on for this role (skills, domains, methodologies, tools), as short phrases.
- Ignore navigation, cookie notices, benefits boilerplate and equal-opportunity statements.`;

/** Values from an ATS API or JSON-LD are more reliable than the model's, so they win. */
export function mergeHints(extraction: JobExtraction, hints: Hints): JobExtraction {
  const out = { ...extraction };
  if (hints.title) out.title = hints.title;
  if (hints.company) out.company = hints.company;
  if (hints.location && !PLACEHOLDER.test(hints.location)) out.location = hints.location;
  if (hints.postedAt) out.postedAt = hints.postedAt;
  if (hints.employmentType) out.employmentType = hints.employmentType;
  if (hints.remoteType) out.remoteType = hints.remoteType;
  if (hints.salaryMin !== undefined || hints.salaryMax !== undefined) {
    out.salaryMin = hints.salaryMin ?? null;
    out.salaryMax = hints.salaryMax ?? null;
    out.salaryCurrency = hints.salaryCurrency ?? out.salaryCurrency;
    out.salaryPeriod = hints.salaryPeriod ?? out.salaryPeriod;
  }
  return out;
}

export async function extractJob(
  text: string,
  hints: Hints = {},
): Promise<{ extraction: JobExtraction; model: string }> {
  const model = env().EXTRACTION_MODEL;
  const known = Object.entries(hints)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
  const user = `${known ? `Known fields (reliable, from the source):\n${known}\n\n` : ""}Job posting:\n\n${text.slice(0, MAX_CHARS)}`;
  const extraction = await chatStructured(JobExtractionSchema, { system: SYSTEM, user }, { model });
  return { extraction: mergeHints(extraction, hints), model };
}
