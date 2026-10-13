"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { blankContent, contentFromText } from "@/lib/documents/intake";
import { enqueueAfterCreate } from "@/lib/documents/queue";
import {
  createDocument,
  createVersion,
  DocumentError,
  duplicateDocument,
  getBaseDocument,
  restoreVersion,
  setBase,
  softDelete,
  updateMeta,
  updatePageSettings,
} from "@/lib/documents/service";
import { DOCUMENT_KINDS, KIND_LABELS } from "@/lib/documents/types";
import { enqueueDocumentIndex } from "@/lib/resume/indexing";
import { kickWorker } from "@/lib/queue/worker";

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

async function run<T extends object>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    const out = await fn();
    revalidatePath("/library");
    return { ok: true, ...out };
  } catch (err) {
    if (err instanceof DocumentError || err instanceof z.ZodError) {
      return { ok: false, error: err instanceof z.ZodError ? (err.issues[0]?.message ?? "Invalid input") : err.message };
    }
    console.error("[library] action failed:", err);
    return { ok: false, error: "Something went wrong. Try again." };
  }
}

const Id = z.uuid();
const optional = z.string().trim().max(2000).optional();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-03-04").optional();

const Details = z.object({
  title: z.string().trim().max(200).optional(),
  jobId: z.uuid().nullable().optional(),
  companyName: optional,
  targetRole: optional,
  writtenOn: day.or(z.literal("")),
  jdText: z.string().max(100_000).optional(),
  jdUrl: optional,
});

/** Empty strings from a form mean "nothing". */
const blank = <T extends Record<string, unknown>>(o: T) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v === "" ? null : v])) as { [K in keyof T]: T[K] | null };

const FromText = Details.extend({ kind: z.enum(DOCUMENT_KINDS), text: z.string().trim().min(1, "Paste some text first").max(100_000, "That is too long") });

/** Creates a document from pasted text. A pasted email can start with a "Subject:" line. */
export async function createFromTextAction(input: z.input<typeof FromText>) {
  return run(async () => {
    const v = FromText.parse(input);
    const { content, subject } = contentFromText(v.kind, v.text);
    const { document } = await createDocument({
      kind: v.kind,
      origin: "pasted",
      title: v.title || `Pasted ${KIND_LABELS[v.kind].toLowerCase()}`,
      content,
      subject,
      ...blank({ jobId: v.jobId, companyName: v.companyName, targetRole: v.targetRole, writtenOn: v.writtenOn, jdText: v.jdText, jdUrl: v.jdUrl }),
    });
    await enqueueAfterCreate(document.id);
    return { id: document.id };
  });
}

const Blank = Details.extend({ kind: z.enum(DOCUMENT_KINDS), fromBase: z.boolean().optional() });

/** A new empty document, or (for a resume) a copy of the base resume to adapt. */
export async function createBlankAction(input: z.input<typeof Blank>) {
  return run(async () => {
    const v = Blank.parse(input);
    const details = blank({ jobId: v.jobId, companyName: v.companyName, targetRole: v.targetRole, writtenOn: v.writtenOn, jdText: v.jdText, jdUrl: v.jdUrl });
    if (v.fromBase) {
      const base = await getBaseDocument();
      if (!base || v.kind !== "resume") throw new DocumentError("not_found", "There is no base resume to copy yet.");
      const copy = await duplicateDocument(base.id, { title: v.title || `${base.title} (copy)` });
      const { id } = copy.document;
      if (Object.values(details).some((x) => x !== null)) await updateMeta(id, { ...details, jobId: details.jobId ?? undefined });
      await enqueueAfterCreate(id);
      return { id };
    }
    const { document } = await createDocument({ kind: v.kind, origin: "blank", title: v.title || `New ${KIND_LABELS[v.kind].toLowerCase()}`, content: blankContent(v.kind), ...details });
    return { id: document.id };
  });
}

export async function duplicateAction(id: string) {
  return run(async () => {
    const copy = await duplicateDocument(Id.parse(id));
    await enqueueAfterCreate(copy.document.id);
    return { id: copy.document.id };
  });
}

export async function setBaseAction(id: string) {
  return run(async () => {
    await setBase(Id.parse(id));
    return {};
  });
}

export async function deleteAction(id: string) {
  return run(async () => {
    await softDelete(Id.parse(id));
    return {};
  });
}

export async function updateMetaAction(id: string, input: z.input<typeof Details>) {
  return run(async () => {
    const v = Details.parse(input);
    const patch = blank({ companyName: v.companyName, targetRole: v.targetRole, writtenOn: v.writtenOn, jdText: v.jdText, jdUrl: v.jdUrl });
    await updateMeta(Id.parse(id), {
      ...(v.title !== undefined ? { title: v.title } : {}),
      ...(v.jobId !== undefined ? { jobId: v.jobId } : {}),
      ...patch,
    });
    revalidatePath(`/library/${id}`);
    return {};
  });
}

export async function restoreVersionAction(id: string, versionId: string) {
  return run(async () => {
    const version = await restoreVersion(Id.parse(id), Id.parse(versionId));
    await enqueueAfterCreate(id);
    revalidatePath(`/library/${id}`);
    return { version: version.version };
  });
}

/** Starts, or retries, the search index of a library resume. */
export async function retryIndexAction(documentId: string) {
  return run(async () => {
    await enqueueDocumentIndex(Id.parse(documentId));
    kickWorker();
    return {};
  });
}

/**
 * Saves the document as it is now as a named checkpoint. Does nothing (and says so) if nothing changed since the last
 * version. The editor has already saved its draft before calling this.
 */
export async function saveVersionAction(id: string, note?: string) {
  return run(async () => {
    const made = await createVersion(Id.parse(id), { reason: "manual", note: note?.trim().slice(0, 200) || null });
    if (made.created) await enqueueAfterCreate(id);
    revalidatePath(`/library/${id}`);
    return { version: made.version.version, created: made.created };
  });
}

/** Page settings (font, spacing, accent, one page). They are part of each version, so a PDF always matches. */
export async function updatePageSettingsAction(id: string, settings: unknown) {
  return run(async () => {
    const saved = await updatePageSettings(Id.parse(id), settings);
    return { settings: saved };
  });
}
