import {
  type AnyPgColumn,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import type { JobDraft } from "@/lib/jobs/schema";
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
 */
export const companies = pgTable("companies", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  normalizedName: text("normalized_name").notNull().unique(),
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
});

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

/** `search_vector` (generated tsvector + GIN index) is added in the 0002 SQL migration. */
export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    canonicalUrl: text("canonical_url").unique(),
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
    technologies: text("technologies").array().notNull(),
    origin: jobOrigin("origin").notNull().default("manual"),
    status: jobStatus("status").notNull().default("saved"),
    dedupKey: text("dedup_key").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("jobs_created_idx").on(t.createdAt), index("jobs_company_idx").on(t.companyId)],
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

export type QueueRow = typeof applicationQueue.$inferSelect;
export type QuickLinkRow = typeof quickLinks.$inferSelect;
export type JobRow = typeof jobs.$inferSelect;
export type CompanyRow = typeof companies.$inferSelect;
export type ProfileVersionRow = typeof profileVersions.$inferSelect;
export type PastResumeRow = typeof pastResumes.$inferSelect;
export type FileRow = typeof files.$inferSelect;
