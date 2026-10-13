// Reading the many ways dates are written on a resume, and comparing them as month ranges. Pure.

export type DateParts = { start: string; end: string; current: boolean };

/** A role's time as months since year 0. `to` is null while the role is still going. */
export type Span = { from: number; to: number | null; fuzzy: boolean };

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5,
  jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

/** First and last month of a season, as month numbers. Winter runs into the next year. */
const SEASONS: Record<string, [number, number]> = {
  spring: [3, 5],
  summer: [6, 8],
  fall: [9, 11],
  autumn: [9, 11],
  winter: [12, 14],
};

const PRESENT = /^(present|current|now|ongoing|today)$/i;

export const isPresent = (text: string) => PRESENT.test(text.trim());

/** Drops LinkedIn's duration tails: "Jan 2022 - Present (2 yrs 3 mos)" and the same after a middle dot or bar. */
export function cleanDatesText(text: string): string {
  return text
    .replace(/\(\s*\d+\s*(?:yrs?|years?|mos?|months?)\b[^)]*\)/gi, " ")
    .replace(/\s[\u00b7\u2022|]\s*\d+\s*(?:yrs?|years?|mos?|months?)\b.*$/i, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function year(raw: string): number | null {
  const n = Number(raw.replace(/^'/, ""));
  if (!Number.isInteger(n)) return null;
  if (raw.replace(/^'/, "").length === 2) return n < 70 ? 2000 + n : 1900 + n;
  return n >= 1950 && n <= 2100 ? n : null;
}

const idx = (y: number, m: number) => y * 12 + (m - 1);

/**
 * One date as a month number. A start reads as the first month of the period it names and an end as the last
 * ("2022" as a start is January, as an end December). Unclear precision (a year, a quarter, a season) is fuzzy.
 */
export function parseMonth(text: string, edge: "start" | "end"): { month: number; fuzzy: boolean } | null {
  const t = text.trim().toLowerCase().replace(/[.,]/g, "").replace(/\s+/g, " ");
  if (!t) return null;
  let m: RegExpMatchArray | null;

  if ((m = t.match(/^(\d{1,2})[/-](\d{4})$/))) {
    const mo = Number(m[1]);
    const y = year(m[2]);
    return mo >= 1 && mo <= 12 && y ? { month: idx(y, mo), fuzzy: false } : null;
  }
  if ((m = t.match(/^(\d{4})[/-](\d{1,2})$/))) {
    const mo = Number(m[2]);
    const y = year(m[1]);
    return mo >= 1 && mo <= 12 && y ? { month: idx(y, mo), fuzzy: false } : null;
  }
  if ((m = t.match(/^q([1-4])\s+'?(\d{2,4})$/))) {
    const y = year(m[2]);
    const q = Number(m[1]);
    return y ? { month: idx(y, edge === "start" ? (q - 1) * 3 + 1 : q * 3), fuzzy: true } : null;
  }
  if ((m = t.match(/^([a-z]+)\s+'?(\d{2,4})$/))) {
    const y = year(m[2]);
    if (!y) return null;
    if (MONTHS[m[1]]) return { month: idx(y, MONTHS[m[1]]), fuzzy: false };
    const season = SEASONS[m[1]];
    if (season) return { month: idx(y, edge === "start" ? season[0] : season[1]), fuzzy: true };
    return null;
  }
  if ((m = t.match(/^(\d{4})$/))) {
    const y = year(m[1]);
    return y ? { month: idx(y, edge === "start" ? 1 : 12), fuzzy: true } : null;
  }
  return null;
}

/** The range a role covers, or null when its start cannot be read. No end and not current counts as that one period. */
export function toSpan(d: DateParts): Span | null {
  const start = parseMonth(cleanDatesText(d.start), "start");
  if (!start) return null;
  if (d.current || isPresent(d.end)) return { from: start.month, to: null, fuzzy: start.fuzzy };
  if (!d.end.trim()) {
    const whole = parseMonth(cleanDatesText(d.start), "end");
    return { from: start.month, to: whole?.month ?? start.month, fuzzy: true };
  }
  const end = parseMonth(cleanDatesText(d.end), "end");
  if (!end) return { from: start.month, to: start.month, fuzzy: true };
  return { from: start.month, to: Math.max(end.month, start.month), fuzzy: start.fuzzy || end.fuzzy };
}

/** The month number of today, used to close ranges that are still open. */
export const monthOf = (date: Date) => idx(date.getUTCFullYear(), date.getUTCMonth() + 1);

const closedTo = (s: Span, now: number) => s.to ?? Math.max(now, s.from);

/** Months in the range, counting both ends. */
export const spanMonths = (s: Span, now: number) => closedTo(s, now) - s.from + 1;

/** Months two ranges share, counting both ends. Ranges that meet in one month share one. */
export function overlapMonths(a: Span, b: Span, now: number): number {
  return Math.max(0, Math.min(closedTo(a, now), closedTo(b, now)) - Math.max(a.from, b.from) + 1);
}

export type DateMerge = { dates: DateParts; conflict: boolean };

/**
 * The widest range covering both. `conflict` is true only when both are precise and disagree, so a resume that
 * says "2021" never contradicts one that says "Mar 2021".
 */
export function mergeDates(a: DateParts, b: DateParts): DateMerge {
  const sa = toSpan(a);
  const sb = toSpan(b);
  if (!sa && !sb) return { dates: a, conflict: false };
  if (!sa) return { dates: b, conflict: false };
  if (!sb) return { dates: a, conflict: false };

  const startFrom = pickStart(a, sa, b, sb);
  const endFrom = pickEnd(a, sa, b, sb);
  const dates: DateParts = {
    start: startFrom.start,
    end: endFrom.current ? "" : endFrom.end,
    current: endFrom.current,
  };
  const precise = !sa.fuzzy && !sb.fuzzy;
  const conflict = precise && (sa.from !== sb.from || sa.to !== sb.to);
  return { dates, conflict };
}

function pickStart(a: DateParts, sa: Span, b: DateParts, sb: Span): DateParts {
  if (sa.from !== sb.from) return sa.from < sb.from ? a : b;
  return sa.fuzzy && !sb.fuzzy ? b : a;
}

function pickEnd(a: DateParts, sa: Span, b: DateParts, sb: Span): DateParts {
  if (sa.to === null) return a;
  if (sb.to === null) return b;
  if (sa.to !== sb.to) return sa.to > sb.to ? a : b;
  return sa.fuzzy && !sb.fuzzy ? b : a;
}

/** "Jan 2022 - Present" for a note or a label. */
export function formatDates(d: DateParts): string {
  const end = d.current ? "Present" : d.end;
  return [d.start, end].filter(Boolean).join(" - ");
}
