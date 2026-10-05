import { z } from "zod";
import { chatStructured } from "@/lib/llm/structured";
import type { ContactKind } from "./types";

export type PostingPerson = { name: string; title: string; email: string | null; kind: ContactKind; evidence: string };

const Schema = z.object({
  people: z.array(
    z.object({
      name: z.string(),
      title: z.string(),
      email: z.string(),
      role: z.enum(["hiring_manager", "recruiter", "team_lead", "founder", "other"]),
      evidence: z.string(),
    }),
  ),
});

const MAX_TEXT = 24_000;

/**
 * People the posting itself names as the contact: a recruiter, the hiring manager, "email Jane at ...".
 * A named person beats any lookup result, so these are kept even when no email is given.
 */
export async function extractPostingPeople(rawText: string): Promise<PostingPerson[]> {
  const text = rawText.trim().slice(0, MAX_TEXT);
  if (!text) return [];
  const out = await chatStructured(
    Schema,
    {
      system: `You read a job posting and list the real people it names as a contact for the role: a recruiter, the hiring manager, the team lead, a founder, or someone to email.
Rules:
- Only people whose full or first name appears in the text. Never invent a person, a name or an email address.
- "email" is an address written in the text for that person, else "". Do not guess one. Ignore shared inboxes such as careers@ or jobs@.
- "evidence" is the short phrase from the text that names them.
- Do not list people who only appear as quoted employees in testimonials or the company's leadership page unless the posting says to contact them.
- If nobody is named, return an empty list.`,
      user: text,
    },
    { maxTokens: 2000 },
  );
  return out.people
    .filter((p) => p.name.trim().length > 1)
    .map((p) => ({
      name: p.name.trim(),
      title: p.title.trim(),
      email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email.trim()) ? p.email.trim().toLowerCase() : null,
      kind: p.role === "other" ? "other" : p.role,
      evidence: p.evidence.trim(),
    }));
}
