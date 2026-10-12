"use client";

import { useRouter, usePathname } from "next/navigation";
import { useCallback } from "react";
import { toast } from "sonner";
import { useSearches } from "@/components/outreach/use-searches";
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
  return null;
}
