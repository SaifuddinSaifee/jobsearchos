import { z } from "zod";
import { jaccard, normalizeText, tokens } from "@/lib/career/normalize";
import { isStopped } from "@/lib/llm/abort";
import { chatStructured } from "@/lib/llm/structured";
import { containsPhrase, type SourceItem } from "./context";
import { REQUIREMENT_USES, requirementWeight, VERDICTS, type Requirement, type RequirementUse, type Verdict } from "./types";

export { matchScore } from "./types";

// Lines up what the job asks for against what the source can answer it with. A short term ("Postgres", "Kubernetes")
// is settled by looking for it, with no model. The rest go to the model a few at a time, in calls that run at the same
// time, each answering with a choice among the ids it was sent and nothing else: it cannot write evidence, only point
// at some. One more call, alongside them, reads the requirements alone: what each one is, and which few the job is
// about. That one needs the whole list but none of the record.

/** A term this short is looked for directly; a longer sentence needs reading. */
const MAX_FREE_TOKENS = 4;
/** A single word shorter than this ("go", "r", "c") appears in too much ordinary text to count as a match. */
const MIN_FREE_CHARS = 3;
const MAX_FREE_REFS = 3;
/** Items shown to the model per open requirement, and in all, so the prompt stays small for a long record. */
export const ITEMS_PER_REQUIREMENT = 6;
export const MAX_ITEMS_SHOWN = 120;
const MAX_EVIDENCE = 3;
const ITEM_CHARS = 320;
/** The most requirements read as the job's core. */
export const MAX_CORE = 5;
/**
 * Open requirements per call. One call for the whole job thought for up to 15,000 tokens and took up to two minutes;
 * each requirement is judged on its own, so the calls can share the work and matching takes as long as the slowest.
 */
export const REQUIREMENTS_PER_CALL = 6;
/** Thinking counts against this. A call for a few requirements needs far less; this leaves room for a slow one. */
const MATCH_MAX_TOKENS = 16_000;

const sentence = (t: string) => (t.length > ITEM_CHARS ? `${t.slice(0, ITEM_CHARS - 3)}...` : t);

/** Which requirements can be settled by finding the term itself in the source. Returns their refs by requirement id. */
export function freeMatches(requirements: Requirement[], items: SourceItem[]): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const r of requirements) {
    const phrase = normalizeText(r.text);
    const words = phrase.split(" ").filter(Boolean);
    if (words.length === 0 || words.length > MAX_FREE_TOKENS) continue;
    if (words.length === 1 && words[0].length < MIN_FREE_CHARS) continue;
    if (!/[a-z]{3,}/.test(phrase)) continue;
    const refs = items.filter((i) => containsPhrase(i.normalized, phrase)).slice(0, MAX_FREE_REFS).map((i) => i.ref);
    if (refs.length > 0) found.set(r.id, refs);
  }
  return found;
}

/** The items worth showing the model for these requirements: the closest few to each, for a long record. */
export function shortlist(open: Requirement[], items: SourceItem[]): SourceItem[] {
  if (items.length <= MAX_ITEMS_SHOWN) return items;
  const keep = new Set<string>();
  for (const r of open) {
    const t = tokens(r.text);
    const scored = items
      .map((i) => ({ i, score: jaccard(t, tokens(i.text)) }))
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, ITEMS_PER_REQUIREMENT);
    for (const s of scored) keep.add(s.i.ref);
  }
  return items.filter((i) => keep.has(i.ref)).slice(0, MAX_ITEMS_SHOWN);
}

/** The schema for one matching call, built from the ids sent, so the only values the model can return are those ids. */
export function answerSchema(requirementIds: string[], itemAliases: string[]) {
  return z.object({
    answers: z.array(
      z.object({
        requirement: z.enum(requirementIds as [string, ...string[]]),
        verdict: z.enum(VERDICTS),
        evidence: z.array(z.enum(itemAliases as [string, ...string[]])).max(MAX_EVIDENCE),
      }),
    ),
  });
}

/** The schema for reading the requirements: what each is, and the few the job is about. */
export function readingSchema(allIds: string[]) {
  const ids = z.enum(allIds as [string, ...string[]]);
  return z.object({
    // What each requirement is, for every one of them, so the writer knows where it may appear.
    uses: z.array(z.object({ requirement: ids, use: z.enum(REQUIREMENT_USES) })),
    // The few requirements the job is really about, so they weigh most when the resume is written.
    core: z.array(ids).optional(),
  });
}

/**
 * `use` is what the requirement is, when the model said, and `core` whether it is one of the few things the job is really
 * about. Both may be given for a requirement that was not open.
 */
export type MatchAnswer = { verdict: Verdict; refs: string[]; use?: RequirementUse; core?: boolean };
/** `all` is every requirement of the job, including those already settled without the model, so the model can say what each is. */
export type Matcher = (open: Requirement[], items: SourceItem[], all?: Requirement[]) => Promise<Map<string, MatchAnswer>>;

/**
 * Makes sense of the model's answer. The first answer for a requirement wins; unknown ids are dropped; "met" or
 * "partial" without evidence cannot be shown, so it counts as missing; "missing" carries no evidence.
 */
export function readAnswer(
  answers: { requirement: string; verdict: Verdict; evidence: string[] }[],
  open: Requirement[],
  shown: SourceItem[],
): Map<string, MatchAnswer> {
  const byAlias = new Map(shown.map((i, n) => [`i${n + 1}`, i]));
  const known = new Set(open.map((r) => r.id));
  const out = new Map<string, MatchAnswer>();
  for (const a of answers) {
    if (!known.has(a.requirement) || out.has(a.requirement)) continue;
    const refs = [...new Set(a.evidence.map((e) => byAlias.get(e)?.ref).filter((r): r is string => !!r))];
    out.set(a.requirement, a.verdict === "missing" || refs.length === 0 ? { verdict: "missing", refs: [] } : { verdict: a.verdict, refs });
  }
  return out;
}

/** The model's reading of what each requirement is: the first answer for an id wins, unknown ids are dropped. */
export function readUses(uses: { requirement: string; use: RequirementUse }[], all: Requirement[]): Map<string, RequirementUse> {
  const known = new Set(all.map((r) => r.id));
  const out = new Map<string, RequirementUse>();
  for (const u of uses) if (known.has(u.requirement) && !out.has(u.requirement)) out.set(u.requirement, u.use);
  return out;
}

/** The model's pick of the job's core: known ids, once each, in its order, at most `MAX_CORE`. */
export function readCore(core: string[], all: Requirement[]): Set<string> {
  const known = new Set(all.filter((r) => r.kind !== "company").map((r) => r.id));
  return new Set([...new Set(core)].filter((id) => known.has(id)).slice(0, MAX_CORE));
}

const SYSTEM = `You compare what a job asks for with what a person has done, as recorded in their career record.
Rules:
- "met": the evidence clearly shows the requirement: the same skill, tool or domain, at a comparable scope.
- "partial": the evidence is related but not the same: a similar tool, a smaller scope, a neighbouring domain.
- "missing": nothing shown is relevant. Most requirements the record cannot speak to are "missing"; do not stretch.
- You never write or change any text. You only choose among the ids you are given.
- Answer once for every requirement. Name up to ${MAX_EVIDENCE} items as evidence, the closest ones, and none for "missing".`;

const READING_SYSTEM = `You read what a job asks for, as a hiring manager for it would.
- In "uses", say what every requirement in the list is:
  - "experience": a statement about a track record or a level ("You've built real infrastructure", "5+ years").
  - "skill": a tool, technology, method or technical area a person can be good at ("Model training", "Kafka", "API design").
  - "domain": the field, kind of product, audience or subject matter ("Books apps", "Consumer apps", "Fanfiction", "Media").
  - "trait": a way of working or a personal quality ("Adaptability", "Ownership", "Curiosity").
  - "logistics": a condition, not experience (relocating, visa, work hours, travel, being in the office).
- In "core", name the 3 to ${MAX_CORE} requirements this job is really about: what a hiring manager would check first, the work the role exists to do ("Strong across the full stack", "Ships LLM features to production"). Never a way of working, a field, a condition or the company's values.`;

/** `size` items at a time, in order. */
const inGroups = <T>(list: T[], size: number): T[][] => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));

/** Asks twice: the model sometimes returns text that is not valid JSON. */
async function twice<T>(ask: () => Promise<T>): Promise<T> {
  try {
    return await ask();
  } catch (err) {
    if (isStopped(err)) throw err;
    return ask();
  }
}

/**
 * The matcher that asks the model: the open requirements a few at a time, each call with the record items closest to them all,
 * and the whole list once more for what each requirement is and which the job is about, all at the same time. A failed
 * matching call fails the match (its requirements would read as missing); a failed reading leaves the requirements as
 * they were read from the posting, with no core. `chat` is injectable so tests never reach the network.
 */
export function makeMatcher(chat: typeof chatStructured = chatStructured): Matcher {
  return async (open, items, all = open) => {
    // Every call is shown the same items, the closest to all the open requirements, as one call was: evidence found
    // near one requirement often answers another.
    const shown = shortlist(open, items);
    // Everything was settled without the model, or there is nothing to compare with: no call.
    if (open.length === 0 || shown.length === 0) return new Map();

    const match = async (group: Requirement[]): Promise<Map<string, MatchAnswer>> => {
      const user = [
        `Career record items (each is something the person did or has):\n${shown.map((i, n) => `i${n + 1} [${i.label}]: ${sentence(i.text)}`).join("\n")}`,
        `What the job asks for (answer each):\n${group.map((r) => `${r.id}: ${r.text}`).join("\n")}`,
      ].join("\n\n");
      const schema = answerSchema(group.map((r) => r.id), shown.map((_, n) => `i${n + 1}`));
      const result = await twice(() => chat(schema, { system: SYSTEM, user }, { maxTokens: MATCH_MAX_TOKENS, step: "match-requirements" }));
      return readAnswer(result.answers, group, shown);
    };
    const reading = async (): Promise<{ uses: Map<string, RequirementUse>; core: Set<string> }> => {
      try {
        const user = `What the job asks for:\n${all.map((r) => `${r.id}: ${r.text}`).join("\n")}`;
        const result = await twice(() => chat(readingSchema(all.map((r) => r.id)), { system: READING_SYSTEM, user }, { maxTokens: MATCH_MAX_TOKENS, step: "read-requirements" }));
        return { uses: readUses(result.uses, all), core: readCore(result.core ?? [], all) };
      } catch (err) {
        if (isStopped(err)) throw err;
        console.error("[resume-writer] reading the requirements failed:", err instanceof Error ? err.message : err);
        return { uses: new Map(), core: new Set() };
      }
    };

    let matched: Map<string, MatchAnswer>[];
    let read: Awaited<ReturnType<typeof reading>>;
    try {
      [read, ...matched] = await Promise.all([reading(), ...inGroups(open, REQUIREMENTS_PER_CALL).map(match)]);
    } catch (err) {
      throw new Error(`Could not match requirements with the model: ${err instanceof Error ? err.message : "unknown error"}`);
    }
    const answers = new Map(matched.flatMap((m) => [...m]));
    for (const [id, use] of read.uses) answers.set(id, { ...(answers.get(id) ?? { verdict: "missing", refs: [] }), use });
    for (const id of read.core) answers.set(id, { ...(answers.get(id) ?? { verdict: "missing", refs: [] }), core: true });
    return answers;
  };
}

export const modelMatcher: Matcher = makeMatcher();

/** The readable evidence for a ref: where it comes from, and what it says. */
const describe = (item: SourceItem) => `${item.label}: ${sentence(item.text)}`;

/**
 * The job's requirements settled against a source. Short terms found in it are met without a model; the rest are put
 * to the matcher; whatever it does not answer is missing. Keeps each requirement's id, text, kind and weight.
 */
export async function matchRequirements(requirements: Requirement[], items: SourceItem[], matcher: Matcher = modelMatcher): Promise<Requirement[]> {
  const byRef = new Map(items.map((i) => [i.ref, i]));
  const free = freeMatches(requirements, items);
  const open = requirements.filter((r) => !free.has(r.id));
  const answers = await matcher(open, items, requirements);

  return requirements.map((r) => {
    const refs = free.get(r.id);
    const answer: MatchAnswer = refs ? { verdict: "met", refs } : (answers.get(r.id) ?? { verdict: "missing", refs: [] });
    const use = answers.get(r.id)?.use ?? r.use;
    const core = answers.get(r.id)?.core ?? r.core ?? false;
    return {
      ...r,
      use,
      core,
      weight: requirementWeight({ kind: r.kind, use, core }),
      verdict: answer.verdict,
      refs: answer.refs,
      evidence: answer.refs.map((ref) => byRef.get(ref)).filter((i): i is SourceItem => !!i).map(describe),
    };
  });
}
