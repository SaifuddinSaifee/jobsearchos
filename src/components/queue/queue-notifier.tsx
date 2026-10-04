"use client";

import { useRouter, usePathname } from "next/navigation";
import { useCallback } from "react";
import { toast } from "sonner";
import { useQueue, useQueueTransitions } from "./use-queue";

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
  return null;
}
