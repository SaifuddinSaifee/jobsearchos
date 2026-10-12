import type { JobRequirements } from "@/lib/db/schema";
import type { CompanyProfile } from "@/lib/companies/types";
import type { AdditionalDetail } from "./schema";
import type { ApplicationStatus } from "./status";

// Client-safe: no database imports here, so components can import these without bundling the driver.

export const MAX_NOTES = 10_000;
export const MAX_BULK = 500;

/** One table row. Dates are ISO strings so the row can cross the server/client boundary. */
export type JobRow = {
  jobId: string;
  applicationId: string;
  company: string;
  title: string;
  location: string;
  remoteType: string;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  salaryPeriod: string | null;
  status: ApplicationStatus;
  appliedAt: string | null;
  postedAt: string | null;
  createdAt: string;
  lastChangeAt: string;
  employmentType: string | null;
  source: string;
  postingUrl: string | null;
  applyUrl: string | null;
  technologies: string[];
  hasNotes: boolean;
};

export type TimelineEvent = {
  id: string;
  from: ApplicationStatus | null;
  to: ApplicationStatus;
  at: string;
  note: string | null;
};

export type JobDetail = JobRow & {
  notes: string;
  /** What this posting says about the employer. */
  aboutCompany: string;
  /** The shared directory entry for this employer. */
  companyProfile: CompanyProfile | null;
  responsibilities: string[];
  requirements: JobRequirements;
  /** Benefits, interview process and other posting details, grouped under headings. */
  additionalDetails: AdditionalDetail[];
  keywords: string[];
  timeline: TimelineEvent[];
  snapshot: { sourceUrl: string | null; fetchMethod: string; fetchedAt: string; rawText: string } | null;
};

/** What Undo needs to put an application back. `expected` is the status the change set. */
export type PreviousState = {
  applicationId: string;
  status: ApplicationStatus;
  appliedAt: string | null;
  expected: ApplicationStatus;
};


/** What a delete removed, so Undo can bring it back. Companies are the ones left without jobs. */
export type DeletedState = {
  jobIds: string[];
  companies: { id: string; name: string }[];
};
