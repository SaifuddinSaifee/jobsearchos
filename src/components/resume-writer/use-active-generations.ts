"use client";

import { useQuery } from "@tanstack/react-query";
import { isGenerationWorking, type ActiveGeneration } from "@/lib/resume-writer/types";
import { ACTIVE_GENERATIONS_KEY } from "./use-resume-actions";

async function fetchActive(): Promise<ActiveGeneration[]> {
  const res = await fetch("/api/resume-generations");
  if (!res.ok) throw new Error("Could not load the resumes being written");
  return (await res.json()).items;
}

/**
 * The resumes being written (or waiting for review), and those that just finished. Polls quickly while one is working
 * and slowly otherwise. The sidebar card and the toasts read this one query.
 */
export function useActiveGenerations() {
  const q = useQuery({
    queryKey: ACTIVE_GENERATIONS_KEY,
    queryFn: fetchActive,
    refetchInterval: (query) => (query.state.data?.some(isGenerationWorking) ? 1500 : 10_000),
  });
  return { generations: q.data ?? [], isSuccess: q.isSuccess };
}
