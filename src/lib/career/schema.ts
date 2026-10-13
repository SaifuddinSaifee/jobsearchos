import { z } from "zod";

/**
 * The career record: everything the user has done, merged from every resume, cover letter, the Profile and a
 * LinkedIn print. One record is one immutable version row (see `career_record_versions`), so a merge is a pure
 * function from record to record and any version can be restored.
 *
 * No `.default()` anywhere, so a stored record always has every field and the schema can be reused for structured
 * model output if that is ever needed. Empty values come from `emptyRecord()`.
 */

/** Where a thing came from: a career source, and the editor block it was read from when there is one. */
export const SourceRefSchema = z.object({
  sourceId: z.uuid(),
  blockId: z.string().nullable(),
});

/**
 * `origin` says who created the item. `user` lists the fields the user has edited by hand; a later merge never
 * overwrites those (same rule as company profiles).
 */
export const ProvenanceSchema = z.object({
  origin: z.enum(["merge", "user"]),
  user: z.array(z.string()),
});

const Tracked = {
  sources: z.array(SourceRefSchema),
  provenance: ProvenanceSchema,
};

export const WORDING_FORMS = ["bullet", "paragraph"] as const;

export const WordingSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  /** The framing this wording was written for, or null when it is not tied to one. */
  framingId: z.string().nullable(),
  /** A paragraph is a cover letter story, a bullet is a resume line. */
  form: z.enum(WORDING_FORMS),
  ...Tracked,
});

/** One accomplishment or responsibility, with every way it has been worded. */
export const FactSchema = z.object({
  id: z.string().min(1),
  wordings: z.array(WordingSchema),
  provenance: ProvenanceSchema,
});

/** The same role told from one angle: its own title and the target roles of the documents it came from. */
export const FramingSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  /** "Product", "Engineering", ... or empty when unknown. */
  angle: z.string(),
  targetRoles: z.array(z.string()),
  ...Tracked,
});

export const RoleSchema = z.object({
  id: z.string().min(1),
  start: z.string(),
  end: z.string(),
  current: z.boolean(),
  location: z.string(),
  /** Date disagreements between sources, e.g. 'Resume "PM Acme" says Feb 2020 - Mar 2022'. Never blocks a merge. */
  dateNotes: z.array(z.string()),
  framings: z.array(FramingSchema),
  facts: z.array(FactSchema),
  ...Tracked,
});

export const EmployerSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** Linked with `findCompanyByName` only; employers never create rows in the companies directory. */
  companyId: z.uuid().nullable(),
  /** Every spelling seen, used for matching. */
  names: z.array(z.string()),
  roles: z.array(RoleSchema),
  ...Tracked,
});

export const SkillSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  category: z.string(),
  ...Tracked,
});

export const ProjectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  url: z.string(),
  technologies: z.array(z.string()),
  wordings: z.array(WordingSchema),
  ...Tracked,
});

export const EducationSchema = z.object({
  id: z.string().min(1),
  institution: z.string().min(1),
  degree: z.string(),
  field: z.string(),
  start: z.string(),
  end: z.string(),
  details: z.string(),
  ...Tracked,
});

export const CertificationSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  issuer: z.string(),
  date: z.string(),
  ...Tracked,
});

export const AchievementSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  ...Tracked,
});

/** A reason for applying, from a cover letter. The company comes from the document, never from the model. */
export const MotivationSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  scope: z.enum(["company", "general"]),
  companyId: z.uuid().nullable(),
  companyName: z.string(),
  ...Tracked,
});

export const REMOVED_KINDS = [
  "employer",
  "role",
  "framing",
  "fact",
  "wording",
  "skill",
  "project",
  "education",
  "certification",
  "achievement",
  "motivation",
] as const;
export type RecordItemKind = (typeof REMOVED_KINDS)[number];

/** A tombstone: something the user deleted. A later merge that brings it back proposes leaving it out. */
export const RemovedSchema = z.object({
  kind: z.enum(REMOVED_KINDS),
  /** Normalized text or name, enough to recognise the same thing coming back. */
  key: z.string(),
  at: z.string(),
});

export const CareerRecordSchema = z.object({
  employers: z.array(EmployerSchema),
  skills: z.array(SkillSchema),
  projects: z.array(ProjectSchema),
  education: z.array(EducationSchema),
  certifications: z.array(CertificationSchema),
  achievements: z.array(AchievementSchema),
  motivations: z.array(MotivationSchema),
  removed: z.array(RemovedSchema),
});

export type SourceRef = z.infer<typeof SourceRefSchema>;
export type Provenance = z.infer<typeof ProvenanceSchema>;
export type Wording = z.infer<typeof WordingSchema>;
export type Fact = z.infer<typeof FactSchema>;
export type Framing = z.infer<typeof FramingSchema>;
export type Role = z.infer<typeof RoleSchema>;
export type Employer = z.infer<typeof EmployerSchema>;
export type Skill = z.infer<typeof SkillSchema>;
export type Project = z.infer<typeof ProjectSchema>;
export type Education = z.infer<typeof EducationSchema>;
export type Certification = z.infer<typeof CertificationSchema>;
export type Achievement = z.infer<typeof AchievementSchema>;
export type Motivation = z.infer<typeof MotivationSchema>;
export type Removed = z.infer<typeof RemovedSchema>;
export type CareerRecord = z.infer<typeof CareerRecordSchema>;

export const RECORD_SCHEMA_VERSION = 1;

export function emptyRecord(): CareerRecord {
  return {
    employers: [],
    skills: [],
    projects: [],
    education: [],
    certifications: [],
    achievements: [],
    motivations: [],
    removed: [],
  };
}

export function mergeProvenance(): Provenance {
  return { origin: "merge", user: [] };
}

export const RECORD_VERSION_REASONS = ["merge", "edit", "restore"] as const;
export type RecordVersionReason = (typeof RECORD_VERSION_REASONS)[number];

export const PROPOSAL_STATUSES = [
  "queued",
  "running",
  "ready",
  "applied",
  "dismissed",
  "superseded",
  "failed",
  "undone",
  /** Set aside by the user before it was reviewed. It waits until they ask for it to be prepared. */
  "skipped",
] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export const SOURCE_KINDS = ["resume", "cover_letter", "profile", "linkedin"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

/** True for statuses that still need work or a decision, so the UI keeps polling. */
export function isProposalActive(status: ProposalStatus): boolean {
  return status === "queued" || status === "running";
}
