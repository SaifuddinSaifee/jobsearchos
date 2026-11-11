import { statusInfo } from "@/lib/jobs/status";
import type { DiscoveredJob } from "./types";

// Client-safe: no database imports.

/** The source picks from the Daily Job Shortlist arrive with; shown as "Found by Claude". */
const SOURCE_TITLES: Record<string, string> = { "Claude.ai": "Found by Claude" };

export function sourceTitle(source: string): string {
  return SOURCE_TITLES[source] ?? `From ${source}`;
}

/** The tab for jobs the source gave no track. */
export const NO_TRACK = "__none__";

export const PROGRESS_FILTERS = ["any", "needs_you", "reading", "to_apply", "applied"] as const;
export type ProgressFilter = (typeof PROGRESS_FILTERS)[number];
export const PROGRESS_LABEL: Record<ProgressFilter, string> = {
  any: "Any status",
  needs_you: "Needs you",
  reading: "Being read",
  to_apply: "In Jobs, not applied yet",
  applied: "Applied or further",
};

export const MIN_FITS = [0, 60, 70, 80] as const;
export type MinFit = (typeof MIN_FITS)[number];

export const SORTS = ["newest", "fit", "posted", "company"] as const;
export type DiscoverSort = (typeof SORTS)[number];
export const SORT_LABEL: Record<DiscoverSort, string> = {
  newest: "Newest sent",
  fit: "Best fit",
  posted: "Recently posted",
  company: "Company, A to Z",
};

export type DiscoverFilters = {
  /** A track, `NO_TRACK`, or "all". */
  track: string;
  search: string;
  progress: ProgressFilter;
  /** Lowercased work mode ("remote", "hybrid", "on-site"), or "any". */
  mode: string;
  minFit: MinFit;
  payListed: boolean;
};

export const DEFAULT_FILTERS: DiscoverFilters = { track: "all", search: "", progress: "any", mode: "any", minFit: 0, payListed: false };

export function trackKey(job: Pick<DiscoveredJob, "track">): string {
  return job.track.trim() || NO_TRACK;
}

/** The tracks in these jobs, most jobs first, with jobs that have none last. */
export function tracksOf(jobs: DiscoveredJob[]): string[] {
  const counts = new Map<string, number>();
  for (const j of jobs) counts.set(trackKey(j), (counts.get(trackKey(j)) ?? 0) + 1);
  return [...counts.entries()]
    .sort(([a, x], [b, y]) => (a === NO_TRACK ? 1 : b === NO_TRACK ? -1 : y - x || a.localeCompare(b)))
    .map(([t]) => t);
}

/** The work modes in these jobs (lowercased key and the label as the source wrote it), alphabetical. */
export function modesOf(jobs: DiscoveredJob[]): { key: string; label: string }[] {
  const modes = new Map<string, string>();
  for (const j of jobs) {
    const m = j.mode.trim();
    if (m && !modes.has(m.toLowerCase())) modes.set(m.toLowerCase(), m);
  }
  return [...modes.entries()].map(([key, label]) => ({ key, label })).sort((a, b) => a.label.localeCompare(b.label));
}

function matchesProgress(job: DiscoveredJob, progress: ProgressFilter): boolean {
  switch (progress) {
    case "any":
      return true;
    case "needs_you":
      return job.state === "review" || job.state === "failed" || job.state === "not_added" || job.state === "gone";
    case "reading":
      return job.state === "reading";
    case "to_apply":
      return job.state === "in_jobs" && (!job.jobStatus || statusInfo(job.jobStatus).group === "active");
    case "applied":
      return job.state === "in_jobs" && !!job.jobStatus && statusInfo(job.jobStatus).group !== "active";
  }
}

function matchesSearch(job: DiscoveredJob, search: string): boolean {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const text = [job.title, job.company, job.location, job.mode, job.track, job.pay, job.why, job.leadWith].join(" ").toLowerCase();
  return words.every((w) => text.includes(w));
}

/** Every filter but the track, so tab counts can show what each tab would hold. */
export function matchesFilters(job: DiscoveredJob, f: DiscoverFilters): boolean {
  return (
    matchesProgress(job, f.progress) &&
    (f.mode === "any" || job.mode.trim().toLowerCase() === f.mode) &&
    (f.minFit === 0 || (job.fit ?? -1) >= f.minFit) &&
    (!f.payListed || job.pay.trim() !== "") &&
    matchesSearch(job, f.search)
  );
}

/** How many filters besides the track and search are set (for the Filters button badge). */
export function activeFilterCount(f: DiscoverFilters): number {
  return (f.progress !== "any" ? 1 : 0) + (f.mode !== "any" ? 1 : 0) + (f.minFit ? 1 : 0) + (f.payListed ? 1 : 0);
}

const byNewest = (a: DiscoveredJob, b: DiscoveredJob) => b.createdAt.localeCompare(a.createdAt);

/** A new array in the chosen order; ties, and jobs missing the field sorted on, fall back to newest sent. */
export function sortJobs(jobs: DiscoveredJob[], sort: DiscoverSort): DiscoveredJob[] {
  const out = [...jobs];
  switch (sort) {
    case "newest":
      return out.sort(byNewest);
    case "fit":
      return out.sort((a, b) => (b.fit ?? -1) - (a.fit ?? -1) || byNewest(a, b));
    case "posted":
      // YYYY-MM-DD compares as text; an unknown date goes last.
      return out.sort((a, b) => (b.posted || "").localeCompare(a.posted || "") || byNewest(a, b));
    case "company":
      return out.sort((a, b) => Number(!a.company) - Number(!b.company) || a.company.localeCompare(b.company) || byNewest(a, b));
  }
}
