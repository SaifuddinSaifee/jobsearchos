// Client-safe: no database imports, so components can use these.

export const CONTACT_KINDS = ["founder", "hiring_manager", "team_lead", "engineer", "technical_recruiter", "recruiter", "other"] as const;
export type ContactKind = (typeof CONTACT_KINDS)[number];

export const KIND_LABEL: Record<ContactKind, string> = {
  founder: "Founder",
  hiring_manager: "Hiring manager",
  team_lead: "Team lead",
  engineer: "Engineer",
  technical_recruiter: "Technical recruiter",
  recruiter: "Recruiter",
  other: "Other",
};

export const CONTACT_SOURCES = ["posting", "yc", "web", "prospeo", "manual"] as const;
export type ContactSource = (typeof CONTACT_SOURCES)[number];

/** `risky`: the mail server accepts anything or the address is a webmail, so delivery cannot be confirmed. */
export type EmailStatus = "verified" | "risky" | "unverified" | "invalid" | "none";

export const STATUS_LABEL: Record<EmailStatus, string> = {
  verified: "Verified",
  risky: "Risky",
  unverified: "Unverified",
  invalid: "Invalid",
  none: "No email",
};

export type ContactDTO = {
  id: string;
  name: string;
  title: string;
  email: string | null;
  emailStatus: EmailStatus;
  confidence: number | null;
  source: ContactSource;
  linkedinUrl: string | null;
  /** The finder knows this person, so their email can be revealed without a name search. */
  hasLookupId: boolean;
  /** A short bio or headline, when one is known. */
  about: string;
  /** Where the email address came from, for display. */
  emailSource: string | null;
  kind: ContactKind;
  /** 1 is the best match for this job; null for people added by hand. */
  rank: number | null;
  /** Why this person was ranked where they were. */
  reason: string;
  doNotContact: boolean;
  /** Emails already sent to this person for this job. */
  sentCount: number;
};

export type OutreachStatus = "draft" | "sending" | "sent" | "failed";

/** A file that was attached to a sent email. Files never change once stored, so this is exactly what was sent. */
export type AttachmentDTO = { fileId: string; name: string; size: number; mime: string };

/**
 * A library resume that can go with an email. `source` says what actually gets attached: the original file of an
 * upload nobody has edited since ("file"), or a PDF made from the resume's text when the email is sent ("pdf").
 * `size` and `fileId` are only known once the file exists (always for "file", after preparing for "pdf").
 */
export type ResumeOption = {
  documentId: string;
  /** Why it is offered: the base resume, written for this job, or elsewhere in the library. */
  kind: "base" | "job" | "past";
  label: string;
  source: "file" | "pdf";
  /** The name the attachment goes out with (a good guess until the PDF is made). */
  name: string;
  size: number | null;
  mime: string;
  fileId: string | null;
  /** Pages in the PDF, once it has been made. */
  pages?: number | null;
};

/** The attachment chosen for a draft is one of the options. */
export type DraftAttachmentDTO = ResumeOption;

/** An attached file as sent, with the library version it was made from. */
export type SentAttachmentDTO = AttachmentDTO & { documentId: string | null; versionId: string | null; version: number | null };

/** Above this a resume is probably an unoptimised export, and big attachments are more likely to be filtered. */
export const BIG_ATTACHMENT_BYTES = 1024 * 1024;

export function formatBytes(n: number | null | undefined): string {
  if (n === null || n === undefined) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export type DraftDTO = {
  id: string;
  contactId: string | null;
  subject: string;
  body: string;
  attachment: DraftAttachmentDTO | null;
  updatedAt: string;
};

export type SentDTO = {
  id: string;
  contactId: string | null;
  contactName: string;
  toEmail: string;
  subject: string;
  body: string;
  threadId: string | null;
  attachment: SentAttachmentDTO | null;
  sentAt: string;
};

export const MAX_SUBJECT = 300;
export const MAX_BODY = 20_000;

// ---------------------------------------------------------------- background searches

export type SearchStatus = "queued" | "running" | "done" | "failed";

export const SEARCH_STEPS = ["yc", "posting", "web", "prospeo", "rank", "email"] as const;
export type SearchStepName = (typeof SEARCH_STEPS)[number];

export const SEARCH_STEP_LABEL: Record<SearchStepName, string> = {
  yc: "Check Y Combinator",
  email: "Find the best match's email",
  posting: "Read the posting",
  web: "Search the web",
  prospeo: "Search Prospeo",
  rank: "Rank the people",
};

export type SearchStepState = { status: "running" | "done" | "skipped" | "failed"; detail?: string };
export type SearchSteps = Partial<Record<SearchStepName, SearchStepState>>;

/** One "find people" run for a job, as shown by the page, the sidebar and the toasts. */
export type SearchItem = {
  id: string;
  jobId: string;
  /** "Company - Title" of the job. */
  label: string;
  status: SearchStatus;
  steps: SearchSteps;
  found: number | null;
  notes: string[];
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
};

export const isSearchActive = (s: Pick<SearchItem, "status"> | null | undefined) => s?.status === "queued" || s?.status === "running";

/** 0 to 1: how many steps have finished (skipped counts as finished). */
export function searchProgress(steps: SearchSteps): number {
  return SEARCH_STEPS.filter((n) => steps[n] && steps[n]!.status !== "running").length / SEARCH_STEPS.length;
}
