import { wordingFitsFraming } from "@/lib/career/framing";
import { normalizeText } from "@/lib/career/normalize";
import type { Role, Wording } from "@/lib/career/schema";
import { numbersIn } from "./proof";
import type { ClashOption, NumberClash } from "./types";

// Where the career record disagrees with itself: one achievement told in several documents, with different numbers for
// the same thing ("activation up 45%" in most, "18%" in one). Everything the user wrote is true to them, so the resume
// does not pick silently: the review screen shows both and recommends the one most of their documents agree on.

/** Words before a number that do not say what it measures: verbs of change, small words. */
const NOT_A_MEASURE = new Set([
  "by", "to", "from", "of", "the", "and", "for", "with", "over", "across", "its", "their", "our", "per", "than", "into",
  "increased", "increase", "increasing", "cut", "cuts", "cutting", "reduced", "reduce", "reducing", "improved", "improve",
  "improving", "raised", "boosted", "lifted", "grew", "grow", "drove", "driving", "achieved", "delivered", "lowered",
  "doubled", "decreased", "saved", "sustaining", "holding", "held", "maintained", "while", "that", "which", "moved",
  "about", "nearly", "almost", "around", "more", "less", "under", "within", "after", "before", "processing",
]);
/** How many words before a number are read for what it measures. */
const WINDOW = 5;
const MIN_MEASURE_CHARS = 4;

/** A measured change in a line, with the words just before it in its clause that say what it measures. */
type Measured = { value: string; measure: Set<string> };

/** A share or a multiple ("45%", "3x", "66.7 percent"): what a result is measured in. Counts ("1,000+ developers") are not. */
const isChange = (word: string, next = "") => /\d%|^\d[\d.]*x$/i.test(word) || /^(%|percent)/i.test(next);

/**
 * The measured changes of a line, each with what it measures ("user activation" for "Increased user activation by
 * 45%"). Counts and sizes are left out: two documents rounding a headcount differently is not worth asking about.
 */
export function measuresIn(text: string): Measured[] {
  const out: Measured[] = [];
  for (const clause of text.split(/[;:,](?:\s|$)|\.(?:\s|$)|\s(?:and|while|then)\s/i)) {
    const words = clause.split(/\s+/).filter(Boolean);
    words.forEach((word, i) => {
      const [value] = numbersIn(word);
      if (value === undefined || !isChange(word.replace(/[^\w.%]+$/, ""), words[i + 1])) return;
      const before = words
        .slice(Math.max(0, i - WINDOW), i)
        .flatMap((w) => normalizeText(w).split(" "))
        .filter((w) => w.length >= MIN_MEASURE_CHARS && !NOT_A_MEASURE.has(w) && numbersIn(w).length === 0);
      out.push({ value, measure: new Set(before) });
    });
  }
  return out;
}

/** The numbers a line gives for one measure. */
const valuesFor = (measured: Measured[], word: string): Set<string> => new Set(measured.filter((m) => m.measure.has(word)).map((m) => m.value));

/** The numbers a line gives for one measure, as one key ("33-50" for a range), or null when it gives none. */
function valueFor(measured: Measured[], word: string): string | null {
  const values = [...valuesFor(measured, word)];
  return values.length > 0 ? values.sort().join("-") : null;
}

/**
 * The measure two lines give different numbers for, or null when they agree or never measure the same thing. They
 * disagree only when they share no number for it: "45% and 60%" against "45%" is the same result told at more length.
 */
function clashingMeasure(a: Measured[], b: Measured[]): string | null {
  for (const m of a) {
    for (const word of m.measure) {
      const va = valuesFor(a, word);
      const vb = valuesFor(b, word);
      if (va.size > 0 && vb.size > 0 && ![...va].some((v) => vb.has(v))) return word;
    }
  }
  return null;
}

/** Whether two of the user's lines give different numbers for the same thing. */
export const wordingsConflict = (a: string, b: string): boolean => clashingMeasure(measuresIn(a), measuresIn(b)) !== null;

/** The role a clash is in, and the telling it is written from, for the recommendation. */
export type ClashScope = { employer: string; role: Role; framingId: string | null };

const isSkillsLine = (text: string) => /^\s*(technologies|tech stack|skills)\s*:/i.test(text);

/**
 * The facts of these roles whose wordings give different numbers for the same thing, one clash per fact. The
 * recommendation is the number most of the fact's wordings give; on a tie, the one told for the role's chosen title,
 * then the one listed first.
 */
export function findClashes(scopes: ClashScope[]): NumberClash[] {
  const clashes: NumberClash[] = [];
  for (const { employer, role, framingId } of scopes) {
    for (const fact of role.facts) {
      const wordings = fact.wordings.filter((w) => w.form === "bullet" && !isSkillsLine(w.text));
      if (wordings.length < 2) continue;
      const measured = new Map(wordings.map((w) => [w.id, measuresIn(w.text)]));
      let measure: string | null = null;
      for (let i = 0; i < wordings.length && !measure; i++) {
        for (let j = i + 1; j < wordings.length && !measure; j++) measure = clashingMeasure(measured.get(wordings[i].id)!, measured.get(wordings[j].id)!);
      }
      if (!measure) continue;

      const groups = new Map<string, Wording[]>();
      for (const w of wordings) {
        const value = valueFor(measured.get(w.id)!, measure);
        if (value) groups.set(value, [...(groups.get(value) ?? []), w]);
      }
      if (groups.size < 2) continue;
      const fits = (w: Wording) => framingId !== null && wordingFitsFraming(role, w, framingId);
      const total = [...groups.values()].reduce((n, g) => n + g.length, 0);
      const options: (ClashOption & { fits: boolean; order: number })[] = [...groups.entries()].map(([, group]) => {
        const shown = group.find(fits) ?? group[0];
        return { wordingId: shown.id, text: shown.text, numbers: numbersIn(shown.text), count: group.length, fits: group.some(fits), order: wordings.indexOf(group[0]) };
      });
      const best = [...options].sort((a, b) => b.count - a.count || Number(b.fits) - Number(a.fits) || a.order - b.order)[0];
      const tied = options.filter((o) => o.count === best.count).length > 1;
      clashes.push({
        factId: fact.id,
        where: employer,
        measure,
        options: options.sort((a, b) => a.order - b.order).map(({ wordingId, text, numbers, count }) => ({ wordingId, text, numbers, count })),
        recommended: best.wordingId,
        reason: tied ? "It is how this line reads for the title the resume uses." : `${best.count} of your ${total} versions of this line say it this way.`,
      });
    }
  }
  return clashes;
}
