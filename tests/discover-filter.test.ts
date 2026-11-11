import { describe, expect, it } from "vitest";
import { activeFilterCount, DEFAULT_FILTERS, matchesFilters, modesOf, NO_TRACK, sortJobs, sourceTitle, tracksOf } from "@/lib/discover/filter";
import type { DiscoveredJob } from "@/lib/discover/types";

function job(over: Partial<DiscoveredJob>): DiscoveredJob {
  return {
    id: over.id ?? "x",
    url: "https://example.com/1",
    source: "Claude.ai",
    title: "",
    company: "",
    location: "",
    mode: "",
    pay: "",
    posted: "",
    track: "",
    fit: null,
    why: "",
    leadWith: "",
    applyHow: "",
    createdAt: "2026-10-20T00:00:00.000Z",
    state: "reading",
    reason: null,
    queueId: null,
    jobId: null,
    jobStatus: null,
    ...over,
  };
}

const a = job({ id: "a", title: "AI Engineer", company: "Zeta", track: "AI/LLM", mode: "Remote", fit: 84, pay: "30-60L", posted: "2026-10-21", createdAt: "2026-10-19T00:00:00.000Z", state: "in_jobs", jobStatus: "saved" });
const b = job({ id: "b", title: "Product Manager", company: "Acme", track: "APM/PM", mode: "On-site", fit: 60, createdAt: "2026-10-22T00:00:00.000Z", state: "failed" });
const c = job({ id: "c", title: "Applied LLM Engineer", company: "Beta", track: "AI/LLM", mode: "remote", fit: 72, posted: "2026-10-05", createdAt: "2026-10-21T00:00:00.000Z", state: "in_jobs", jobStatus: "applied" });
const d = job({ id: "d", title: "Mystery role", createdAt: "2026-10-18T00:00:00.000Z" });
const all = [a, b, c, d];
const ids = (list: DiscoveredJob[]) => list.map((j) => j.id);
const filtered = (patch: Partial<typeof DEFAULT_FILTERS>) => ids(all.filter((j) => matchesFilters(j, { ...DEFAULT_FILTERS, ...patch })));

describe("discover filters", () => {
  it("names Claude's picks", () => {
    expect(sourceTitle("Claude.ai")).toBe("Found by Claude");
    expect(sourceTitle("YC")).toBe("From YC");
  });

  it("lists tracks by size with untracked jobs last, and modes once regardless of case", () => {
    expect(tracksOf(all)).toEqual(["AI/LLM", "APM/PM", NO_TRACK]);
    expect(modesOf(all)).toEqual([
      { key: "on-site", label: "On-site" },
      { key: "remote", label: "Remote" },
    ]);
  });

  it("filters by status, mode, fit, pay and search words", () => {
    expect(filtered({})).toEqual(["a", "b", "c", "d"]);
    expect(filtered({ progress: "needs_you" })).toEqual(["b"]);
    expect(filtered({ progress: "reading" })).toEqual(["d"]);
    expect(filtered({ progress: "to_apply" })).toEqual(["a"]);
    expect(filtered({ progress: "applied" })).toEqual(["c"]);
    expect(filtered({ mode: "remote" })).toEqual(["a", "c"]);
    expect(filtered({ minFit: 70 })).toEqual(["a", "c"]);
    expect(filtered({ payListed: true })).toEqual(["a"]);
    expect(filtered({ search: "llm beta" })).toEqual(["c"]);
    expect(activeFilterCount({ ...DEFAULT_FILTERS, mode: "remote", minFit: 70, search: "x", track: "AI/LLM" })).toBe(2);
  });

  it("sorts, putting missing values last and breaking ties by newest sent", () => {
    expect(ids(sortJobs(all, "newest"))).toEqual(["b", "c", "a", "d"]);
    expect(ids(sortJobs(all, "fit"))).toEqual(["a", "c", "b", "d"]);
    expect(ids(sortJobs(all, "posted"))).toEqual(["a", "c", "b", "d"]);
    expect(ids(sortJobs(all, "company"))).toEqual(["b", "c", "a", "d"]);
  });
});
