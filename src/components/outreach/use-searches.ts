"use client";

import { useQuery } from "@tanstack/react-query";
import { isSearchActive, type SearchItem } from "@/lib/outreach/types";

async function fetchSearches(): Promise<SearchItem[]> {
  const res = await fetch("/api/contact-searches");
  if (!res.ok) throw new Error("Could not load searches");
  return (await res.json()).items;
}

export const SEARCHES_KEY = ["contact-searches"] as const;

/**
 * Background "find people" runs. Polls quickly while one is working and slowly otherwise. The outreach page, the
 * sidebar tracker and the toasts all read this one query.
 */
export function useSearches() {
  const q = useQuery({
    queryKey: SEARCHES_KEY,
    queryFn: fetchSearches,
    refetchInterval: (query) => (query.state.data?.some(isSearchActive) ? 1500 : 12_000),
  });
  return { searches: q.data ?? [], isSuccess: q.isSuccess };
}
