"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { kickWorker, stopGenerationJob } from "@/lib/queue/worker";
import { GenerationError, saveReview, startGeneration, stopGeneration } from "@/lib/resume-writer/service";

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

async function run<T extends object>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    const out = await fn();
    revalidatePath("/jobs");
    revalidatePath("/library");
    return { ok: true, ...out };
  } catch (err) {
    if (err instanceof GenerationError) return { ok: false, error: err.message };
    if (err instanceof z.ZodError) return { ok: false, error: err.issues[0]?.message ?? "Invalid request" };
    console.error("[resume-writer] action failed:", err);
    return { ok: false, error: "Something went wrong. Try again." };
  }
}

const Id = z.uuid();
const Answers = z
  .array(z.object({ id: z.string().regex(/^r\d{1,3}$/), userHas: z.boolean(), note: z.string().max(500) }))
  .max(100);
const RecordIds = z.record(z.string().max(64), z.string().max(64));
const Choices = z.object({ framings: RecordIds, wordings: RecordIds }).optional();

/**
 * Asks for a resume for a job (or for it to be written again, into the same resume). Returns what Undo needs when the
 * job was moved to Preparing.
 */
export async function startGenerationAction(jobId: string, regenerate = false) {
  return run(async () => {
    const { generation, previous } = await startGeneration(Id.parse(jobId), { regenerate: z.boolean().parse(regenerate) });
    kickWorker();
    return { generationId: generation.id, previous };
  });
}

/**
 * The user's answers on the review screen, with the telling of each role and the numbers they picked. Moves on to
 * writing, and the job to Preparing (returning what Undo needs).
 */
export async function saveReviewAction(generationId: string, answers: unknown, skipReviewNextTime = false, choices?: unknown) {
  return run(async () => {
    const { previous } = await saveReview(Id.parse(generationId), {
      answers: Answers.parse(answers),
      choices: Choices.parse(choices),
      skipReviewNextTime: z.boolean().parse(skipReviewNextTime),
    });
    kickWorker();
    return { previous };
  });
}

/** Stops a resume that is being matched, reviewed or written, cancelling its model calls. */
export async function stopGenerationAction(generationId: string) {
  return run(async () => {
    const id = Id.parse(generationId);
    const stopped = await stopGeneration(id);
    if (!stopped) throw new GenerationError("This resume is not being written.", "state");
    stopGenerationJob(id);
    kickWorker();
    return {};
  });
}
