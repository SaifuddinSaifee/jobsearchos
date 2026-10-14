import { chatStructured, type StructuredOptions } from "@/lib/llm/structured";
import { ProfileSchema, type Profile } from "@/lib/profile/schema";

/** Options a caller may change for parsing; the step is always "parse-resume". */
export type ParseOptions = Omit<StructuredOptions, "step">;

const SYSTEM = `You convert resume text into structured JSON.
Rules:
- Extract only what is written in the resume. Never infer, embellish or invent anything.
- Keep bullet points verbatim, one array item per bullet.
- Use an empty string for any missing text field and an empty array for missing lists.
- Dates exactly as written (e.g. "Jan 2022", "2021"). Set current=true only if the role is ongoing ("Present", "Current").
- Group skills by the category headings used in the resume; if there are none, use a single category "Skills".
- "technologies" is a flat list of every tool, language and framework mentioned.`;

/**
 * Parsing is copying text into fields, not a problem to think through, and the user waits on it before they can edit
 * an uploaded resume. Low effort removes nearly all of the model's thinking. `scripts/eval-resume.ts` compares it
 * with the model's default.
 */
export const PARSE_OPTIONS: ParseOptions = { reasoningEffort: "low" };

export async function parseResume(text: string, opts: ParseOptions = PARSE_OPTIONS): Promise<Profile> {
  return chatStructured(
    ProfileSchema,
    {
      system: SYSTEM,
      user: `Resume text:\n\n${text}`,
    },
    { ...opts, step: "parse-resume" },
  );
}
