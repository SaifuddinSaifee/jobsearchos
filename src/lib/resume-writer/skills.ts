import { normalizeText, skillKey } from "@/lib/career/normalize";
import { containsPhrase } from "./context";

// The skills section, written by code from the candidate's own skills. Choosing 30 to 40 of a long list and grouping them
// is bookkeeping, and asking the writer model to do it cost it thousands of tokens of thinking on every draft (one draft
// ran out of room on it). Code does it the same way every time: the candidate's own categories, tidied; every skill the
// job asks for; then the rest of each category in the candidate's own order, up to about a resume's worth.

export type SkillLine = { category: string; items: string[] };

/** About how many skills the section lists in all: comprehensive, the way a strong resume lists what a hiring manager scans for. */
export const SKILLS_TARGET = 36;
export const MAX_SKILL_LINES = 6;
export const MAX_SKILLS_PER_LINE = 14;
/** A category with fewer skills than this is not a line of its own when the candidate has bigger ones. */
const MIN_LINE = 3;

/** A category that says nothing about what is in it: its skills go to the candidate's specific categories where they fit. */
const GENERIC = /^(skills?|technical skills|technolog(y|ies)|tools?|other|misc(ellaneous)?|general)$/i;
/** Interests are their own line, written from what the user ticked. */
const INTEREST = /interest|hobb/i;
/** Words too common to say two skills belong together. */
const COMMON = new Set(["and", "of", "the", "for", "with", "in", "on", "to", "a"]);

/** A skill split mid-list when it was brought in ("LLM APIs (OpenAI", "Ollama)"): the whole one is usually also there. */
const unbalanced = (name: string) => (name.match(/\(/g)?.length ?? 0) !== (name.match(/\)/g)?.length ?? 0);
const wordsOf = (text: string) => new Set(normalizeText(text).split(" ").filter((w) => w && !COMMON.has(w)));

/**
 * A tool or technology's name ("Rails", "Claude Code", "MCP", "n8n") rather than a product area or a kind of work
 * ("Video streaming", "Realtime voice agents"): every longer word is capitalized or has a digit. A product area the
 * candidate worked on is proven in a bullet; in the skills lines it reads as words shoved in.
 */
export const isNamed = (text: string): boolean =>
  text
    .split(/[\s/]+/)
    .filter((w) => /[a-z]/i.test(w) && w.length >= 3)
    .every((w) => /^[A-Z0-9]/.test(w) || /[A-Z0-9]/.test(w.slice(1)));

type Entry = { name: string; category: string; order: number; wanted: boolean };

/** How many words two sets share. */
const shared = (a: Set<string>, b: Set<string>) => [...a].filter((w) => b.has(w)).length;

/**
 * The skills lines for a job. `wanted` says whether the job asks for a skill; `claimed` are skills the user said they have
 * that the record may not list (Rails, ticked on the review screen), which always go on, next to the skills they are like.
 *
 * - A skill split mid-bracket is left out, as is a repeat or one a longer skill already says ("AWS" next to
 *   "AWS (EC2, S3, Lambda)").
 * - A category that is the start of a longer one joins it ("Frameworks" into "Frameworks & Libraries"). A generic one
 *   ("Skills", "Technologies") gives each of its skills to the category whose skills share a word with it; the rest
 *   stay together, last.
 * - A small category, next to bigger ones, keeps only the named tools the job asks for, on the closest bigger line.
 * - Each line lists the job's skills first, then its own in the candidate's order, until the section has about
 *   `SKILLS_TARGET`. The lines with the most of what the job asks for come first.
 */
export function composeSkills(skills: { name: string; category: string }[], wanted: (name: string) => boolean, claimed: string[] = []): SkillLine[] {
  const all = skills
    .filter((s) => !INTEREST.test(s.category))
    .map((s, order) => ({ name: s.name.replace(/\s+/g, " ").trim(), category: s.category.trim() || "Skills", order }));

  // The words of every skill under a category, broken ones included: they still say what the category is about.
  const categories = [...new Set(all.map((s) => s.category))];
  const vocabulary = new Map(categories.map((c) => [c, wordsOf(all.filter((s) => s.category === c).map((s) => s.name).join(" "))]));

  // Where each category's skills go.
  const specific = categories.filter((c) => !GENERIC.test(c));
  const joined = (c: string) => specific.find((o) => o !== c && normalizeText(o).startsWith(`${normalizeText(c)} `)) ?? c;
  const generic = categories.filter((c) => GENERIC.test(c));
  const leftover = generic.find((c) => !/^skills?$/i.test(c)) ?? (generic.length > 0 ? "Other" : null);
  const closestIn = (words: Map<string, Set<string>>) => (name: string, among: string[]): string | null => {
    const mine = wordsOf(name);
    const best = among.map((c) => ({ c, n: shared(mine, words.get(c) ?? new Set()) })).sort((a, b) => b.n - a.n)[0];
    return best && best.n > 0 ? best.c : null;
  };
  const homeOf = (s: { name: string; category: string }) => (GENERIC.test(s.category) ? (closestIn(vocabulary)(s.name, specific) ?? leftover ?? s.category) : joined(s.category));
  // The words of every skill that ends up on a line, to place a skill that has no category of its own.
  const lineWords = new Map<string, Set<string>>();
  for (const s of all) {
    const home = homeOf(s);
    lineWords.set(home, new Set([...(lineWords.get(home) ?? []), ...wordsOf(s.name)]));
  }
  const closest = closestIn(lineWords);

  // Whole skills only, each once, and none a longer one already says.
  const seen = new Set<string>();
  const whole = all.filter((s) => s.name && !unbalanced(s.name) && !seen.has(skillKey(s.name)) && !!seen.add(skillKey(s.name)));
  const sets = whole.map((s) => wordsOf(s.name));
  const entries: Entry[] = whole
    .filter((_, i) => !sets.some((o, j) => j !== i && o.size > sets[i].size && [...sets[i]].every((w) => o.has(w))))
    .map((s) => ({ name: s.name, category: homeOf(s), order: s.order, wanted: wanted(s.name) }));

  const lines = new Map<string, Entry[]>();
  for (const e of entries) lines.set(e.category, [...(lines.get(e.category) ?? []), e]);

  // A small category next to bigger ones keeps only the named tools the job asks for, on the closest bigger line.
  const big = [...lines.keys()].filter((c) => (lines.get(c)?.length ?? 0) >= MIN_LINE);
  if (big.length > 0) {
    for (const c of [...lines.keys()].filter((x) => !big.includes(x))) {
      const asked = (lines.get(c) ?? []).filter((e) => e.wanted && isNamed(e.name));
      lines.delete(c);
      for (const e of asked) {
        const to = closest(e.name, big) ?? (leftover && big.includes(leftover) ? leftover : big[0]);
        lines.set(to, [...(lines.get(to) ?? []), { ...e, category: to }]);
      }
    }
  }

  // The lines with the most of what the job asks for first; the generic leftovers last.
  const askedIn = (c: string) => (lines.get(c) ?? []).filter((e) => e.wanted).length;
  const first = (c: string) => Math.min(...(lines.get(c) ?? []).map((e) => e.order));
  const ranked = [...lines.keys()]
    .sort((a, b) => Number(a === leftover) - Number(b === leftover) || askedIn(b) - askedIn(a) || first(a) - first(b))
    .slice(0, MAX_SKILL_LINES);

  // Everything the job asks for, then the rest of each line in turn, in the candidate's order.
  const picked = new Map(ranked.map((c) => [c, (lines.get(c) ?? []).filter((e) => e.wanted).sort((a, b) => a.order - b.order).slice(0, MAX_SKILLS_PER_LINE)]));
  const rest = new Map(ranked.map((c) => [c, (lines.get(c) ?? []).filter((e) => !e.wanted).sort((a, b) => a.order - b.order)]));
  let total = [...picked.values()].reduce((n, l) => n + l.length, 0);
  for (let added = true; added && total < SKILLS_TARGET; ) {
    added = false;
    for (const c of ranked) {
      const line = picked.get(c)!;
      const next = rest.get(c)!.shift();
      if (!next || line.length >= MAX_SKILLS_PER_LINE || total >= SKILLS_TARGET) continue;
      line.push(next);
      total++;
      added = true;
    }
  }
  const out: SkillLine[] = ranked.map((c) => ({ category: c, items: picked.get(c)!.map((e) => e.name) })).filter((l) => l.items.length > 0);

  // What the user said they have goes on, next to the skills it is like, after the job's other skills.
  for (const name of claimed) {
    const mine = wordsOf(name);
    const said = out.some((l) => l.items.some((i) => skillKey(i) === skillKey(name) || [...mine].every((w) => wordsOf(i).has(w))));
    if (!name.trim() || mine.size === 0 || said) continue;
    const home = closest(name, out.map((l) => l.category));
    const line = out.find((l) => l.category === home) ?? out.find((l) => l.category === leftover) ?? out[0];
    if (!line) {
      out.push({ category: "Skills", items: [name] });
      continue;
    }
    const asked = line.items.filter((i) => wanted(i)).length;
    line.items.splice(asked, 0, name);
  }
  return out;
}

/** Whether the job asks for a skill: one of its terms, or a skill its requirements name. */
export function skillWanted(terms: string[], requirementTexts: string[]): (name: string) => boolean {
  const termKeys = terms.map(normalizeText).filter(Boolean);
  const asked = requirementTexts.map(normalizeText);
  return (name) => {
    const key = normalizeText(name);
    if (!key) return false;
    // A short name ("Go", "C") only counts as itself: "go" is in "go-to-market".
    const inside = key.length >= 3;
    return termKeys.some((t) => t === key || (t.length >= 3 && containsPhrase(key, t)) || (inside && containsPhrase(t, key))) || (inside && asked.some((r) => containsPhrase(r, key)));
  };
}
