"use client";

import { useQuery } from "@tanstack/react-query";
import { isIndexActive, type IndexInfo } from "@/lib/resume/types";

export const RESUME_INDEXES_KEY = ["resume-indexes"] as const;

async function fetchIndexes(): Promise<IndexInfo[]> {
  const res = await fetch("/api/resume-indexes");
  if (!res.ok) throw new Error("Could not load resume indexes");
  return (await res.json()).indexes;
}

/** Where every resume is in the search-index pipeline. Polls quickly while one is working and not at all otherwise. */
export function useResumeIndexes() {
  const q = useQuery({
    queryKey: RESUME_INDEXES_KEY,
    queryFn: fetchIndexes,
    refetchInterval: (query) => (query.state.data?.some((i) => isIndexActive(i.status)) ? 2000 : false),
  });
  const byId = new Map((q.data ?? []).map((i) => [i.fileId, i]));
  return { byId, isSuccess: q.isSuccess };
}
