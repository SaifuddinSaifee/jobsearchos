import { z } from "zod";

// No `.default()` anywhere: ProfileSchema doubles as the structured-output schema
// for the LLM, which needs every field present. Empty values come from the factories below.

export const ExperienceSchema = z.object({
  company: z.string(),
  title: z.string(),
  location: z.string(),
  start: z.string(),
  end: z.string(),
  current: z.boolean(),
  bullets: z.array(z.string()),
});

export const ProfileSchema = z.object({
  contact: z.object({
    name: z.string(),
    email: z.string(),
    phone: z.string(),
    location: z.string(),
    links: z.array(z.string()),
  }),
  summary: z.string(),
  experience: z.array(ExperienceSchema),
  skills: z.array(z.object({ category: z.string(), items: z.array(z.string()) })),
  technologies: z.array(z.string()),
  projects: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      technologies: z.array(z.string()),
      bullets: z.array(z.string()),
      url: z.string(),
    }),
  ),
  education: z.array(
    z.object({
      institution: z.string(),
      degree: z.string(),
      field: z.string(),
      start: z.string(),
      end: z.string(),
      details: z.string(),
    }),
  ),
  certifications: z.array(
    z.object({ name: z.string(), issuer: z.string(), date: z.string() }),
  ),
  achievements: z.array(z.string()),
});

export const REMOTE_MODES = ["remote", "hybrid", "onsite"] as const;

export const PreferencesSchema = z.object({
  targetRoles: z.array(z.string()),
  locations: z.array(z.string()),
  remoteModes: z.array(z.enum(REMOTE_MODES)),
  minSalary: z.number().nonnegative().nullable(),
  salaryCurrency: z.string(),
  countries: z.array(z.string()),
  needsVisaSponsorship: z.boolean(),
  preferredTechnologies: z.array(z.string()),
  excludedRoles: z.array(z.string()),
  excludedCompanies: z.array(z.string()),
});

export const TONES = ["professional", "confident", "friendly", "concise"] as const;

export const GenerationInstructionsSchema = z.object({
  styleRules: z.string(),
  tone: z.enum(TONES),
  /** Per-section limits so output fits the user's compact resume template. */
  sectionLimits: z.array(
    z.object({
      section: z.string().min(1),
      maxBullets: z.number().int().positive().nullable(),
      maxChars: z.number().int().positive().nullable(),
    }),
  ),
});

export type Profile = z.infer<typeof ProfileSchema>;
export type Preferences = z.infer<typeof PreferencesSchema>;
export type GenerationInstructions = z.infer<typeof GenerationInstructionsSchema>;

export const emptyProfile = (): Profile => ({
  contact: { name: "", email: "", phone: "", location: "", links: [] },
  summary: "",
  experience: [],
  skills: [],
  technologies: [],
  projects: [],
  education: [],
  certifications: [],
  achievements: [],
});

export const emptyPreferences = (): Preferences => ({
  targetRoles: [],
  locations: [],
  remoteModes: [],
  minSalary: null,
  salaryCurrency: "USD",
  countries: [],
  needsVisaSponsorship: false,
  preferredTechnologies: [],
  excludedRoles: [],
  excludedCompanies: [],
});

export const emptyInstructions = (): GenerationInstructions => ({
  styleRules: "",
  tone: "professional",
  sectionLimits: [],
});
