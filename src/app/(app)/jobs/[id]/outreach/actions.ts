"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { enqueueSearch } from "@/lib/outreach/searches";
import { kickWorker } from "@/lib/queue/worker";
import type { SendWarning } from "@/lib/outreach/checks";
import {
  addContact,
  markVerified,
  revealContactEmail,
  OutreachError,
  prepareAttachments,
  removeContact,
  reuseAsDraft,
  saveDraft,
  sendDraft,
  setDoNotContact,
  setJobCompanyWebsite,
  snapshot,
  updateContact,
  type ContactInput,
} from "@/lib/outreach/service";
import type { EmailDoc } from "@/lib/outreach/body";
import { MAX_ATTACHMENTS, type AttachmentRef, type DraftDTO, type SentDTO } from "@/lib/outreach/types";

const Id = z.uuid();

type Snapshot = Awaited<ReturnType<typeof snapshot>>;
export type ActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string; needs?: SendWarning[] };

async function run<T extends object>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, ...(await fn()) };
  } catch (err) {
    if (err instanceof OutreachError) return { ok: false, error: err.message, needs: err.needs };
    if (err instanceof z.ZodError) return { ok: false, error: err.issues[0]?.message ?? "Invalid request" };
    console.error(err);
    return { ok: false, error: err instanceof Error ? err.message : "Something went wrong" };
  }
}

/** Runs a contact change, then returns the fresh lists so the page never shows stale data. */
function withSnapshot<T extends object = object>(jobId: string, fn: () => Promise<T | void>) {
  return run(async () => {
    const extra = (await fn()) ?? ({} as T);
    return { ...(extra as T), ...(await snapshot(Id.parse(jobId))) };
  });
}

/** Queues "find people" for the background worker and returns at once; the page follows its progress. */
export async function startSearchAction(jobId: string) {
  return run(async () => {
    const { item, alreadyActive } = await enqueueSearch(Id.parse(jobId));
    kickWorker();
    return { search: item, alreadyActive };
  });
}

/** The current contacts and sent mail, for when a background search finishes while the page is open. */
export async function refreshAction(jobId: string) {
  return run(async () => snapshot(Id.parse(jobId)));
}

export async function addContactAction(jobId: string, input: ContactInput) {
  return withSnapshot(jobId, async () => ({ added: await addContact(Id.parse(jobId), input) }));
}

export async function updateContactAction(jobId: string, contactId: string, input: ContactInput) {
  return withSnapshot(jobId, () => updateContact(Id.parse(contactId), input).then(() => undefined));
}

export async function removeContactAction(jobId: string, contactId: string) {
  return withSnapshot(jobId, () => removeContact(Id.parse(contactId)));
}

export async function doNotContactAction(jobId: string, contactId: string, value: boolean) {
  return withSnapshot(jobId, () => setDoNotContact(Id.parse(contactId), value));
}

export async function markVerifiedAction(jobId: string, contactId: string) {
  return withSnapshot(jobId, () => markVerified(Id.parse(contactId)));
}

export async function revealEmailAction(jobId: string, contactId: string) {
  return withSnapshot(jobId, async () => ({ found: await revealContactEmail(Id.parse(contactId)) }));
}

export async function setWebsiteAction(jobId: string, website: string) {
  return run(async () => ({ domain: await setJobCompanyWebsite(Id.parse(jobId), website) }));
}

const optionalId = (v: string | null | undefined) => (v === undefined || v === null ? v : Id.parse(v));

const Refs = z.array(z.union([z.strictObject({ documentId: Id }), z.strictObject({ fileId: Id })])).max(MAX_ATTACHMENTS, `An email can carry at most ${MAX_ATTACHMENTS} attachments.`);

export async function saveDraftAction(
  jobId: string,
  input: { subject: string; body: string; bodyDoc?: EmailDoc | null; contactId?: string | null; attachments?: AttachmentRef[] },
) {
  return run(async (): Promise<{ draft: DraftDTO }> => {
    const attachments = input.attachments === undefined ? undefined : Refs.parse(input.attachments);
    // The service reduces bodyDoc to what an email can hold, so it is passed on as it came.
    const draft = await saveDraft(Id.parse(jobId), { subject: input.subject, body: input.body, bodyDoc: input.bodyDoc, contactId: optionalId(input.contactId), attachments });
    return { draft };
  });
}

/**
 * Gets the attachments ready (each original file, or a PDF made from the document as it is now) so the confirmation can
 * show their real names, sizes and page counts. Sending prepares them again, so this is only for showing.
 */
export async function prepareSendAction(jobId: string) {
  return run(async () => {
    const prepared = await prepareAttachments(Id.parse(jobId));
    if (prepared.some((p) => p.versionCreated)) kickWorker();
    return { prepared };
  });
}

export async function sendAction(jobId: string, acknowledge: string[]) {
  return run(async (): Promise<{ sentEmail: SentDTO } & Snapshot> => {
    const sentEmail = await sendDraft(Id.parse(jobId), { acknowledge: z.array(z.string()).max(10).parse(acknowledge) });
    // The email is now in the library, and the versions it carried may be new.
    revalidatePath("/library");
    kickWorker();
    return { sentEmail, ...(await snapshot(jobId)) };
  });
}

export async function reuseAction(jobId: string, sentId: string) {
  return run(async () => ({ draft: await reuseAsDraft(Id.parse(jobId), Id.parse(sentId)) }));
}
