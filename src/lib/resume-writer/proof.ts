// How much a line of the candidate's proves: the numbers it gives, the result it states and the things it names. Used to
// choose what a resume is written from (write.ts) and to check what was written against it (faithful.ts).

/** The numbers in a text, without thousands separators: "2,000 merchants, 99.9%" gives 2000 and 99.9. */
export const numbersIn = (text: string): string[] => [...text.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => m[0].replace(/,/g, "").replace(/\.0+$/, ""));

/**
 * The names in a text: tools, products and systems ("Attio", "PostgreSQL", "Next.js", "GitHub Actions"). A capitalized
 * word that starts the text or a sentence is left out, since it is capitalized for that reason.
 */
export function namesIn(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/(^|[.!?]\s+|\s|\()([A-Z][A-Za-z0-9]*(?:[.+#-][A-Za-z0-9]+)*)/g)) {
    const word = m[2];
    const sentenceStart = m.index === 0 || /[.!?]\s+$/.test(m[1]);
    const unusual = /[a-z][A-Z]|[0-9]|[.+#]/.test(word) || word.length <= 4 && word === word.toUpperCase();
    if (sentenceStart && !unusual) continue;
    out.add(word);
  }
  return [...out];
}

/** A line this strong states a result a hiring manager should see: two or more numbers, measured. */
export const STRONG_PROOF = 4;

/** A measured change: a share ("45%"), a multiple ("3x") or a before and after ("from 8 minutes to 1"). */
const MEASURED = /\d[\d,.]*\s*%|\b\d+(?:\.\d+)?x\b|\bfrom\s+\d[\d,.]*\s+\w+\s+to\s+\d/gi;
/**
 * How the work was checked: an accuracy number, an eval, tests, a human approval step or a guardrail. A hiring manager
 * for AI work looks for this on every LLM feature, so a line that says it proves more than one that does not.
 */
const QUALITY = /\b(accura(?:cy|te)|evals?|evaluat\w*|tests?|tested|test suite|human review|approv\w*|guardrails?)\b/i;
/** Whether a text states a measured change ("45%", "3x", "from 8 minutes to 1"). */
export const isMeasured = (text: string): boolean => new RegExp(MEASURED.source, "i").test(text);
/** A verb that states a result rather than an activity. */
const RESULT = /\b(increas|cut|reduc|rais|grew|grow|doubl|tripl|improv|lift|boost|sav|halv|lower|eliminat|accelerat|achiev)/i;

/**
 * How much a line proves, as a rough score: each number counts (up to four), a measured change counts again, a stated
 * result counts once, saying how the work was checked counts once, and named tools and products count a little.
 * "Increased user activation by 45%, cut time-to-value from 8 minutes to 1" scores far above "Owned onboarding and
 * worked with design".
 */
export function proofStrength(text: string): number {
  const numbers = Math.min(numbersIn(text).length, 4);
  const measured = Math.min((text.match(MEASURED) ?? []).length, 3);
  const result = RESULT.test(text) ? 1 : 0;
  const checked = QUALITY.test(text) ? 1 : 0;
  const names = Math.min(namesIn(text).length, 4) * 0.25;
  return numbers + measured + result + checked + names;
}
