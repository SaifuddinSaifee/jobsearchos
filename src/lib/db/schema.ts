import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { ColdEmailSettings } from "@/lib/email/settings-schema";
import type { AdditionalDetail, JobDraft } from "@/lib/jobs/schema";
import type { DocJSON } from "@/lib/documents/build";
import type { PageSettings } from "@/lib/documents/page-settings";
import type { DocumentKind, DocumentOrigin, VersionReason } from "@/lib/documents/types";
import type { LlmCallStatus, RecordedAction, LlmStep } from "@/lib/llm/names";
import type { IndexStatus } from "@/lib/resume/types";
import type {
  CareerRecord,
  ProposalStatus,
  RecordVersionReason,
  SourceKind,
} from "@/lib/career/schema";
import type { ContactKind, ContactSource, EmailStatus, OutreachStatus, SearchStatus, SearchSteps } from "@/lib/outreach/types";
import type { EmailDoc } from "@/lib/outreach/body";
import type {
  GenerationInstructions,
  Preferences,
  Profile,
} from "@/lib/profile/schema";

export const files = pgTable("files", {
  id: uuid("id").primaryKey().defaultRandom(),
  sha256: text("sha256").notNull().unique(),
  mime: text("mime").notNull(),
  size: integer("size").notNull(),
  originalName: text("original_name"),
  path: text("path").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Immutable: a DB trigger rejects UPDATE and DELETE (see drizzle/0001_immutable_profile_versions.sql). */
export const profileVersions = pgTable("profile_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  version: integer("version").notNull().unique(),
  profile: jsonb("profile").$type<Profile>().notNull(),
  preferences: jsonb("preferences").$type<Preferences>().notNull(),
  generationInstructions: jsonb("generation_instructions")
    .$type<GenerationInstructions>()
    .notNull(),
  baseResumeFileId: uuid("base_resume_file_id").references(() => files.id),
  changeNote: text("change_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Stored in Stage 1; chunked and embedded in Stage 5. */
export const pastResumes = pgTable(
  "past_resumes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fileId: uuid("file_id")
      .notNull()
      .references(() => files.id),
    title: text("title").notNull(),
    company: text("company"),
    role: text("role"),
    jdText: text("jd_text"),
    jdUrl: text("jd_url"),
    /** Set when the resume was uploaded for a specific job (for example while attaching it to an email). */
    jobId: uuid("job_id").references(() => jobs.id),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    extractedText: text("extracted_text").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("past_resumes_created_idx").on(t.createdAt)],
);

export const jobStatus = pgEnum("job_status", ["discovered", "saved", "ignored"]);
export const jobOrigin = pgEnum("job_origin", ["manual", "discovery"]);
export const remoteType = pgEnum("remote_type", ["remote", "hybrid", "onsite", "unknown"]);
export const fetchMethod = pgEnum("fetch_method", [
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
]);
export const keywordKind = pgEnum("keyword_kind", ["extracted", "expanded"]);
export const applicationStatus = pgEnum("application_status", [
  "saved",
  "preparing",
  "applied",
  "recruiter_screen",
  "interview",
  "technical_interview",
  "final_interview",
  "offer",
  "rejected",
  "withdrawn",
  "ghosted",
]);

export type JobRequirements = { required: string[]; preferred: string[] };

export type CompanyField = "about" | "principles" | "culture";
export type CompanyProvenance = Partial<Record<CompanyField, "posting" | "web" | "user">>;
export type CompanySource = { url: string; title: string; kind?: "owned" | "third-party" };

/** What a research run looked at, kept so it can be inspected later. */
export type CompanyResearchLog = {
  via: "company-site" | "web-search";
  queries: string[];
  pages: { url: string; title: string; kind: "owned" | "third-party"; origin: "site" | "search" }[];
};

/**
 * One row per employer, shared by every job there. The text fields are Markdown. `provenance` records
 * who last wrote each field; a field marked "user" is never overwritten by automated research.
 * Deleting is soft (`deleted_at`); names only have to be unique among companies that are not deleted.
 */
export const companies = pgTable(
  "companies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    website: text("website").notNull().default(""),
    about: text("about").notNull().default(""),
    principles: text("principles").notNull().default(""),
    culture: text("culture").notNull().default(""),
    notes: text("notes").notNull().default(""),
    provenance: jsonb("provenance").$type<CompanyProvenance>().notNull().default({}),
    sources: jsonb("sources").$type<CompanySource[]>().notNull().default([]),
    researchLog: jsonb("research_log").$type<CompanyResearchLog | null>(),
    /** The group this company belongs to (YouTube is part of Google). One level is enough for exports. */
    parentId: uuid("parent_id").references((): AnyPgColumn => companies.id, { onDelete: "set null" }),
    researchedAt: timestamp("researched_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("companies_normalized_name_live_idx").on(t.normalizedName).where(sql`deleted_at is null`)],
);

/** Other names that mean the same company (e.g. "YouTube" -> Google). */
export const companyAliases = pgTable("company_aliases", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  alias: text("alias").notNull(),
  normalizedAlias: text("normalized_alias").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * `search_vector` (generated tsvector + GIN index) is added in the 0002 SQL migration. Deleting is soft
 * (`deleted_at`); the URL and dedup key only have to be unique among jobs that are not deleted, so a
 * deleted job can be added again.
 */
export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    canonicalUrl: text("canonical_url"),
    applicationUrl: text("application_url"),
    ats: text("ats"),
    atsJobId: text("ats_job_id"),
    company: text("company").notNull(),
    /** Link to the shared directory entry; null only for jobs saved before the directory existed. */
    companyId: uuid("company_id").references(() => companies.id),
    /** What this posting itself says about the employer (copied as written). */
    aboutCompany: text("about_company").notNull().default(""),
    title: text("title").notNull(),
    location: text("location").notNull().default(""),
    remoteType: remoteType("remote_type").notNull().default("unknown"),
    employmentType: text("employment_type"),
    salaryMin: integer("salary_min"),
    salaryMax: integer("salary_max"),
    salaryCurrency: text("salary_currency"),
    salaryPeriod: text("salary_period"),
    postedAt: date("posted_at"),
    responsibilities: jsonb("responsibilities").$type<string[]>().notNull(),
    requirements: jsonb("requirements").$type<JobRequirements>().notNull(),
    /** Everything else worth keeping from the posting (benefits, interview process...), grouped under headings. */
    additionalDetails: jsonb("additional_details").$type<AdditionalDetail[]>().notNull().default([]),
    technologies: text("technologies").array().notNull(),
    origin: jobOrigin("origin").notNull().default("manual"),
    status: jobStatus("status").notNull().default("saved"),
    dedupKey: text("dedup_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("jobs_created_idx").on(t.createdAt),
    index("jobs_company_idx").on(t.companyId),
    uniqueIndex("jobs_canonical_url_live_idx").on(t.canonicalUrl).where(sql`deleted_at is null`),
    uniqueIndex("jobs_dedup_key_live_idx").on(t.dedupKey).where(sql`deleted_at is null`),
  ],
);

/** Immutable: a DB trigger rejects UPDATE and DELETE (see drizzle/0002_jobs.sql). */
export const jobSnapshots = pgTable("job_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  jobId: uuid("job_id")
    .notNull()
    .references(() => jobs.id),
  sourceUrl: text("source_url"),
  fetchMethod: fetchMethod("fetch_method").notNull(),
  rawFileId: uuid("raw_file_id").references(() => files.id),
  rawText: text("raw_text").notNull(),
  normalized: jsonb("normalized").notNull(),
  model: text("model").notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
});

export const jobKeywords = pgTable(
  "job_keywords",
  {
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id),
    keyword: text("keyword").notNull(),
    kind: keywordKind("kind").notNull(),
  },
  (t) => [primaryKey({ columns: [t.jobId, t.keyword, t.kind] })],
);

export const applications = pgTable("applications", {
  id: uuid("id").primaryKey().defaultRandom(),
  jobId: uuid("job_id")
    .notNull()
    .unique()
    .references(() => jobs.id),
  status: applicationStatus("status").notNull().default("saved"),
  appliedAt: timestamp("applied_at", { withTimezone: true }),
  applicationUrl: text("application_url"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const statusEvents = pgTable("status_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  applicationId: uuid("application_id")
    .notNull()
    .references(() => applications.id),
  fromStatus: applicationStatus("from_status"),
  toStatus: applicationStatus("to_status").notNull(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  note: text("note"),
});

export const queueStatus = pgEnum("queue_status", ["queued", "running", "saved", "needs_review", "duplicate", "failed"]);

export type QueueStepName = "detect" | "fetch" | "render" | "structure" | "company";
export type QueueSteps = Partial<Record<QueueStepName, { status: "running" | "done" | "skipped"; detail?: string }>>;

/**
 * Job URLs / pasted postings waiting to be turned into saved jobs. A worker inside the app server processes
 * them in the background, so work survives page changes and closed tabs. `draft` is kept only while the
 * result needs a human (status needs_review); a saved item points at its job instead.
 */
export const applicationQueue = pgTable(
  "application_queue",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").$type<"url" | "text">().notNull(),
    /** The job URL, or the pasted posting text. */
    input: text("input").notNull(),
    /** For pasted text: an optional URL used for de-duplication. */
    sourceUrl: text("source_url"),
    /** What to show in lists: the URL, then "Company - Title" once known. */
    label: text("label").notNull(),
    status: queueStatus("status").notNull().default("queued"),
    steps: jsonb("steps").$type<QueueSteps>().notNull().default({}),
    draft: jsonb("draft").$type<JobDraft>(),
    error: text("error"),
    errorCode: text("error_code"),
    jobId: uuid("job_id").references(() => jobs.id),
    duplicateJobId: uuid("duplicate_job_id").references(() => jobs.id),
    attempts: integer("attempts").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    /** Doubles as the worker's heartbeat while an item is running. */
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("application_queue_status_idx").on(t.status, t.createdAt)],
);

/** Bookmarks for the job boards and career pages visited every day; `last_opened_at` drives the daily round. */
export const quickLinks = pgTable(
  "quick_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    url: text("url").notNull(),
    note: text("note").notNull().default(""),
    /** Optional heading the link is shown under, e.g. "Job boards". */
    group: text("group").notNull().default(""),
    position: integer("position").notNull().default(0),
    lastOpenedAt: timestamp("last_opened_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("quick_links_position_idx").on(t.position)],
);

/** App-wide configuration. One row (`id = 'default'`); unlike profile versions, edits overwrite. */
export const appSettings = pgTable("app_settings", {
  id: text("id").primaryKey(),
  coldEmail: jsonb("cold_email").$type<ColdEmailSettings>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** A connected mail account. Tokens are AES-GCM encrypted. Disconnecting is soft (`disconnected_at`). */
export const emailAccounts = pgTable(
  "email_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").$type<"gmail">().notNull(),
    email: text("email").notNull(),
    scopes: text("scopes").array().notNull(),
    refreshTokenEnc: text("refresh_token_enc").notNull(),
    accessTokenEnc: text("access_token_enc"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    /** Set when Google rejected the refresh token (revoked, or expired in Testing mode); the user must reconnect. */
    needsReconnect: boolean("needs_reconnect").notNull().default(false),
    connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
    disconnectedAt: timestamp("disconnected_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("email_accounts_one_active_idx")
      .on(t.provider)
      .where(sql`${t.disconnectedAt} is null`),
  ],
);

/** People who could receive the cold email for one job: found by lookup, named in the posting, or added by hand. */
export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id),
    name: text("name").notNull(),
    title: text("title").notNull().default(""),
    email: text("email"),
    emailStatus: text("email_status").$type<EmailStatus>().notNull().default("none"),
    confidence: integer("confidence"),
    source: text("source").$type<ContactSource>().notNull(),
    linkedinUrl: text("linkedin_url"),
    /** The finder's own id for this person (Prospeo's person_id), used to reveal their email. */
    providerId: text("provider_id"),
    /** A short bio or headline (for example a founder's Y Combinator bio). */
    about: text("about").notNull().default(""),
    /** Where the address came from: "Prospeo", "Seen publicly at github.com", "Added by you"... */
    emailSource: text("email_source"),
    kind: text("kind").$type<ContactKind>().notNull().default("other"),
    rank: integer("rank"),
    reason: text("reason").notNull().default(""),
    doNotContact: boolean("do_not_contact").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("contacts_job_idx").on(t.jobId),
    index("contacts_email_idx").on(sql`lower(${t.email})`),
    uniqueIndex("contacts_job_email_live_idx")
      .on(t.jobId, sql`lower(${t.email})`)
      .where(sql`${t.deletedAt} is null and ${t.email} is not null`),
  ],
);

/** One working draft per job (`status = 'draft'`); sending turns the draft into a sent record. */
export const outreachEmails = pgTable(
  "outreach_emails",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id),
    contactId: uuid("contact_id").references(() => contacts.id),
    toEmail: text("to_email"),
    subject: text("subject").notNull().default(""),
    /** The plain-text version: what the checks read and what plain-text mail clients show. */
    body: text("body").notNull().default(""),
    /** The body with its formatting (bold, italic, underline, links), when it was written in the composer's editor. */
    bodyDoc: jsonb("body_doc").$type<EmailDoc>(),
    status: text("status").$type<OutreachStatus>().notNull().default("draft"),
    gmailMessageId: text("gmail_message_id"),
    gmailThreadId: text("gmail_thread_id"),
    error: text("error"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("outreach_emails_job_idx").on(t.jobId, t.status),
    uniqueIndex("outreach_emails_one_draft_idx")
      .on(t.jobId)
      .where(sql`${t.status} = 'draft'`),
    index("outreach_emails_sent_idx").on(t.sentAt),
  ],
);

/**
 * What goes with an email, in the order chosen. Either a library document (a resume or cover letter, sent as its
 * original upload or as a PDF made at send time) or a file uploaded only for this email. `file_id` is what was, or will
 * be, sent: files are content-addressed and never changed, so on a sent email it is exactly what went out.
 */
export const outreachAttachments = pgTable(
  "outreach_attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    emailId: uuid("email_id")
      .notNull()
      .references(() => outreachEmails.id),
    position: integer("position").notNull(),
    documentId: uuid("document_id").references((): AnyPgColumn => documents.id),
    fileId: uuid("file_id").references(() => files.id),
    /** The library version a document attachment was made from, once prepared. */
    versionId: uuid("version_id").references((): AnyPgColumn => documentVersions.id),
    /** The name a PDF made at send time goes out with. Null means the file's own name. */
    name: text("name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("outreach_attachments_email_idx").on(t.emailId, t.position),
    index("outreach_attachments_file_idx").on(t.fileId),
    uniqueIndex("outreach_attachments_email_document_idx")
      .on(t.emailId, t.documentId)
      .where(sql`${t.documentId} is not null`),
    uniqueIndex("outreach_attachments_email_file_idx")
      .on(t.emailId, t.fileId)
      .where(sql`${t.documentId} is null`),
    check("outreach_attachments_has_source", sql`${t.documentId} is not null or ${t.fileId} is not null`),
  ],
);

export type OutreachAttachmentRow = typeof outreachAttachments.$inferSelect;

/**
 * "Find people" runs waiting for, or being handled by, the background worker (the same one that processes the job
 * queue), so a search keeps going when the page is closed. At most one is active per job.
 */
export const contactSearches = pgTable(
  "contact_searches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id),
    status: text("status").$type<SearchStatus>().notNull().default("queued"),
    steps: jsonb("steps").$type<SearchSteps>().notNull().default({}),
    found: integer("found"),
    notes: jsonb("notes").$type<string[]>().notNull().default([]),
    error: text("error"),
    attempts: integer("attempts").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    /** Doubles as the worker's heartbeat while a search is running. */
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("contact_searches_status_idx").on(t.status, t.createdAt),
    index("contact_searches_job_idx").on(t.jobId, t.createdAt),
    uniqueIndex("contact_searches_one_active_idx")
      .on(t.jobId)
      .where(sql`${t.status} in ('queued', 'running')`),
  ],
);

/**
 * Everything the user writes: resumes, cover letters and emails, stored as content (an editor document), not as files.
 * The base resume is the one with `is_base`. Deleting is soft (`deleted_at`). `legacy_past_resume_id` and
 * `outreach_email_id` tie a row to what it was made from, so the backfill can run again without duplicating.
 */
export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").$type<DocumentKind>().notNull(),
    origin: text("origin").$type<DocumentOrigin>().notNull(),
    title: text("title").notNull(),
    jobId: uuid("job_id").references(() => jobs.id),
    companyId: uuid("company_id").references(() => companies.id),
    /** Free-text company, for documents that are not linked to a company in the directory. */
    companyName: text("company_name"),
    targetRole: text("target_role"),
    writtenOn: date("written_on", { mode: "string" }),
    jdText: text("jd_text"),
    jdUrl: text("jd_url"),
    isBase: boolean("is_base").notNull().default(false),
    /** The uploaded file's name, type and hash (to spot the same upload twice). The bytes are not kept. */
    sourceName: text("source_name"),
    sourceMime: text("source_mime"),
    sourceSha256: text("source_sha256"),
    /** Set only when the file is kept anyway: imported past resumes and resumes uploaded in the email composer. */
    sourceFileId: uuid("source_file_id").references(() => files.id),
    pageSettings: jsonb("page_settings").$type<Partial<PageSettings>>().notNull().default({}),
    legacyPastResumeId: uuid("legacy_past_resume_id")
      .unique()
      .references(() => pastResumes.id),
    outreachEmailId: uuid("outreach_email_id")
      .unique()
      .references((): AnyPgColumn => outreachEmails.id),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("documents_one_base_idx")
      .on(t.isBase)
      .where(sql`${t.isBase} and ${t.deletedAt} is null`),
    index("documents_kind_idx").on(t.kind, t.updatedAt),
    index("documents_job_idx").on(t.jobId),
    index("documents_source_sha_idx").on(t.sourceSha256),
    check("documents_base_is_resume", sql`not ${t.isBase} or ${t.kind} = 'resume'`),
  ],
);

/** The working copy the editor autosaves into. Overwritten freely; `revision` lets a stale tab be refused. */
export const documentDrafts = pgTable("document_drafts", {
  documentId: uuid("document_id")
    .primaryKey()
    .references(() => documents.id),
  content: jsonb("content").$type<DocJSON>().notNull(),
  subject: text("subject").notNull().default(""),
  revision: integer("revision").notNull().default(1),
  /** The version this draft started from. */
  baseVersionId: uuid("base_version_id"),
  contentSha256: text("content_sha256").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Immutable checkpoints of a document. A DB trigger rejects DELETE and every UPDATE except locking (setting
 * `locked_at` and `locked_job_id` once); see drizzle/0015_documents.sql. `search_vector` is a generated column
 * added in that migration.
 */
export const documentVersions = pgTable(
  "document_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id),
    version: integer("version").notNull(),
    content: jsonb("content").$type<DocJSON>().notNull(),
    contentSchema: integer("content_schema").notNull().default(1),
    subject: text("subject").notNull().default(""),
    markdown: text("markdown").notNull(),
    plainText: text("plain_text").notNull(),
    contentSha256: text("content_sha256").notNull(),
    /** The page settings this version was made with. The PDF depends on them, so they are part of the snapshot. */
    pageSettings: jsonb("page_settings").$type<Partial<PageSettings>>().notNull().default({}),
    reason: text("reason").$type<VersionReason>().notNull(),
    note: text("note"),
    restoredFromVersionId: uuid("restored_from_version_id"),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedJobId: uuid("locked_job_id").references(() => jobs.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("document_versions_doc_version_idx").on(t.documentId, t.version)],
);

export type DocumentRow = typeof documents.$inferSelect;
export type DocumentDraftRow = typeof documentDrafts.$inferSelect;
export type DocumentVersionRow = typeof documentVersions.$inferSelect;

/**
 * Where each resume (a version of a library document) is in the search-index pipeline: split it into sections,
 * embed them. One row per document version, worked off by the same background worker as the job queue. Rows keyed
 * by `file_id` are from before the library existed; they are kept as they were and no longer used.
 */
export const resumeIndexes = pgTable(
  "resume_indexes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fileId: uuid("file_id").references(() => files.id),
    documentVersionId: uuid("document_version_id").references(() => documentVersions.id),
    status: text("status").$type<IndexStatus>().notNull().default("queued"),
    /** The resume as structured data (read back from the document, no model call). */
    parsed: jsonb("parsed").$type<Profile>(),
    /** Something worth telling the user even though indexing succeeded. */
    note: text("note"),
    error: text("error"),
    chunkCount: integer("chunk_count").notNull().default(0),
    embeddingModel: text("embedding_model"),
    attempts: integer("attempts").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    /** Doubles as the worker's heartbeat while indexing is running. */
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("resume_indexes_status_idx").on(t.status, t.createdAt),
    uniqueIndex("resume_indexes_file_idx")
      .on(t.fileId)
      .where(sql`${t.fileId} is not null`),
    uniqueIndex("resume_indexes_version_idx")
      .on(t.documentVersionId)
      .where(sql`${t.documentVersionId} is not null`),
    check("resume_indexes_one_key", sql`num_nonnulls(${t.fileId}, ${t.documentVersionId}) = 1`),
  ],
);

/** One searchable piece of a resume (a job, a project, the skills list...) with its embedding. */
export const resumeChunks = pgTable(
  "resume_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fileId: uuid("file_id").references(() => files.id),
    documentVersionId: uuid("document_version_id").references(() => documentVersions.id),
    ordinal: integer("ordinal").notNull(),
    section: text("section").notNull(),
    label: text("label").notNull(),
    text: text("text").notNull(),
    embedding: vector("embedding", { dimensions: 1024 }).notNull(),
    embeddingModel: text("embedding_model").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("resume_chunks_file_ordinal_idx")
      .on(t.fileId, t.ordinal)
      .where(sql`${t.fileId} is not null`),
    uniqueIndex("resume_chunks_version_ordinal_idx")
      .on(t.documentVersionId, t.ordinal)
      .where(sql`${t.documentVersionId} is not null`),
    index("resume_chunks_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
    check("resume_chunks_one_key", sql`num_nonnulls(${t.fileId}, ${t.documentVersionId}) = 1`),
  ],
);

/**
 * The career record, one immutable snapshot per version (a trigger rejects UPDATE and DELETE, see
 * drizzle/0017_career_record.sql). Restoring saves an old record as a new version.
 */
export const careerRecordVersions = pgTable("career_record_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  version: integer("version").notNull().unique(),
  record: jsonb("record").$type<CareerRecord>().notNull(),
  recordSchema: integer("record_schema").notNull().default(1),
  reason: text("reason").$type<RecordVersionReason>().notNull(),
  changeNote: text("change_note"),
  /** The reviewed proposal this version came from (no foreign key: proposals are mutable, versions are not). */
  proposalId: uuid("proposal_id"),
  restoredFromVersionId: uuid("restored_from_version_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * What has been read into the career record: a library document version, a profile version, or a LinkedIn print
 * (text only, the file is not kept). Never deleted, because wordings in the record point at these rows.
 */
export const careerSources = pgTable(
  "career_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").$type<SourceKind>().notNull(),
    documentId: uuid("document_id").references(() => documents.id),
    documentVersionId: uuid("document_version_id").references(() => documentVersions.id),
    profileVersionId: uuid("profile_version_id").references(() => profileVersions.id),
    /** The cleaned text of a LinkedIn print. Null for every other kind. */
    text: text("text"),
    contentSha256: text("content_sha256").notNull(),
    label: text("label").notNull(),
    targetRole: text("target_role"),
    companyId: uuid("company_id").references(() => companies.id),
    companyName: text("company_name"),
    writtenOn: date("written_on", { mode: "string" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("career_sources_version_idx")
      .on(t.documentVersionId)
      .where(sql`${t.documentVersionId} is not null`),
    uniqueIndex("career_sources_profile_idx")
      .on(t.profileVersionId)
      .where(sql`${t.profileVersionId} is not null`),
    index("career_sources_sha_idx").on(t.kind, t.contentSha256),
    index("career_sources_document_idx").on(t.documentId),
    check(
      "career_sources_key_matches_kind",
      sql`(${t.kind} in ('resume', 'cover_letter')) = (${t.documentVersionId} is not null)
        and (${t.kind} = 'profile') = (${t.profileVersionId} is not null)
        and (${t.kind} = 'linkedin') = (${t.text} is not null)`,
    ),
  ],
);

/**
 * One proposed merge of a source into the record. Doubles as the work queue (worked off by the same background
 * worker as the other queues) and as the review state: `decisions` holds what the user has chosen so far, so a
 * reload loses nothing. Only one proposal may be running or ready at a time, so each is computed against the
 * newest record.
 */
export const careerProposals = pgTable(
  "career_proposals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => careerSources.id),
    status: text("status").$type<ProposalStatus>().notNull().default("queued"),
    /** Lower runs first (base resume, other resumes, profile, LinkedIn, cover letters). */
    priority: integer("priority").notNull().default(1),
    /** The record version this proposal was computed against. */
    baseVersion: integer("base_version"),
    proposal: jsonb("proposal").$type<unknown>(),
    decisions: jsonb("decisions").$type<Record<string, unknown>>().notNull().default({}),
    appliedVersionId: uuid("applied_version_id"),
    attempts: integer("attempts").notNull().default(0),
    note: text("note"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    /** Doubles as the worker's heartbeat while the proposal is being prepared. */
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("career_proposals_status_idx").on(t.status, t.priority, t.createdAt),
    uniqueIndex("career_proposals_source_open_idx")
      .on(t.sourceId)
      .where(sql`${t.status} in ('queued', 'running', 'ready')`),
    uniqueIndex("career_proposals_one_open_idx")
      .on(sql`(1)`)
      .where(sql`${t.status} in ('running', 'ready')`),
  ],
);

/**
 * One row per model call, numbers only: which step and action it was for, the model and settings, token counts, cost,
 * time and outcome. Prompts and replies are never stored here (they live in Phoenix). Kept forever. The ids link a
 * call to what it was for but are deliberately not foreign keys, so usage history survives deleting or merging them.
 * Token columns are null when the provider reported no usage (a rejected, stopped or broken request); `cost_usd` is
 * null when the model has no known price (see src/lib/llm/prices.ts).
 */
export const llmCalls = pgTable(
  "llm_calls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    action: text("action").$type<RecordedAction>().notNull(),
    step: text("step").$type<LlmStep>().notNull(),
    runId: uuid("run_id"),
    model: text("model").notNull(),
    reasoningEffort: text("reasoning_effort"),
    status: text("status").$type<LlmCallStatus>().notNull(),
    error: text("error"),
    finishReason: text("finish_reason"),
    promptTokens: integer("prompt_tokens"),
    cachedTokens: integer("cached_tokens"),
    completionTokens: integer("completion_tokens"),
    reasoningTokens: integer("reasoning_tokens"),
    costUsd: doublePrecision("cost_usd"),
    durationMs: integer("duration_ms").notNull(),
    traceId: text("trace_id"),
    jobId: uuid("job_id"),
    companyId: uuid("company_id"),
    documentId: uuid("document_id"),
    documentVersionId: uuid("document_version_id"),
    proposalId: uuid("proposal_id"),
    searchId: uuid("search_id"),
    queueItemId: uuid("queue_item_id"),
  },
  (t) => [
    index("llm_calls_created_idx").on(t.createdAt),
    index("llm_calls_job_idx").on(t.jobId, t.createdAt).where(sql`${t.jobId} is not null`),
  ],
);

export type CareerRecordVersionRow = typeof careerRecordVersions.$inferSelect;
export type CareerSourceRow = typeof careerSources.$inferSelect;
export type CareerProposalRow = typeof careerProposals.$inferSelect;

export type LlmCallRow = typeof llmCalls.$inferSelect;
export type NewLlmCall = typeof llmCalls.$inferInsert;

export type ResumeIndexRow = typeof resumeIndexes.$inferSelect;
export type ResumeChunkRow = typeof resumeChunks.$inferSelect;

export type ContactSearchRow = typeof contactSearches.$inferSelect;
export type ContactRow = typeof contacts.$inferSelect;
export type OutreachEmailRow = typeof outreachEmails.$inferSelect;
export type EmailAccountRow = typeof emailAccounts.$inferSelect;
export type QueueRow = typeof applicationQueue.$inferSelect;
export type QuickLinkRow = typeof quickLinks.$inferSelect;
export type JobRow = typeof jobs.$inferSelect;
export type CompanyRow = typeof companies.$inferSelect;
export type ProfileVersionRow = typeof profileVersions.$inferSelect;
export type PastResumeRow = typeof pastResumes.$inferSelect;
export type FileRow = typeof files.$inferSelect;
