"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { deleteJobs, fillAdditionalDetails, restoreDeleted, updateJob } from "@/lib/jobs/service";
import { STATUS_VALUES } from "@/lib/jobs/status";
import {
  changeStatus,
  changeStatusBulk,
  MAX_BULK,
  MAX_NOTES,
  revertStatus,
  saveNotes,
  setAppliedAt,
  type PreviousState,
} from "@/lib/jobs/tracker";

const Id = z.uuid();
const Status = z.enum(STATUS_VALUES);
const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export type MutationResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

async function run<T extends object>(fn: () => Promise<T>): Promise<MutationResult<T>> {
  try {
    const out = await fn();
    revalidatePath("/jobs");
    revalidatePath("/");
    revalidatePath("/companies", "layout");
    return { ok: true, ...out };
  } catch (err) {
    if (err instanceof z.ZodError) return { ok: false, error: "Invalid request" };
    return { ok: false, error: err instanceof Error ? err.message : "Something went wrong" };
  }
}

export async function changeStatusAction(applicationId: string, to: string, appliedDate?: string) {
  return run(async () => {
    const res = await changeStatus(Id.parse(applicationId), Status.parse(to), {
      appliedDate: appliedDate ? DateStr.parse(appliedDate) : undefined,
    });
    return { previous: res.previous };
  });
}

export async function bulkChangeStatusAction(applicationIds: string[], to: string, appliedDate?: string) {
  return run(async () => {
    const ids = z.array(Id).max(MAX_BULK).parse(applicationIds);
    const res = await changeStatusBulk(ids, Status.parse(to), {
      appliedDate: appliedDate ? DateStr.parse(appliedDate) : undefined,
    });
    return { previous: res.previous };
  });
}

const PreviousSchema = z.array(
  z.object({
    applicationId: Id,
    status: Status,
    appliedAt: z.string().nullable(),
    expected: Status,
  }),
);

export async function revertStatusAction(previous: PreviousState[]) {
  return run(async () => revertStatus(PreviousSchema.max(MAX_BULK).parse(previous)));
}

export async function setAppliedAtAction(applicationId: string, date: string) {
  return run(async () => {
    await setAppliedAt(Id.parse(applicationId), DateStr.parse(date));
    return {};
  });
}

export async function saveNotesAction(applicationId: string, notes: string) {
  return run(async () => {
    await saveNotes(Id.parse(applicationId), z.string().max(MAX_NOTES).parse(notes));
    return {};
  });
}

export async function updateJobAction(jobId: string, edit: unknown) {
  return run(async () => updateJob(Id.parse(jobId), edit));
}

export async function deleteJobsAction(jobIds: string[]) {
  return run(async () => ({ deleted: await deleteJobs(z.array(Id).min(1).max(MAX_BULK).parse(jobIds)) }));
}

const DeletedSchema = z.object({
  jobIds: z.array(Id).max(MAX_BULK),
  companies: z.array(z.object({ id: Id, name: z.string() })).max(MAX_BULK),
});

export async function restoreDeletedAction(deleted: unknown) {
  return run(async () => restoreDeleted(DeletedSchema.parse(deleted)));
}

/** Reads the saved posting text again (one LLM call) to fill the Additional details section. */
export async function fillAdditionalDetailsAction(jobId: string) {
  return run(async () => ({ details: await fillAdditionalDetails(Id.parse(jobId)) }));
}
