"use client";

import { useQuery } from "@tanstack/react-query";
import { isGenerationWorking, type JobResumeState } from "@/lib/resume-writer/types";

/** Prefix of every job's resume query, to refresh them all after an action. */
export const JOB_RESUME_KEY = ["job-resume"] as const;

async function fetchState(jobId: string): Promise<JobResumeState> {
  const res = await fetch(`/api/jobs/${jobId}/resume`);
  if (!res.ok) throw new Error("Could not load where this job's resume stands");
  return res.json();
}

/**
 * Where writing a resume for a job stands. Polls quickly while it is being matched or written, and not at all while it
 * waits for the user's review or is finished. `initial` is what the server already knew when the page loaded.
 */
export function useJobResume(jobId: string | null, initial?: JobResumeState) {
  return useQuery({
    queryKey: [...JOB_RESUME_KEY, jobId],
    queryFn: () => fetchState(jobId!),
    enabled: Boolean(jobId),
    initialData: initial,
    refetchInterval: (query) => (isGenerationWorking(query.state.data?.generation) ? 1500 : false),
  });
}
