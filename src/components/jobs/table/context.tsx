"use client";

import { createContext, useContext } from "react";
import type { ApplicationStatus } from "@/lib/jobs/status";

export type JobsActions = {
  /** null until after mount, so relative times never cause a hydration mismatch. */
  now: Date | null;
  openJob: (jobId: string) => void;
  editJob: (jobId: string) => void;
  changeStatus: (applicationIds: string[], to: ApplicationStatus) => void;
  /** Soft delete with an Undo toast. */
  deleteJobs: (jobIds: string[]) => void;
};

const Ctx = createContext<JobsActions | null>(null);

export const JobsActionsProvider = Ctx.Provider;

export function useJobsActions(): JobsActions {
  const v = useContext(Ctx);
  if (!v) throw new Error("useJobsActions must be used inside <JobsTable>");
  return v;
}
