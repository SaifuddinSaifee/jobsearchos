"use server";

import { revalidatePath } from "next/cache";
import { saveJob } from "@/lib/jobs/service";

export type SaveJobResult =
  | { ok: true; jobId: string }
  | { ok: false; error: string; duplicate?: { id: string; company: string; title: string } };

export async function saveJobAction(draft: unknown): Promise<SaveJobResult> {
  try {
    const result = await saveJob(draft);
    if (!result.ok) {
      return { ok: false, error: "This job is already saved", duplicate: result.duplicate };
    }
    revalidatePath("/jobs");
    return { ok: true, jobId: result.jobId };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Save failed" };
  }
}
