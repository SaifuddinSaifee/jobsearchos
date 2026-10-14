import { describe, expect, it } from "vitest";
import {
  cleanDatesText,
  formatDates,
  mergeDates,
  monthOf,
  overlapMonths,
  parseMonth,
  spanMonths,
  toSpan,
} from "@/lib/career/dates";

const NOW = monthOf(new Date(Date.UTC(2026, 9, 1)));
const m = (y: number, mo: number) => y * 12 + (mo - 1);

describe("parseMonth", () => {
  const cases: [string, "start" | "end", number | null, boolean][] = [
    ["Jan 2022", "start", m(2022, 1), false],
    ["January 2022", "start", m(2022, 1), false],
    ["Jan. 2022", "start", m(2022, 1), false],
    ["jan 2022", "end", m(2022, 1), false],
    ["Sept 2022", "start", m(2022, 9), false],
    ["Sep 2022", "end", m(2022, 9), false],
    ["Dec 2019", "end", m(2019, 12), false],
    ["01/2022", "start", m(2022, 1), false],
    ["1/2022", "start", m(2022, 1), false],
    ["12/2021", "end", m(2021, 12), false],
    ["2022-01", "start", m(2022, 1), false],
    ["2022-1", "start", m(2022, 1), false],
    ["2022", "start", m(2022, 1), true],
    ["2022", "end", m(2022, 12), true],
    ["Q3 2021", "start", m(2021, 7), true],
    ["Q3 2021", "end", m(2021, 9), true],
    ["Summer 2021", "start", m(2021, 6), true],
    ["Summer 2021", "end", m(2021, 8), true],
    ["Spring 2020", "start", m(2020, 3), true],
    ["Fall 2020", "end", m(2020, 11), true],
    ["Jan '22", "start", m(2022, 1), false],
    ["Jan 22", "start", m(2022, 1), false],
    ["Mar 98", "start", m(1998, 3), false],
    ["  Mar   2020  ", "start", m(2020, 3), false],
    ["13/2022", "start", null, false],
    ["Smarch 2022", "start", null, false],
    ["recently", "start", null, false],
    ["", "start", null, false],
    ["1850", "start", null, false],
  ];
  it.each(cases)("%s as %s", (text, edge, month, fuzzy) => {
    const got = parseMonth(text, edge);
    if (month === null) expect(got).toBeNull();
    else expect(got).toEqual({ month, fuzzy });
  });
});

describe("cleanDatesText", () => {
  it("drops LinkedIn duration tails", () => {
    expect(cleanDatesText("Jan 2022 - Present (2 yrs 3 mos)")).toBe("Jan 2022 - Present");
    expect(cleanDatesText("Jan 2022 - Mar 2023 · 1 yr 2 mos")).toBe("Jan 2022 - Mar 2023");
    expect(cleanDatesText("Jan 2022 - Mar 2023")).toBe("Jan 2022 - Mar 2023");
  });
});

describe("toSpan", () => {
  it("reads a precise closed range", () => {
    expect(toSpan({ start: "Jan 2020", end: "Mar 2021", current: false })).toEqual({ from: m(2020, 1), to: m(2021, 3), fuzzy: false });
  });
  it("leaves a current role open", () => {
    expect(toSpan({ start: "Jan 2020", end: "", current: true })).toEqual({ from: m(2020, 1), to: null, fuzzy: false });
    expect(toSpan({ start: "Jan 2020", end: "Present", current: false })?.to).toBeNull();
  });
  it("is fuzzy for bare years", () => {
    expect(toSpan({ start: "2019", end: "2021", current: false })).toEqual({ from: m(2019, 1), to: m(2021, 12), fuzzy: true });
  });
  it("reads a single date as that one period", () => {
    expect(toSpan({ start: "Jun 2021", end: "", current: false })?.fuzzy).toBe(true);
  });
  it("is null when the start cannot be read", () => {
    expect(toSpan({ start: "a while ago", end: "now", current: false })).toBeNull();
  });
});

describe("overlap", () => {
  const a = toSpan({ start: "Jan 2020", end: "Jan 2022", current: false })!;
  const b = toSpan({ start: "Jan 2022", end: "", current: true })!;
  it("counts both ends, so back to back roles share one month", () => {
    expect(overlapMonths(a, b, NOW)).toBe(1);
  });
  it("is zero for roles that do not meet", () => {
    const c = toSpan({ start: "Mar 2022", end: "", current: true })!;
    expect(overlapMonths(a, c, NOW)).toBe(0);
  });
  it("measures an open role up to today", () => {
    expect(spanMonths(b, NOW)).toBe(NOW - m(2022, 1) + 1);
  });
});

describe("mergeDates", () => {
  const d = (start: string, end: string, current = false) => ({ start, end, current });
  it("widens to cover both", () => {
    const r = mergeDates(d("Mar 2020", "Dec 2021"), d("Jan 2020", "Jun 2021"));
    expect(r.dates).toEqual(d("Jan 2020", "Dec 2021"));
  });
  it("a role that is still going wins the end", () => {
    const r = mergeDates(d("Jan 2020", "Dec 2021"), d("Jan 2020", "", true));
    expect(r.dates).toEqual(d("Jan 2020", "", true));
  });
  it("flags a disagreement only between precise dates", () => {
    expect(mergeDates(d("Feb 2020", "Mar 2022"), d("Jan 2020", "Mar 2022")).conflict).toBe(true);
    expect(mergeDates(d("2020", "2022"), d("Feb 2020", "Mar 2022")).conflict).toBe(false);
    expect(mergeDates(d("Jan 2020", "Mar 2022"), d("Jan 2020", "Mar 2022")).conflict).toBe(false);
  });
  it("prefers the precise date over a bare year of the same month", () => {
    const r = mergeDates(d("2020", "2022"), d("Jan 2020", "Dec 2022"));
    expect(r.dates.start).toBe("Jan 2020");
    expect(r.dates.end).toBe("Dec 2022");
  });
  it("keeps the readable side when the other is unreadable", () => {
    expect(mergeDates(d("Jan 2020", "Dec 2021"), d("long ago", "")).dates).toEqual(d("Jan 2020", "Dec 2021"));
    expect(mergeDates(d("long ago", ""), d("Jan 2020", "Dec 2021")).dates).toEqual(d("Jan 2020", "Dec 2021"));
  });
});

it("formatDates", () => {
  expect(formatDates({ start: "Jan 2020", end: "", current: true })).toBe("Jan 2020 - Present");
  expect(formatDates({ start: "Jan 2020", end: "Dec 2021", current: false })).toBe("Jan 2020 - Dec 2021");
});
