"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import type { QueueSnapshot } from "@/lib/queue/types";

async function fetchQueue(): Promise<QueueSnapshot> {
  const res = await fetch("/api/queue");
  if (!res.ok) throw new Error("Could not load the queue");
  return res.json();
}

const EMPTY: QueueSnapshot = {
  items: [],
  counts: { queued: 0, running: 0, saved: 0, needs_review: 0, duplicate: 0, failed: 0 },
};

/**
 * The shared queue state. Polls quickly while anything is working and slowly otherwise, so progress feels live
 * without constant traffic. The sidebar tracker, the toasts and the New Application page all read this one query.
 */
export function useQueue() {
  const q = useQuery({
    queryKey: ["queue"],
    queryFn: fetchQueue,
    refetchInterval: (query) => {
      const c = query.state.data?.counts;
      return c && c.queued + c.running > 0 ? 1500 : 12_000;
    },
  });
  return { ...q, snapshot: q.data ?? EMPTY };
}

/** Calls `onChange(previous, next)` for items whose status changed since the last poll (not for the first load). */
export function useQueueTransitions(
  items: QueueSnapshot["items"],
  loaded: boolean,
  onChange: (changes: { item: QueueSnapshot["items"][number]; from: string }[]) => void,
) {
  const seen = useRef<Map<string, string> | null>(null);
  useEffect(() => {
    if (!loaded) return;
    const next = new Map(items.map((i) => [i.id, i.status]));
    if (seen.current) {
      const changes = items
        .filter((i) => seen.current!.has(i.id) && seen.current!.get(i.id) !== i.status)
        .map((i) => ({ item: i, from: seen.current!.get(i.id)! }));
      if (changes.length) onChange(changes);
    }
    seen.current = next;
  }, [items, loaded, onChange]);
}
