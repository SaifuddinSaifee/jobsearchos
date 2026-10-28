import { z } from "zod";
import { env } from "@/lib/env";
import { chatStructured } from "@/lib/llm/structured";
import { checkStatement, detailsFromWordings, STATEMENT_CHARS } from "./facts";
import type { DetailInput } from "./proposal-schema";
import { DETAIL_KINDS } from "./schema";

// Asks the model for each fact's one-line statement and the details its wordings state. Everything it returns is
// checked in code: a detail must be a phrase of one of the wordings, and a statement may only use the numbers and names
// the wordings give (`checkStatement`). A statement that fails is asked for once more with what was wrong, then left out.

export type DescribeInput = {
  key: string;
  /** Every wording of the fact, longest story included. */
  wordings: string[];
};

export type Description = { statement: string; details: DetailInput[]; findings: string[] };

export type Describer = (facts: DescribeInput[], prefix: string) => Promise<Map<string, Description>>;

/** Facts per call, so a long role never runs into the output limit. */
export const FACTS_PER_CALL = 6;
const WORDINGS_PER_FACT = 12;
/** A team or specific longer than this is a clause, not a detail; the wordings keep it. */
export const DETAIL_CHARS = 80;
/** Most details kept per fact: metrics first, then tools, teams and specifics. */
export const MAX_DETAILS = 16;
const KIND_ORDER = { metric: 0, tool: 1, team: 2, specific: 3 } as const;
const WORDING_CHARS = 600;

const SYSTEM = `You condense the candidate's own resume bullets into one statement per accomplishment, and list the details they state.
The career record above is context. Work only on the facts in the user message: each lists every way the candidate has worded one accomplishment.

For each fact, write:
1. statement: one sentence of at most ${STATEMENT_CHARS} characters that merges the wordings into their middle ground. Lead with the result when there is one, then how it was done. Keep the strongest numbers and the main tools. It may use only numbers, tools, products, teams and claims that appear in the wordings; never add one. Where wordings give different numbers for the same thing, use the one most wordings give. Plain words: no arrows, check marks, bullets or other symbols, no em dashes.
2. details: every specific thing the wordings state, each copied exactly as written in one wording (same words, same spelling):
   - metric: a number with what it counts ("80%", "500K+ daily events", "99.9% uptime", "15+ team members"). Give "measures": what it measures in 2 to 5 plain words ("manual workflows", "API response time"). Use the same "measures" for the same thing across wordings, so two values for one measure can be found.
   - tool: a language, framework, library, product, platform or method named ("LangChain", "PostgreSQL", "Zapier").
   - team: people or teams worked with or for ("the Founders", "Sales, CS, and Marketing teams").
   - specific: a concrete thing built or done that a reader would remember, as a short noun phrase of at most 8 words ("twice-daily AI-summarized Slack digest").
   "measures" is "" for every kind but metric. Do not repeat a detail.
Answer once for every fact, by its id.`;

const clip = (t: string) => (t.length > WORDING_CHARS ? `${t.slice(0, WORDING_CHARS - 3)}...` : t);

export function describeSchema(aliases: string[]) {
  return z.object({
    facts: z.array(
      z.object({
        fact: z.enum([aliases[0], ...aliases.slice(1)]),
        statement: z.string(),
        details: z.array(z.object({ kind: z.enum(DETAIL_KINDS), text: z.string(), measures: z.string() })),
      }),
    ),
  });
}

function userMessage(facts: DescribeInput[], retry: Map<string, string[]>): string {
  return facts
    .map((f, i) => {
      const wordings = f.wordings.slice(0, WORDINGS_PER_FACT).map((w) => `  - "${clip(w.replace(/\s+/g, " ").trim())}"`);
      const wrong = retry.get(f.key);
      const note = wrong ? `\n  Your last statement for this fact was not usable: ${wrong.join(" ")}` : "";
      return `f${i + 1}:\n${wordings.join("\n")}${note}`;
    })
    .join("\n\n");
}

/** Checks one answer against the fact's wordings: details kept only when a wording says them, the statement checked. */
export function readDescription(answer: { statement: string; details: DetailInput[] }, wordings: string[]): Description {
  const texts = wordings.map((text) => ({ text }));
  const details = detailsFromWordings(
    answer.details
      .map((d) => ({ kind: d.kind, text: d.text.trim(), measures: d.kind === "metric" ? d.measures.trim() : "" }))
      .filter((d) => d.text && (d.kind === "metric" || d.kind === "tool" || d.text.length <= DETAIL_CHARS)),
    texts,
  )
    .map((d, i) => ({ d, i }))
    .sort((a, b) => KIND_ORDER[a.d.kind] - KIND_ORDER[b.d.kind] || a.i - b.i)
    .slice(0, MAX_DETAILS)
    .sort((a, b) => a.i - b.i)
    .map(({ d }) => d);
  const statement = answer.statement.replace(/\s+/g, " ").trim();
  return { statement, details, findings: checkStatement(statement, { wordings: texts, details }) };
}

/** The describer that asks the model. `chat` is injectable so tests never reach the network. */
export function makeDescriber(chat: typeof chatStructured = chatStructured): Describer {
  const ask = async (batch: DescribeInput[], prefix: string, retry: Map<string, string[]>) => {
    const aliases = batch.map((_, i) => `f${i + 1}`);
    const schema = describeSchema(aliases);
    let last: unknown;
    // One retry: the model sometimes returns text that is not valid JSON.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const result = await chat(schema, { system: SYSTEM, user: userMessage(batch, retry) }, { maxTokens: 12_000, step: "describe-facts", model: env().RECORD_MODEL, prefix });
        const out = new Map<string, Description>();
        for (const a of result.facts) {
          const fact = batch[aliases.indexOf(a.fact)];
          if (fact && !out.has(fact.key)) out.set(fact.key, readDescription(a, fact.wordings));
        }
        return out;
      } catch (err) {
        last = err;
      }
    }
    throw new Error(`Could not describe facts with the model: ${last instanceof Error ? last.message : "unknown error"}`);
  };

  return async (facts, prefix) => {
    const out = new Map<string, Description>();
    const usable = facts.filter((f) => f.wordings.length > 0);
    for (let i = 0; i < usable.length; i += FACTS_PER_CALL) {
      const batch = usable.slice(i, i + FACTS_PER_CALL);
      const first = await ask(batch, prefix, new Map());
      for (const [k, v] of first) out.set(k, v);
      // Asked once more, with what was wrong, for statements that failed their check or were not answered.
      const again = batch.filter((f) => !first.has(f.key) || first.get(f.key)!.findings.length > 0);
      if (again.length === 0) continue;
      const retry = new Map(again.map((f) => [f.key, first.get(f.key)?.findings ?? ["It was missing from your answer."]]));
      const second = await ask(again, prefix, retry).catch(() => new Map<string, Description>());
      for (const [k, v] of second) {
        const before = out.get(k);
        // The second answer wins when its statement passes; its details are kept either way when the first had none.
        if (v.findings.length === 0 || !before) out.set(k, v);
      }
    }
    return out;
  };
}

export const modelDescriber: Describer = makeDescriber();
