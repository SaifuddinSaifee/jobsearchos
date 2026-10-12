import { z } from "zod";

// No `.default()`: JobExtractionSchema is also the structured-output schema for the LLM,
// which needs every field present. Unknown text is "" and unknown numbers are null.

export const REMOTE_TYPES = ["remote", "hybrid", "onsite", "unknown"] as const;

/** One group of other posting details, e.g. "Benefits" or "Interview process". */
export const AdditionalDetailSchema = z.object({
  heading: z.string(),
  items: z.array(z.string()),
});
export type AdditionalDetail = z.infer<typeof AdditionalDetailSchema>;

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
  additionalDetails: z.array(AdditionalDetailSchema),
  technologies: z.array(z.string()),
  keywords: z.array(z.string()),
});
export type JobExtraction = z.infer<typeof JobExtractionSchema>;

const Line = z.string().max(2_000);
const Lines = z.array(Line).max(200);

/** What the user can change on a saved job. Company and title are required. */
export const JobEditSchema = JobExtractionSchema.extend({
  company: z.string().trim().min(1, "Enter a company").max(200),
  title: z.string().trim().min(1, "Enter a title").max(300),
  location: z.string().max(300),
  employmentType: z.string().max(100),
  salaryCurrency: z.string().max(10),
  salaryPeriod: z.string().max(20),
  postedAt: z.string().max(10),
  applicationUrl: z.string().max(2_000),
  aboutCompany: z.string().max(20_000),
  responsibilities: Lines,
  requirements: z.object({ required: Lines, preferred: Lines }),
  additionalDetails: z.array(z.object({ heading: z.string().max(200), items: Lines })).max(50),
  technologies: z.array(z.string().max(100)).max(100),
  keywords: z.array(z.string().max(100)).max(100),
});
export type JobEdit = z.infer<typeof JobEditSchema>;

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
  sources: z.array(z.object({ url: z.string(), title: z.string(), kind: z.enum(["owned", "third-party"]).optional() })),
  /** Which tier produced it: the company's own site (free) or a web search. */
  via: z.enum(["company-site", "web-search"]).optional(),
  log: z
    .object({
      via: z.enum(["company-site", "web-search"]),
      queries: z.array(z.string()),
      pages: z.array(
        z.object({
          url: z.string(),
          title: z.string(),
          kind: z.enum(["owned", "third-party"]),
          origin: z.enum(["site", "search"]),
        }),
      ),
    })
    .optional(),
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
  /** Optional: model output from before additional details existed has no such field. */
  normalized: JobExtractionSchema.partial({ additionalDetails: true }),
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
    additionalDetails: [],
    technologies: [],
    keywords: [],
  };
}
