"use client";

import { useRouter, usePathname } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { useCareerStatus } from "@/components/career/use-career-status";
import { useSearches } from "@/components/outreach/use-searches";
import { parseFailure } from "@/lib/career/failure";
import type { CareerStatus } from "@/lib/career/review";
import type { SearchItem } from "@/lib/outreach/types";
import { useQueue, useQueueTransitions, useStatusTransitions } from "./use-queue";

/**
 * Tells you when background work finishes, wherever you are in the app. Quiet on the New Application page
 * itself, where the queue is already on screen. Several results in one poll are summarized as one toast.
 */
export function QueueNotifier() {
  const router = useRouter();
  const pathname = usePathname();
  const { snapshot, isSuccess } = useQueue();

  const onChange = useCallback(
    (changes: Parameters<Parameters<typeof useQueueTransitions>[2]>[0]) => {
      if (pathname === "/new") return;
      const done = changes.filter((c) => c.from === "running" || c.from === "queued");
      const saved = done.filter((c) => c.item.status === "saved");
      const review = done.filter((c) => c.item.status === "needs_review");
      const failed = done.filter((c) => c.item.status === "failed");

      if (saved.length === 1) {
        const item = saved[0].item;
        toast.success(`Saved: ${item.label}`, { action: { label: "View", onClick: () => router.push(`/jobs?job=${item.jobId}`) } });
      } else if (saved.length > 1) {
        toast.success(`${saved.length} jobs saved`, { action: { label: "Open Jobs", onClick: () => router.push("/jobs") } });
      }
      if (review.length) {
        toast.message(review.length === 1 ? `Ready to review: ${review[0].item.label}` : `${review.length} jobs need a quick look`, {
          action: { label: "Review", onClick: () => router.push(review.length === 1 ? `/new?review=${review[0].item.id}` : "/new") },
        });
      }
      if (failed.length) {
        toast.error(failed.length === 1 ? `Could not process ${failed[0].item.label}` : `${failed.length} jobs failed`, {
          description: failed.length === 1 ? (failed[0].item.error ?? undefined) : undefined,
          action: { label: "Open queue", onClick: () => router.push("/new") },
        });
      }
    },
    [pathname, router],
  );

  useQueueTransitions(snapshot.items, isSuccess, onChange);

  // Contact searches: say when one finishes, unless you are already looking at that job's outreach page.
  const { searches, isSuccess: searchesLoaded } = useSearches();
  const onSearchChange = useCallback(
    (changes: { item: SearchItem; from: string }[]) => {
      for (const { item, from } of changes) {
        if (from !== "queued" && from !== "running") continue;
        if (pathname === `/jobs/${item.jobId}/outreach`) continue;
        const open = { label: "Open", onClick: () => router.push(`/jobs/${item.jobId}/outreach`) };
        if (item.status === "done") {
          const n = item.found ?? 0;
          toast.success(n > 0 ? `Found ${n} ${n === 1 ? "person" : "people"} for ${item.label}` : `No one found for ${item.label}`, { action: open });
        } else if (item.status === "failed") {
          toast.error(`Could not search for people at ${item.label}`, { description: item.error ?? undefined, action: open });
        }
      }
    },
    [pathname, router],
  );
  useStatusTransitions(searches, searchesLoaded, onSearchChange);

  // Career record: say when a source is ready for review (it is the one holding the rest back) or could not be read.
  // Not on the review page itself, which swaps the next source in on its own.
  const { data: career } = useCareerStatus();
  const onCareerChange = useCallback(
    ({ ready, failed }: { ready: CareerStatus["current"]; failed: CareerStatus["failed"] }) => {
      if (ready && pathname !== "/library/record/review") {
        toast.success(`Ready to review: ${ready.label}`, {
          description: "Approve what to add to your career record. The next source starts after you save.",
          action: { label: "Review", onClick: () => router.push("/library/record/review") },
          duration: 15_000,
        });
      }
      if (failed.length) {
        toast.error(failed.length === 1 ? `Could not prepare ${failed[0].label}` : `${failed.length} sources could not be prepared`, {
          description: failed.length === 1 ? parseFailure(failed[0].error).message : undefined,
          action: { label: "Details", onClick: () => router.push("/library?tab=record") },
        });
      }
    },
    [pathname, router],
  );
  useCareerTransitions(career, onCareerChange);
  return null;
}

/** Calls `onChange` with a source that has just become ready and any that have just failed (not on the first load). */
function useCareerTransitions(
  status: CareerStatus | undefined,
  onChange: (changes: { ready: CareerStatus["current"]; failed: CareerStatus["failed"] }) => void,
) {
  const seen = useRef<{ ready: string | null; failed: Set<string> } | null>(null);
  useEffect(() => {
    if (!status) return;
    const ready = status.current?.status === "ready" ? status.current : null;
    const next = { ready: ready?.id ?? null, failed: new Set(status.failed.map((f) => f.id)) };
    const prev = seen.current;
    seen.current = next;
    if (!prev) return;
    const newlyReady = ready && ready.id !== prev.ready ? ready : null;
    const newlyFailed = status.failed.filter((f) => !prev.failed.has(f.id));
    if (newlyReady || newlyFailed.length) onChange({ ready: newlyReady, failed: newlyFailed });
  }, [status, onChange]);
}
