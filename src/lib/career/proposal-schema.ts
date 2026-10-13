import { z } from "zod";

// What a merge proposes, and what the user decides about it. Client-safe: no database or server imports, so the
// review screen can use the same types and the same `resolveDecisions` as the server does when saving.

export const EmployerSuggestionSchema = z.discriminatedUnion("to", [
  z.object({ to: z.literal("existing"), employerId: z.string() }),
  z.object({ to: z.literal("new") }),
]);

export const RoleSuggestionSchema = z.discriminatedUnion("to", [
  /** The same role, told with a framing it already has. */
  z.object({ to: z.literal("same"), roleId: z.string(), framingId: z.string().nullable() }),
  /** The same role and dates under a different title: a new framing of an existing role. */
  z.object({ to: z.literal("framing"), roleId: z.string() }),
  z.object({ to: z.literal("new") }),
]);

/** Why a bullet was linked to a fact: the same editor block, the same words, the model, or the user. */
export const BULLET_WHY = ["lineage", "near", "model", "user"] as const;

export const BulletSuggestionSchema = z.discriminatedUnion("to", [
  /** The exact text is already a wording of this fact; only the source is added. */
  z.object({ to: z.literal("known"), factId: z.string(), wordingId: z.string() }),
  /** Same accomplishment as this fact, new wording. */
  z.object({ to: z.literal("fact"), factId: z.string(), why: z.enum(BULLET_WHY) }),
  /** A new fact. `withKey` makes it the same new fact as another bullet of this role (that bullet's key). */
  z.object({ to: z.literal("new"), withKey: z.string().optional() }),
]);

/** Skills, projects, education, certifications and achievements: already in the record, or new. */
export const SimpleSuggestionSchema = z.discriminatedUnion("to", [
  z.object({ to: z.literal("existing"), id: z.string() }),
  z.object({ to: z.literal("new") }),
]);

export const BulletItemSchema = z.object({
  key: z.string(),
  blockId: z.string().nullable(),
  text: z.string(),
  suggestion: BulletSuggestionSchema,
  removedBefore: z.boolean(),
});

export const RoleItemSchema = z.object({
  key: z.string(),
  blockId: z.string().nullable(),
  title: z.string(),
  start: z.string(),
  end: z.string(),
  current: z.boolean(),
  location: z.string(),
  datesText: z.string(),
  datesReadable: z.boolean(),
  angleGuess: z.string(),
  suggestion: RoleSuggestionSchema,
  /** Other roles at the employer the user may pick instead, closest in time first. */
  candidates: z.array(z.string()),
  dateNote: z.string().nullable(),
  removedBefore: z.boolean(),
  bullets: z.array(BulletItemSchema),
});

export const EmployerItemSchema = z.object({
  key: z.string(),
  name: z.string(),
  companyId: z.uuid().nullable(),
  suggestion: EmployerSuggestionSchema,
  removedBefore: z.boolean(),
  roles: z.array(RoleItemSchema),
});

const SimpleBase = { key: z.string(), blockId: z.string().nullable(), suggestion: SimpleSuggestionSchema, removedBefore: z.boolean() };

export const SkillItemSchema = z.object({ ...SimpleBase, category: z.string(), name: z.string() });
export const ProjectItemSchema = z.object({
  ...SimpleBase,
  name: z.string(),
  description: z.string(),
  url: z.string(),
  technologies: z.array(z.string()),
  bullets: z.array(z.object({ blockId: z.string().nullable(), text: z.string() })),
});
export const EducationItemSchema = z.object({
  ...SimpleBase,
  institution: z.string(),
  degree: z.string(),
  field: z.string(),
  start: z.string(),
  end: z.string(),
  details: z.string(),
});
export const CertificationItemSchema = z.object({ ...SimpleBase, name: z.string(), issuer: z.string(), date: z.string() });
export const AchievementItemSchema = z.object({ ...SimpleBase, text: z.string() });

export const PARAGRAPH_KINDS = ["story", "motivation_company", "motivation_general", "boilerplate"] as const;
export type ParagraphKind = (typeof PARAGRAPH_KINDS)[number];

/** What the paragraph is, and where it goes: a story goes under a role (and a fact of it), a motivation to the record. */
export const ParagraphChoiceSchema = z.object({
  kind: z.enum(PARAGRAPH_KINDS),
  roleId: z.string().nullable(),
  /** The fact of that role this story repeats, or null for a new fact. */
  factId: z.string().nullable(),
});

export const ParagraphItemSchema = z.object({
  key: z.string(),
  blockId: z.string().nullable(),
  text: z.string(),
  /** The suggestion (the user's decision may change it). */
  suggestion: ParagraphChoiceSchema,
  /** For a reason to work at a company: the company of the document, never the model's guess. */
  companyId: z.uuid().nullable(),
  companyName: z.string(),
  removedBefore: z.boolean(),
});

export const ProposalSchema = z.object({
  sourceId: z.uuid(),
  /** The record version this was computed against (0 when the record was empty). */
  baseVersion: z.number().int().min(0),
  label: z.string(),
  targetRole: z.string().nullable(),
  warnings: z.array(z.string()),
  employers: z.array(EmployerItemSchema),
  skills: z.array(SkillItemSchema),
  projects: z.array(ProjectItemSchema),
  education: z.array(EducationItemSchema),
  certifications: z.array(CertificationItemSchema),
  achievements: z.array(AchievementItemSchema),
  /** Paragraphs of a cover letter. Absent in proposals made before cover letters were read. */
  paragraphs: z.array(ParagraphItemSchema).default([]),
});

/**
 * What the user chose for one item, by item key. No entry means "as suggested". `change` carries the replacement
 * suggestion for the item's own kind. `angle` is for a role proposed as a framing.
 */
export const DecisionSchema = z.object({
  action: z.enum(["accept", "reject", "change"]),
  employer: EmployerSuggestionSchema.optional(),
  role: RoleSuggestionSchema.optional(),
  bullet: BulletSuggestionSchema.optional(),
  simple: SimpleSuggestionSchema.optional(),
  paragraph: ParagraphChoiceSchema.optional(),
  angle: z.string().max(80).optional(),
});

export const DecisionsSchema = z.record(z.string(), DecisionSchema);

export type EmployerSuggestion = z.infer<typeof EmployerSuggestionSchema>;
export type RoleSuggestion = z.infer<typeof RoleSuggestionSchema>;
export type BulletSuggestion = z.infer<typeof BulletSuggestionSchema>;
export type SimpleSuggestion = z.infer<typeof SimpleSuggestionSchema>;
export type BulletItem = z.infer<typeof BulletItemSchema>;
export type RoleItem = z.infer<typeof RoleItemSchema>;
export type EmployerItem = z.infer<typeof EmployerItemSchema>;
export type SkillItem = z.infer<typeof SkillItemSchema>;
export type ProjectItem = z.infer<typeof ProjectItemSchema>;
export type EducationItem = z.infer<typeof EducationItemSchema>;
export type CertificationItem = z.infer<typeof CertificationItemSchema>;
export type AchievementItem = z.infer<typeof AchievementItemSchema>;
export type ParagraphChoice = z.infer<typeof ParagraphChoiceSchema>;
export type ParagraphItem = z.infer<typeof ParagraphItemSchema>;
export type Proposal = z.infer<typeof ProposalSchema>;
export type Decision = z.infer<typeof DecisionSchema>;
export type Decisions = z.infer<typeof DecisionsSchema>;
