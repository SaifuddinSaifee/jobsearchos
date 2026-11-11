"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { revertStatusAction } from "@/app/(app)/jobs/actions";
import { saveReviewAction, startGenerationAction, stopGenerationAction } from "@/app/(app)/jobs/[id]/resume/actions";
import type { PreviousState } from "@/lib/jobs/types";
import type { GenerationChoices, ReviewAnswer } from "@/lib/resume-writer/types";
import { JOB_RESUME_KEY } from "./use-job-resume";

/** Prefix of the sidebar's list of resumes being written. */
export const ACTIVE_GENERATIONS_KEY = ["resume-generations"] as const;

/** Every action a person can take on writing a resume for a job, with the toasts and refreshing they need. */
export function useResumeActions(jobId: string) {
  const router = useRouter();
  const client = useQueryClient();
  const [busy, setBusy] = useState<"start" | "review" | "stop" | null>(null);

  const refresh = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: JOB_RESUME_KEY }),
      client.invalidateQueries({ queryKey: ACTIVE_GENERATIONS_KEY }),
      client.invalidateQueries({ queryKey: ["job"] }),
    ]);
    router.refresh();
  };

  /** Tells the user the job moved to Preparing, with a way back. */
  function movedToPreparing(previous: PreviousState[]) {
    if (previous.length === 0) return;
    toast.message("Moved to Preparing", {
      action: {
        label: "Undo",
        onClick: async () => {
          const res = await revertStatusAction(previous);
          if (!res.ok) return void toast.error(res.error);
          toast.success("Status put back");
          await refresh();
        },
      },
    });
  }

  /** Asks for a resume (or for it to be written again). `open` goes on to the resume page. */
  async function start(opts: { regenerate?: boolean; open?: boolean } = {}): Promise<boolean> {
    setBusy("start");
    try {
      const res = await startGenerationAction(jobId, opts.regenerate ?? false);
      if (!res.ok) {
        toast.error(res.error);
        return false;
      }
      movedToPreparing(res.previous);
      await refresh();
      if (opts.open) router.push(`/jobs/${jobId}/resume`);
      return true;
    } finally {
      setBusy(null);
    }
  }

  /** Sends the review answers and goes on to writing. */
  async function submitReview(generationId: string, answers: ReviewAnswer[], skipReviewNextTime: boolean, choices?: GenerationChoices): Promise<boolean> {
    setBusy("review");
    try {
      const res = await saveReviewAction(generationId, answers, skipReviewNextTime, choices);
      if (!res.ok) {
        toast.error(res.error);
        await refresh();
        return false;
      }
      movedToPreparing(res.previous);
      await refresh();
      return true;
    } finally {
      setBusy(null);
    }
  }

  async function stop(generationId: string): Promise<void> {
    setBusy("stop");
    try {
      const res = await stopGenerationAction(generationId);
      if (!res.ok) toast.error(res.error);
      else toast.success("Stopped");
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  return { busy, start, submitReview, stop, refresh };
}
