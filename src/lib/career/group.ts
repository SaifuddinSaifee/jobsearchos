import { z } from "zod";
import { chatStructured } from "@/lib/llm/structured";
import { textSimilarity } from "./normalize";
import type { Fact, Role } from "./schema";

// Asks the model one narrow question: is this new bullet the same accomplishment as one already in the record, or as
// another new bullet? The answer is a choice among ids (aliases) and nothing else, so the model cannot return text,
// and everything it says is checked against what was sent before it is used.

export type GroupInput = { key: string; text: string };

/** For each bullet: the existing fact it belongs to, or the new bullet whose new fact it joins. Neither means a new fact. */
export type GroupAnswer = { factId: string | null; withKey: string | null };

export type Grouper = (role: Role, bullets: GroupInput[]) => Promise<Map<string, GroupAnswer>>;

/** Roles with more facts than this only show the model the facts most like the new bullets. */
export const MAX_FACTS_SHOWN = 60;
export const FACTS_PER_BULLET = 15;
const WORDINGS_PER_FACT = 3;
const WORDING_CHARS = 300;

const SYSTEM = `You group resume bullets that describe the same accomplishment.
Rules:
- Two bullets are the same accomplishment only when they describe the same specific work and outcome, worded differently. Sharing a topic, a skill or a company is not enough.
- When in doubt, answer "new" for the fact and "none" for sameAs.
- You never write or change any text. You only choose among the ids you are given.
- Answer once for every bullet.`;

const clip = (t: string) => (t.length > WORDING_CHARS ? `${t.slice(0, WORDING_CHARS - 3)}...` : t);

/** The facts to show: all of them, or for a large role the closest few to each bullet. */
export function factsToShow(role: Role, bullets: GroupInput[]): Fact[] {
  if (role.facts.length <= MAX_FACTS_SHOWN) return role.facts;
  const keep = new Set<string>();
  for (const b of bullets) {
    const scored = role.facts
      .map((f) => ({ f, score: Math.max(...f.wordings.map((w) => textSimilarity(w.text, b.text)), 0) }))
      .sort((a, c) => c.score - a.score)
      .slice(0, FACTS_PER_BULLET);
    for (const s of scored) keep.add(s.f.id);
  }
  return role.facts.filter((f) => keep.has(f.id));
}

/** The schema for one call, built from the aliases sent, so the only values the model can return are those aliases. */
export function answerSchema(factAliases: string[], bulletAliases: string[]) {
  const oneOf = (first: string, rest: string[]) => z.enum([first, ...rest]);
  return z.object({
    groups: z.array(
      z.object({
        bullet: oneOf(bulletAliases[0], bulletAliases.slice(1)),
        fact: oneOf("new", factAliases),
        sameAs: oneOf("none", bulletAliases),
      }),
    ),
  });
}

/** Makes sense of the model's answer: unknown or missing bullets become new, and "same as" chains are followed to their end. */
export function readAnswer(
  groups: { bullet: string; fact: string; sameAs: string }[],
  bullets: GroupInput[],
  facts: Fact[],
): Map<string, GroupAnswer> {
  const bulletByAlias = new Map(bullets.map((b, i) => [`b${i + 1}`, b]));
  const factByAlias = new Map(facts.map((f, i) => [`f${i + 1}`, f]));

  const first = new Map<string, { fact: string; sameAs: string }>();
  for (const g of groups) if (bulletByAlias.has(g.bullet) && !first.has(g.bullet)) first.set(g.bullet, g);

  const resolve = (alias: string, seen: Set<string>): GroupAnswer => {
    const g = first.get(alias);
    if (!g) return { factId: null, withKey: null };
    const fact = factByAlias.get(g.fact);
    if (fact) return { factId: fact.id, withKey: null };
    if (g.sameAs !== "none" && g.sameAs !== alias && bulletByAlias.has(g.sameAs) && !seen.has(g.sameAs)) {
      const root = resolve(g.sameAs, new Set([...seen, alias]));
      return root.factId ? root : { factId: null, withKey: root.withKey ?? bulletByAlias.get(g.sameAs)!.key };
    }
    return { factId: null, withKey: null };
  };

  const out = new Map<string, GroupAnswer>();
  for (const [alias, b] of bulletByAlias) out.set(b.key, resolve(alias, new Set()));
  return out;
}

/** The grouper that asks the model. `chat` is injectable so tests never reach the network. */
export function makeGrouper(chat: typeof chatStructured = chatStructured): Grouper {
  return async (role, bullets) => {
    if (bullets.length === 0) return new Map();
    const facts = factsToShow(role, bullets);
    // Nothing to compare a single bullet with.
    if (facts.length === 0 && bullets.length < 2) return new Map();

    const factAliases = facts.map((_, i) => `f${i + 1}`);
    const bulletAliases = bullets.map((_, i) => `b${i + 1}`);
    const user = [
      facts.length > 0
        ? `Facts already recorded (each line is one accomplishment, with the ways it has been worded):\n${facts
            .map((f, i) => `f${i + 1}: ${f.wordings.slice(0, WORDINGS_PER_FACT).map((w) => `"${clip(w.text)}"`).join(" | ")}`)
            .join("\n")}`
        : "No facts are recorded yet for this role.",
      `New bullets:\n${bullets.map((b, i) => `b${i + 1}: "${clip(b.text)}"`).join("\n")}`,
      `For each new bullet, give: "fact" = the fact it repeats (${factAliases.length ? `${factAliases.join(", ")} or ` : ""}"new"), and "sameAs" = another new bullet it repeats, or "none".`,
    ].join("\n\n");

    const schema = answerSchema(factAliases, bulletAliases);
    let last: unknown;
    // One retry: the model sometimes returns text that is not valid JSON.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const result = await chat(schema, { system: SYSTEM, user }, { maxTokens: 4000, step: "group-bullets" });
        return readAnswer(result.groups, bullets, facts);
      } catch (err) {
        last = err;
      }
    }
    throw new Error(`Could not group bullets with the model: ${last instanceof Error ? last.message : "unknown error"}`);
  };
}

export const modelGrouper: Grouper = makeGrouper();
