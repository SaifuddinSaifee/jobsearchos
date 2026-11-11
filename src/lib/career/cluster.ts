import { z } from "zod";
import { env } from "@/lib/env";
import { chatStructured } from "@/lib/llm/structured";

// Asks the model which items of one list tell the same accomplishment: the facts of one role, or the bullets of one
// project. Like the grouper (group.ts), the answer is a choice among ids and nothing else, so the model cannot return
// text, and anything it says that was not sent is dropped.

export type ClusterItem = { key: string; text: string };

/** What the items are: the facts of one role, or the bullets of one project. */
export type ClusterKind = "facts" | "bullets";

/** Groups of two or more keys that tell the same accomplishment. Keys in no group stand alone. */
export type Clusterer = (items: ClusterItem[], prefix: string, kind: ClusterKind) => Promise<string[][]>;

/** More items than this are not sent in one call; a list this long is left as it is. */
export const MAX_ITEMS = 120;
const ITEM_CHARS = 300;
// The output limit counts the model's thinking, which on DeepSeek V4.1 Flash ran past 4,000 tokens for one role of 12
// facts (2026-10-28), so it leaves room for that and an answer of ids.

const SYSTEM = `You find the items in a list that tell the same accomplishment of the candidate, so they can be merged into one.
The career record above is context. Work only on the list in the user message.
Rules:
- Two items are the same accomplishment when they describe the same specific work, even if one says more than the other (more numbers, more tools, a different angle such as engineering or product).
- Items that only share a company, a topic or a tool are different work. Keep them apart.
- When in doubt, keep them apart.
- Bullets of one project all describe that project. Group them only when they say the same thing about it in other words. Different parts of the work (building it, hardening it for production, customer discovery, a launch result) are different items.
- You never write or change any text. You only group the ids you are given. Leave out items that stand alone.`;

const clip = (t: string) => {
  const one = t.replace(/\s+/g, " ").trim();
  return one.length > ITEM_CHARS ? `${one.slice(0, ITEM_CHARS - 3)}...` : one;
};

export function clusterSchema(aliases: string[]) {
  return z.object({ groups: z.array(z.array(z.enum([aliases[0], ...aliases.slice(1)]))) });
}

/** Makes sense of the model's answer: unknown aliases dropped, each item in at most one group (the first), groups of two or more. */
export function readGroups(groups: string[][], items: ClusterItem[]): string[][] {
  const byAlias = new Map(items.map((it, i) => [`i${i + 1}`, it.key]));
  const used = new Set<string>();
  const out: string[][] = [];
  for (const g of groups) {
    const keys = [...new Set(g)].map((a) => byAlias.get(a)).filter((k): k is string => !!k && !used.has(k));
    if (keys.length < 2) continue;
    for (const k of keys) used.add(k);
    // In list order, so the first item of a group is the one that comes first in the record.
    out.push(items.map((it) => it.key).filter((k) => keys.includes(k)));
  }
  return out;
}

/** The clusterer that asks the model. `chat` is injectable so tests never reach the network. */
export function makeClusterer(chat: typeof chatStructured = chatStructured): Clusterer {
  return async (items, prefix, kind) => {
    if (items.length < 2 || items.length > MAX_ITEMS) return [];
    const aliases = items.map((_, i) => `i${i + 1}`);
    const what = kind === "bullets" ? "The bullets of one project" : "The facts of one role";
    const user = `${what}:\n${items.map((it, i) => `i${i + 1}: "${clip(it.text)}"`).join("\n")}\n\nGive the groups of ids that tell the same accomplishment.`;
    const schema = clusterSchema(aliases);
    let last: unknown;
    // One retry: the model sometimes returns text that is not valid JSON.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const result = await chat(schema, { system: SYSTEM, user }, { maxTokens: 16_000, step: "cluster-facts", model: env().RECORD_MODEL, prefix });
        return readGroups(result.groups, items);
      } catch (err) {
        last = err;
      }
    }
    throw new Error(`Could not find repeated facts with the model: ${last instanceof Error ? last.message : "unknown error"}`);
  };
}

export const modelClusterer: Clusterer = makeClusterer();
