"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { saveJob } from "@/lib/jobs/service";
import { clearFinished, enqueueText, enqueueUrls, markDuplicate, markSaved, removeItem, retryItem, type EnqueueResult } from "@/lib/queue/service";
import { kickWorker } from "@/lib/queue/worker";

const Id = z.uuid();

export type SaveJobResult =
  | { ok: true; jobId: string }
  | { ok: false; error: string; duplicate?: { id: string; company: string; title: string } };

/** Saves a reviewed draft. When it came from the queue, the queue item is updated to match. */
export async function saveJobAction(draft: unknown, queueId?: string): Promise<SaveJobResult> {
  try {
    const result = await saveJob(draft);
    const label = (d: { company?: unknown; title?: unknown }) => `${String(d.company ?? "")} - ${String(d.title ?? "")}`;
    if (!result.ok) {
      if (queueId) await markDuplicate(Id.parse(queueId), result.duplicate.id, `${result.duplicate.company} - ${result.duplicate.title}`);
      return { ok: false, error: "This job is already saved", duplicate: result.duplicate };
    }
    if (queueId) await markSaved(Id.parse(queueId), result.jobId, label(draft as Record<string, unknown>));
    revalidatePath("/jobs");
    revalidatePath("/");
    return { ok: true, jobId: result.jobId };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Save failed" };
  }
}

export type QueueActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

async function run<T extends object>(fn: () => Promise<T>): Promise<QueueActionResult<T>> {
  try {
    return { ok: true, ...(await fn()) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Something went wrong" };
  }
}

/** One URL per line (or separated by spaces). Everything valid is queued and processed in the background. */
export async function enqueueUrlsAction(raw: string) {
  return run<EnqueueResult>(async () => {
    // One URL per line; several URLs on one line are split only when every part is a link, so a typo like
    // "not a url" is reported once instead of as three bad URLs.
    const urls = z
      .string()
      .max(100_000)
      .parse(raw)
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .flatMap((line) => {
        const parts = line.split(/\s+/);
        return parts.length > 1 && parts.every((p) => /^https?:\/\//i.test(p)) ? parts : [line];
      });
    if (urls.length === 0) throw new Error("Paste at least one job URL");
    const result = await enqueueUrls(urls);
    if (result.queued.length) kickWorker();
    return result;
  });
}

export async function enqueueTextAction(text: string, url?: string) {
  return run<EnqueueResult>(async () => {
    const result = await enqueueText(z.string().parse(text), url);
    kickWorker();
    return result;
  });
}

export async function retryQueueItemAction(id: string) {
  return run(async () => {
    if (!(await retryItem(Id.parse(id)))) throw new Error("Only failed items can be retried");
    kickWorker();
    return {};
  });
}

export async function removeQueueItemAction(id: string) {
  return run(async () => {
    if (!(await removeItem(Id.parse(id)))) throw new Error("A running item cannot be removed yet");
    return {};
  });
}

export async function clearFinishedQueueAction() {
  return run(async () => ({ cleared: await clearFinished() }));
}
