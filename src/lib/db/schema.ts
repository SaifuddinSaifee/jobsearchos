import {
  index,
  integer,
  jsonb,
  pgTable,
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

export type ProfileVersionRow = typeof profileVersions.$inferSelect;
export type PastResumeRow = typeof pastResumes.$inferSelect;
export type FileRow = typeof files.$inferSelect;
