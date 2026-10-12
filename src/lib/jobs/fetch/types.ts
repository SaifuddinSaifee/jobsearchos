export type FetchMethodName =
  | "greenhouse"
  | "lever"
  | "ashby"
  | "workday"
  | "smartrecruiters"
  | "workable"
  | "jsonld"
  | "html"
  | "playwright"
  | "paste";

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

/** Fields an ATS API or JSON-LD gives reliably; these override the LLM's values. */
export type Hints = Partial<{
  title: string;
  company: string;
  location: string;
  postedAt: string;
  employmentType: string;
  remoteType: "remote" | "hybrid" | "onsite" | "unknown";
  salaryMin: number;
  salaryMax: number;
  salaryCurrency: string;
  salaryPeriod: string;
}>;

export type FetchedPosting = {
  method: FetchMethodName;
  sourceUrl: string;
  applicationUrl: string | null;
  ats: string | null;
  atsJobId: string | null;
  raw: { body: string; mime: string };
  text: string;
  hints: Hints;
};

export type FetchStep = {
  step: "detect" | "fetch" | "render" | "structure" | "company";
  status: "running" | "done" | "skipped";
  detail?: string;
};

export type FetchErrorCode = "blocked" | "empty" | "not_found" | "invalid_url";

export class FetchError extends Error {
  constructor(
    public code: FetchErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "FetchError";
  }
}
