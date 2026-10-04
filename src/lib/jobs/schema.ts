import { z } from "zod";

// No `.default()`: JobExtractionSchema is also the structured-output schema for the LLM,
// which needs every field present. Unknown text is "" and unknown numbers are null.

export const REMOTE_TYPES = ["remote", "hybrid", "onsite", "unknown"] as const;

export const JobExtractionSchema = z.object({
  company: z.string(),
  title: z.string(),
  location: z.string(),
  remoteType: z.enum(REMOTE_TYPES),
  employmentType: z.string(),
  salaryMin: z.number().nonnegative().nullable(),
  salaryMax: z.number().nonnegative().nullable(),
  salaryCurrency: z.string(),
  salaryPeriod: z.string(),
  postedAt: z.string(),
  applicationUrl: z.string(),
  aboutCompany: z.string(),
  responsibilities: z.array(z.string()),
  requirements: z.object({
    required: z.array(z.string()),
    preferred: z.array(z.string()),
  }),
  technologies: z.array(z.string()),
  keywords: z.array(z.string()),
});
export type JobExtraction = z.infer<typeof JobExtractionSchema>;

export const FETCH_METHODS = [
  "greenhouse",
  "lever",
  "ashby",
  "workday",
  "smartrecruiters",
  "workable",
  "jsonld",
  "html",
  "playwright",
  "paste",
] as const;

/** What the review form edits plus the provenance needed to save an immutable snapshot. */
export const CompanyResearchSchema = z.object({
  website: z.string(),
  about: z.string(),
  principles: z.string(),
  culture: z.string(),
  sources: z.array(z.object({ url: z.string(), title: z.string() })),
  /** Which tier produced it: the company's own site (free) or a web search. */
  via: z.enum(["company-site", "web-search"]).optional(),
});

export const JobDraftSchema = JobExtractionSchema.extend({
  /** Web research on the employer, found while extracting; applied to the directory on save. */
  companyResearch: CompanyResearchSchema.nullable().optional(),
  /** One line for the review screen about what happened with company research. */
  companyNote: z.string().optional(),
  sourceUrl: z.string(),
  fetchMethod: z.enum(FETCH_METHODS),
  ats: z.string().nullable(),
  atsJobId: z.string().nullable(),
  rawFileId: z.string().nullable(),
  rawText: z.string(),
  /** The model's output before the user's edits (stored in the snapshot). */
  normalized: JobExtractionSchema,
});
export type JobDraft = z.infer<typeof JobDraftSchema>;

export function emptyExtraction(): JobExtraction {
  return {
    company: "",
    title: "",
    location: "",
    remoteType: "unknown",
    employmentType: "",
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: "",
    salaryPeriod: "",
    postedAt: "",
    applicationUrl: "",
    aboutCompany: "",
    responsibilities: [],
    requirements: { required: [], preferred: [] },
    technologies: [],
    keywords: [],
  };
}
