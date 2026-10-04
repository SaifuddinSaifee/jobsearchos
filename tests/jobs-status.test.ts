import { describe, expect, it } from "vitest";
import { toCsv } from "@/lib/jobs/csv";
import {
  annualSalary,
  dateToStored,
  formatDate,
  formatSalary,
  localToday,
  relativeDays,
} from "@/lib/jobs/format";
import { safeHref, sourceLabel } from "@/lib/jobs/links";
import { STATUSES, TABS, isClosed, statusRank, tabCounts } from "@/lib/jobs/status";
import { resolveShortcut, type KeyInfo } from "@/components/jobs/table/shortcuts";

describe("status model", () => {
  it("puts every status in exactly one group", () => {
    const groups = new Set(STATUSES.map((s) => s.group));
    expect([...groups].sort()).toEqual(["active", "applied", "closed", "interviews", "offers"]);
    expect(new Set(STATUSES.map((s) => s.value)).size).toBe(STATUSES.length);
  });

  it("covers every status in the tabs, and 'active' excludes exactly the closed ones", () => {
    const active = TABS.find((t) => t.value === "active")!.statuses;
    const closed = TABS.find((t) => t.value === "closed")!.statuses;
    expect([...active, ...closed].sort()).toEqual(STATUSES.map((s) => s.value).sort());
    for (const s of STATUSES) expect(isClosed(s.value)).toBe(closed.includes(s.value));
    // every status is reachable from some non-"active" tab too, except none are lost
    const covered = new Set(TABS.flatMap((t) => t.statuses));
    expect(covered.size).toBe(STATUSES.length);
  });

  it("ranks by pipeline order, not alphabetically", () => {
    expect(statusRank("saved")).toBeLessThan(statusRank("applied"));
    expect(statusRank("applied")).toBeLessThan(statusRank("interview"));
    expect(statusRank("offer")).toBeLessThan(statusRank("rejected"));
  });

  it("counts per tab", () => {
    const c = tabCounts([{ status: "saved" }, { status: "applied" }, { status: "rejected" }, { status: "final_interview" }]);
    expect(c).toMatchObject({ active: 3, saved: 1, applied: 1, interviews: 1, closed: 1, offers: 0 });
  });
});

describe("format", () => {
  it("formats salary ranges", () => {
    expect(formatSalary(150000, 180000, "USD", "year")).toBe("$150k–$180k / yr");
    expect(formatSalary(125700, null, "USD", "year")).toBe("$125.7k / yr");
    expect(formatSalary(50, 70, "EUR", "hour")).toBe("€50–€70 / hr");
    expect(formatSalary(90000, 90000, "CHF", null)).toBe("CHF 90k");
    expect(formatSalary(null, null, "USD", "year")).toBe("");
  });

  it("annualizes salary for sorting", () => {
    expect(annualSalary(null, 100, "hour")).toBe(208000);
    expect(annualSalary(5000, 6000, "month")).toBe(72000);
    expect(annualSalary(100000, null, "year")).toBe(100000);
    expect(annualSalary(null, null, "year")).toBeNull();
  });

  it("formats calendar dates from UTC parts", () => {
    expect(formatDate("2026-01-05T23:59:00.000Z")).toBe("Jan 5, 2026");
    expect(formatDate(null)).toBe("");
    expect(formatDate("garbage")).toBe("");
  });

  it("stores an applied date at noon UTC so it never shifts a day", () => {
    expect(dateToStored("2026-03-09").toISOString()).toBe("2026-03-09T12:00:00.000Z");
    expect(localToday(new Date(2026, 2, 9, 23, 30))).toBe("2026-03-09");
  });

  it("describes relative days", () => {
    const now = new Date("2026-10-10T12:00:00Z");
    expect(relativeDays("2026-10-10T08:00:00Z", now)).toBe("today");
    expect(relativeDays("2026-10-09T08:00:00Z", now)).toBe("1d ago");
    expect(relativeDays("2026-10-03T12:00:00Z", now)).toBe("7d ago");
    expect(relativeDays("2026-05-03T12:00:00Z", now)).toBe("5mo ago");
  });
});

describe("links", () => {
  it("only allows http(s)", () => {
    expect(safeHref("https://a.com/x?y=1")).toBe("https://a.com/x?y=1");
    expect(safeHref("http://a.com")).toBe("http://a.com/");
    for (const bad of ["javascript:alert(1)", "data:text/html,<b>", "/relative", "garbage", "", null, undefined, "ftp://x"]) {
      expect(safeHref(bad)).toBeNull();
    }
  });
  it("labels sources", () => {
    expect(sourceLabel("greenhouse")).toBe("Greenhouse");
    expect(sourceLabel("paste")).toBe("Pasted");
    expect(sourceLabel("jsonld")).toBe("Page");
    expect(sourceLabel(null)).toBe("Page");
  });
});

describe("toCsv", () => {
  const cols = [
    { header: "Name", value: (r: { n: string; v?: number }) => r.n },
    { header: "Value", value: (r: { n: string; v?: number }) => r.v },
  ];
  it("quotes commas, quotes and newlines", () => {
    expect(toCsv([{ n: 'A, "B"\nC', v: 1 }], cols)).toBe('Name,Value\r\n"A, ""B""\nC",1\r\n');
  });
  it("neutralizes spreadsheet formulas", () => {
    expect(toCsv([{ n: "=HYPERLINK(1)" }, { n: "+1" }, { n: "-1" }, { n: "@x" }], cols)).toContain("'=HYPERLINK(1)");
    expect(toCsv([{ n: "@x" }], cols)).toContain("'@x");
  });
  it("renders null and undefined as empty", () => {
    expect(toCsv([{ n: "a" }], cols)).toBe("Name,Value\r\na,\r\n");
  });
});

describe("resolveShortcut", () => {
  const base: KeyInfo = { key: "", shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, tag: "BODY", editable: false, inMenu: false };
  const press = (over: Partial<KeyInfo>) => resolveShortcut({ ...base, ...over });

  it("maps keys to actions", () => {
    expect(press({ key: "/" })).toBe("focus-search");
    expect(press({ key: "j" })).toBe("next");
    expect(press({ key: "ArrowUp" })).toBe("prev");
    expect(press({ key: "Enter" })).toBe("open");
    expect(press({ key: "x" })).toBe("toggle-select");
    expect(press({ key: "A", shiftKey: true })).toBe("mark-applied");
    expect(press({ key: "Escape" })).toBe("escape");
  });
  it("ignores typing, menus and modifiers", () => {
    expect(press({ key: "j", tag: "INPUT" })).toBeNull();
    expect(press({ key: "j", tag: "TEXTAREA" })).toBeNull();
    expect(press({ key: "j", editable: true })).toBeNull();
    expect(press({ key: "j", inMenu: true })).toBeNull();
    expect(press({ key: "j", ctrlKey: true })).toBeNull();
    expect(press({ key: "/", metaKey: true })).toBeNull();
  });
  it("keeps Enter native on buttons and links, but Escape always works", () => {
    expect(press({ key: "Enter", tag: "BUTTON" })).toBeNull();
    expect(press({ key: "Enter", tag: "A" })).toBeNull();
    expect(press({ key: "Escape", tag: "INPUT" })).toBe("escape");
  });
});
