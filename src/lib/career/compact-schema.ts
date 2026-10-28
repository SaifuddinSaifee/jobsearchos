import { z } from "zod";
import { CareerRecordSchema } from "./schema";

// What a tidy of the career record proposes, as stored on its row and shown for review. Client-safe.

/** Two or more values for one measure of a fact: the user keeps one. */
export const CompactionQuestionSchema = z.object({
  id: z.string(),
  factId: z.string(),
  /** Where the fact is, for the review ("Psylief Technologies, Backend Developer Intern"). */
  where: z.string(),
  /** The fact's statement or first wording. */
  fact: z.string(),
  measures: z.string(),
  options: z.array(z.object({ detailId: z.string(), text: z.string() })),
});

export const CompactionPartSchema = z.object({
  id: z.string(),
  label: z.string(),
  factsBefore: z.number().int(),
  factsAfter: z.number().int(),
  wordingsBefore: z.number().int(),
  wordingsAfter: z.number().int(),
});

const Count = z.object({ before: z.number().int(), after: z.number().int() });

export const CompactionResultSchema = z.object({
  baseVersion: z.number().int().min(0),
  record: CareerRecordSchema,
  roles: z.array(CompactionPartSchema),
  projects: z.array(CompactionPartSchema),
  cleanup: z.object({
    skills: Count,
    education: Count,
    certifications: Count,
    achievements: Count,
    /** "Technologies:" lines moved from facts to their role. */
    technologyLines: z.number().int(),
  }),
  questions: z.array(CompactionQuestionSchema),
  /** Facts whose statement could not be written, with what the check found. They keep their first wording as the line. */
  unwritten: z.array(z.object({ factId: z.string(), where: z.string(), findings: z.array(z.string()) })),
  /** Characters of the Markdown export, before and after. */
  size: Count,
});

export const CompactionAnswersSchema = z.record(z.string(), z.string());

export type CompactionQuestion = z.infer<typeof CompactionQuestionSchema>;
export type CompactionPart = z.infer<typeof CompactionPartSchema>;
export type CompactionResult = z.infer<typeof CompactionResultSchema>;
export type CompactionAnswers = z.infer<typeof CompactionAnswersSchema>;
