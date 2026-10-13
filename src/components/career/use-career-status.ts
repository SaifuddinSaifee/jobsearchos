"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import type { CareerStatus } from "@/lib/career/review";

export const CAREER_STATUS_KEY = ["career-status"] as const;

async function fetchStatus(): Promise<CareerStatus> {
  const res = await fetch("/api/career/status");
  if (!res.ok) throw new Error("Could not load the career record status");
  return res.json();
}

/**
 * Where each source is on its way into the career record. Polls quickly while one is being prepared. When the page
 * is refreshed on the server (after a restore, say) the fresh numbers it passes in replace what was cached.
 */
export function useCareerStatus(initial?: CareerStatus) {
  const client = useQueryClient();
  useEffect(() => {
    if (initial) client.setQueryData(CAREER_STATUS_KEY, initial);
  }, [initial, client]);
  return useQuery({
    queryKey: CAREER_STATUS_KEY,
    queryFn: fetchStatus,
    initialData: initial,
    // Quick while something is being prepared; slow otherwise, so a document saved in the editor (which is offered
    // to the record once its index is done) shows up here without a reload.
    refetchInterval: (query) => {
      const c = query.state.data?.counts;
      return c && c.queued + c.running > 0 ? 1500 : 10_000;
    },
  });
}
