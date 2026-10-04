import { chatStructured } from "@/lib/llm/structured";
import { ProfileSchema, type Profile } from "@/lib/profile/schema";

const SYSTEM = `You convert resume text into structured JSON.
Rules:
- Extract only what is written in the resume. Never infer, embellish or invent anything.
- Keep bullet points verbatim, one array item per bullet.
- Use an empty string for any missing text field and an empty array for missing lists.
- Dates exactly as written (e.g. "Jan 2022", "2021"). Set current=true only if the role is ongoing ("Present", "Current").
- Group skills by the category headings used in the resume; if there are none, use a single category "Skills".
- "technologies" is a flat list of every tool, language and framework mentioned.`;

export async function parseResume(text: string): Promise<Profile> {
  return chatStructured(ProfileSchema, {
    system: SYSTEM,
    user: `Resume text:\n\n${text}`,
  });
}
