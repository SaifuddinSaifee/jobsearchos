import type { QueueSteps } from "@/lib/db/schema";

// Client-safe: no database imports.

export type QueueStatus = "queued" | "running" | "saved" | "needs_review" | "duplicate" | "failed";
export type { QueueSteps };

/** A queue row as shown in lists (the draft and the raw input are not included). */
export type QueueItem = {
  id: string;
  kind: "url" | "text";
  label: string;
  status: QueueStatus;
  steps: QueueSteps;
  error: string | null;
  errorCode: string | null;
  jobId: string | null;
  duplicateJobId: string | null;
  createdAt: string;
  finishedAt: string | null;
};

export type QueueSnapshot = {
  items: QueueItem[];
  counts: Record<QueueStatus, number>;
};

export const STEP_ORDER = ["detect", "fetch", "render", "structure", "company"] as const;

export const STEP_LABELS: Record<(typeof STEP_ORDER)[number], string> = {
  detect: "Detect source",
  fetch: "Fetch posting",
  render: "Render page",
  structure: "Structure with AI",
  company: "Research the company",
};

/** Items the user may still need to look at, or that are still working. */
export const ACTIVE_STATUSES: QueueStatus[] = ["queued", "running"];

export const MAX_BATCH = 50;
export const MAX_ACTIVE = 200;

/** The step currently running, else the last one finished, for a one-line status. */
export function currentStep(steps: QueueSteps): { name: (typeof STEP_ORDER)[number]; status: string; detail?: string } | null {
  let last: { name: (typeof STEP_ORDER)[number]; status: string; detail?: string } | null = null;
  for (const name of STEP_ORDER) {
    const s = steps[name];
    if (!s) continue;
    if (s.status === "running") return { name, status: s.status, detail: s.detail };
    last = { name, status: s.status, detail: s.detail };
  }
  return last;
}

/** 0 to 1: how many of the steps have finished (skipped counts as finished). */
export function progressOf(steps: QueueSteps): number {
  const done = STEP_ORDER.filter((n) => steps[n] && steps[n]!.status !== "running").length;
  return done / STEP_ORDER.length;
}
