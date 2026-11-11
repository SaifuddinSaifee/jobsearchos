import type { ApplicationStatus } from "@/lib/jobs/status";
import type { QueueStatus } from "@/lib/queue/types";

// Client-safe: no database imports.

/** Where a discovered job is now. */
export type DiscoverState =
  /** Saved in Jobs. */
  | "in_jobs"
  /** Waiting in the queue or being read. */
  | "reading"
  /** Read, but waiting for you to check the fields on New Application. */
  | "review"
  /** Reading failed; it can be retried. */
  | "failed"
  /** Never queued (a site that blocks fetching, a full queue). */
  | "not_added"
  /** Its queue item was cleared and no job exists (for example, the job was deleted). */
  | "gone";

export type DiscoveredJob = {
  id: string;
  url: string;
  source: string;
  title: string;
  company: string;
  location: string;
  mode: string;
  pay: string;
  posted: string;
  track: string;
  fit: number | null;
  why: string;
  leadWith: string;
  applyHow: string;
  createdAt: string;
  state: DiscoverState;
  /** Why it is waiting, failed or was not added. */
  reason: string | null;
  queueId: string | null;
  jobId: string | null;
  jobStatus: ApplicationStatus | null;
};

export function discoverState(r: { jobId: string | null; queueStatus: QueueStatus | null; notAddedReason: string | null }): DiscoverState {
  if (r.jobId) return "in_jobs";
  if (r.queueStatus === "queued" || r.queueStatus === "running") return "reading";
  if (r.queueStatus === "needs_review") return "review";
  if (r.queueStatus === "failed") return "failed";
  if (r.notAddedReason) return "not_added";
  return "gone";
}
