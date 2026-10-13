import { z } from "zod";
import { chatStructured } from "@/lib/llm/structured";
import { PARAGRAPH_KINDS, type ParagraphKind } from "./proposal-schema";
import { MAX_ROLES_SHOWN, type RoleChoice } from "./role-choices";

// Reading a cover letter into the record. The model labels each paragraph and says which role a story is about, by
// choosing among ids it is given. It never writes or changes text, and the company of a "why this company"
// paragraph comes from the document, not from the model.

export type ParagraphInput = { key: string; text: string };
export type ParagraphClass = { kind: ParagraphKind; roleId: string | null };

export type Classifier = (paragraphs: ParagraphInput[], roles: RoleChoice[]) => Promise<Map<string, ParagraphClass>>;

const SYSTEM = `You read the paragraphs of a cover letter and label each one.
Labels:
- story: tells something the writer did in a specific job they held (a project, a result, a problem solved). Say which of the listed roles it is about, or "none" if it fits none of them.
- motivation_company: explains why the writer wants to work at the company they are applying to (its mission, product, people, values).
- motivation_general: explains why the writer chose this kind of work or field, not tied to one company.
- boilerplate: greetings, sign-offs, "attached is my resume", "I look forward to hearing from you", or other filler.
Rules:
- Choose among the ids you are given. You never write or change any text.
- When in doubt, use boilerplate.
- Answer once for every paragraph.`;

const clip = (t: string) => (t.length > 600 ? `${t.slice(0, 597)}...` : t);

export function answerSchema(paragraphAliases: string[], roleAliases: string[]) {
  const oneOf = (first: string, rest: string[]) => z.enum([first, ...rest]);
  return z.object({
    items: z.array(
      z.object({
        paragraph: oneOf(paragraphAliases[0], paragraphAliases.slice(1)),
        kind: z.enum(PARAGRAPH_KINDS),
        role: oneOf("none", roleAliases),
      }),
    ),
  });
}

/** Reads the answer: unknown or missing paragraphs are boilerplate, and a role only counts for a story. */
export function readClasses(
  items: { paragraph: string; kind: ParagraphKind; role: string }[],
  paragraphs: ParagraphInput[],
  roles: RoleChoice[],
): Map<string, ParagraphClass> {
  const byAlias = new Map(paragraphs.map((p, i) => [`p${i + 1}`, p]));
  const roleByAlias = new Map(roles.map((r, i) => [`r${i + 1}`, r]));
  const first = new Map<string, { kind: ParagraphKind; role: string }>();
  for (const it of items) if (byAlias.has(it.paragraph) && !first.has(it.paragraph)) first.set(it.paragraph, it);
  const out = new Map<string, ParagraphClass>();
  for (const [alias, p] of byAlias) {
    const it = first.get(alias);
    out.set(p.key, {
      kind: it?.kind ?? "boilerplate",
      roleId: it?.kind === "story" ? (roleByAlias.get(it.role)?.id ?? null) : null,
    });
  }
  return out;
}

export function makeClassifier(chat: typeof chatStructured = chatStructured): Classifier {
  return async (paragraphs, roles) => {
    if (paragraphs.length === 0) return new Map();
    const shown = roles.slice(0, MAX_ROLES_SHOWN);
    const pAliases = paragraphs.map((_, i) => `p${i + 1}`);
    const rAliases = shown.map((_, i) => `r${i + 1}`);
    const user = [
      shown.length > 0 ? `Roles the writer has held:\n${shown.map((r, i) => `r${i + 1}: ${r.label}`).join("\n")}` : "No roles are recorded, so a story cannot be matched to one.",
      `Paragraphs:\n${paragraphs.map((p, i) => `p${i + 1}: "${clip(p.text)}"`).join("\n")}`,
      `For each paragraph give "kind" and, for a story, the role ("none" otherwise).`,
    ].join("\n\n");
    const schema = answerSchema(pAliases, rAliases);
    let last: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const result = await chat(schema, { system: SYSTEM, user }, { maxTokens: 3000 });
        return readClasses(result.items, paragraphs, shown);
      } catch (err) {
        last = err;
      }
    }
    throw new Error(`Could not read the cover letter with the model: ${last instanceof Error ? last.message : "unknown error"}`);
  };
}

export const modelClassifier: Classifier = makeClassifier();
