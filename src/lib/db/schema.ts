import {
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
export type CompanySource = { url: string; title: string };

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

export type JobRow = typeof jobs.$inferSelect;
export type CompanyRow = typeof companies.$inferSelect;
export type ProfileVersionRow = typeof profileVersions.$inferSelect;
export type PastResumeRow = typeof pastResumes.$inferSelect;
export type FileRow = typeof files.$inferSelect;
