import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db as defaultDb, type Db } from "@/lib/db";
import { documentDrafts, documents, documentVersions, files, outreachEmails, type DocumentRow, type FileRow } from "@/lib/db/schema";
import { MAX_ATTACHMENT_BYTES } from "@/lib/email/gmail";
import { exportDocument, exportFilename } from "@/lib/documents/export";
import { countPdfPages, renderPdf } from "@/lib/documents/export/pdf";
import { createVersion, latestVersion, lockVersion } from "@/lib/documents/service";
import { fileDisplayName } from "@/lib/resume/files";
import { enqueueDocumentIndex } from "@/lib/resume/indexing";
import { getFileBytes, putFile } from "@/lib/storage/local";
import { OutreachError } from "./errors";
import type { DraftAttachmentDTO, ResumeOption } from "./types";

// What goes out with an email. The user picks a library resume. If it is an upload nobody has edited since, its
// original file goes (their own formatting, untouched). Anything else is turned into a PDF when the email is sent.

export const PDF_MIME = "application/pdf";

type OutreachRow = typeof outreachEmails.$inferSelect;

/** True when the resume's content has changed since it was uploaded or imported (an edit, a restore, an export...). */
const editedSql = sql<boolean>`(
  exists (select 1 from ${documentVersions} v where v.document_id = ${documents.id} and v.reason not in ('upload', 'structured', 'migrated'))
  or exists (
    select 1 from ${documentDrafts} d
     where d.document_id = ${documents.id}
       and d.content_sha256 <> (select v.content_sha256 from ${documentVersions} v where v.document_id = d.document_id order by v.version desc limit 1)
  )
)`;

/** True when the editor holds changes that are not in the latest version yet. */
const unsavedSql = sql<boolean>`exists (
  select 1 from ${documentDrafts} d
   where d.document_id = ${documents.id}
     and d.content_sha256 <> (select v.content_sha256 from ${documentVersions} v where v.document_id = d.document_id order by v.version desc limit 1)
)`;

/** The name at the top of the resume, which a PDF's file name starts with. */
const headerNameSql = sql<string | null>`(select d.content #>> '{content,0,content,0,content,0,text}' from ${documentDrafts} d where d.document_id = ${documents.id} and d.content #>> '{content,0,type}' = 'header')`;

const latestVersionIdSql = sql<string | null>`(select v.id from ${documentVersions} v where v.document_id = ${documents.id} order by v.version desc limit 1)`;

type Resolved = { doc: DocumentRow; source: "file" | "pdf"; file: FileRow | null; edited: boolean; unsaved: boolean; latestVersionId: string | null; headerName: string | null };

/** What attaching this resume would send right now. Throws a message for the user if it cannot be attached. */
export async function resolveAttachment(documentId: string, db: Db): Promise<Resolved> {
  const [row] = await db
    .select({ doc: documents, file: files, edited: editedSql, unsaved: unsavedSql, latestVersionId: latestVersionIdSql, headerName: headerNameSql })
    .from(documents)
    .leftJoin(files, eq(files.id, documents.sourceFileId))
    .where(and(eq(documents.id, documentId), isNull(documents.deletedAt)));
  if (!row) throw new OutreachError("That resume is no longer in your library. Choose another.", "invalid");
  if (row.doc.kind !== "resume") throw new OutreachError("Only a resume can be attached.", "invalid");
  const useFile = row.file !== null && !row.edited;
  return { doc: row.doc, source: useFile ? "file" : "pdf", file: useFile ? row.file : null, edited: row.edited, unsaved: row.unsaved, latestVersionId: row.latestVersionId, headerName: row.headerName };
}

/** The base resume's id, which a new draft starts with. */
export async function baseDocumentId(db: Db): Promise<string | null> {
  const [row] = await db.select({ id: documents.id }).from(documents).where(and(eq(documents.isBase, true), isNull(documents.deletedAt)));
  return row?.id ?? null;
}

const kindFor = (doc: Pick<DocumentRow, "isBase" | "jobId">, jobId: string): ResumeOption["kind"] => (doc.isBase ? "base" : doc.jobId === jobId ? "job" : "past");

/** The PDF's file name as the export will make it (what the person sees in the picker before it exists). */
const guessName = (doc: Pick<DocumentRow, "title" | "companyName" | "targetRole">, headerName: string | null) =>
  exportFilename({ name: headerName, title: doc.title, company: doc.companyName, role: doc.targetRole }, "pdf");

function optionOf(doc: DocumentRow, file: FileRow | null, jobId: string, headerName: string | null, label?: string): ResumeOption {
  return {
    documentId: doc.id,
    kind: kindFor(doc, jobId),
    label: label ?? doc.title,
    source: file ? "file" : "pdf",
    name: file ? fileDisplayName(file) : guessName(doc, headerName),
    size: file?.size ?? null,
    mime: file?.mime ?? PDF_MIME,
    fileId: file?.id ?? null,
  };
}

/** One resume as an option (used right after an upload). */
export async function optionForDocument(documentId: string, jobId: string, db: Db, label?: string): Promise<ResumeOption> {
  const r = await resolveAttachment(documentId, db);
  return optionOf(r.doc, r.file, jobId, r.headerName, label);
}

/**
 * The resumes that can be attached to an email for this job, in the order they are offered: the base resume (the
 * default), resumes written for this job, then the rest of the library, most recently changed first.
 */
export async function resumeOptions(jobId: string, db: Db): Promise<ResumeOption[]> {
  const rows = await db
    .select({ doc: documents, file: files, edited: editedSql, headerName: headerNameSql })
    .from(documents)
    .leftJoin(files, eq(files.id, documents.sourceFileId))
    .where(and(eq(documents.kind, "resume"), isNull(documents.deletedAt)))
    .orderBy(desc(documents.isBase), desc(documents.updatedAt))
    .limit(60);
  const option = (r: (typeof rows)[number]) => optionOf(r.doc, r.file && !r.edited ? r.file : null, jobId, r.headerName, r.doc.isBase ? "Base resume" : r.doc.companyName ? `${r.doc.title} (${r.doc.companyName})` : r.doc.title);
  return [...rows.filter((r) => r.doc.isBase), ...rows.filter((r) => !r.doc.isBase && r.doc.jobId === jobId), ...rows.filter((r) => !r.doc.isBase && r.doc.jobId !== jobId)].map(option);
}

/** Throws unless the original file is small enough to send. */
export function checkSize(size: number, what: string) {
  if (size > MAX_ATTACHMENT_BYTES) throw new OutreachError(`${what} is larger than 5 MB. Choose a smaller resume.`, "invalid");
}

/**
 * The attachment shown on a draft: what is chosen and, if it has been prepared and nothing changed since, the file
 * that will go. Returns null when nothing is chosen or the resume has since been deleted.
 */
export async function draftAttachment(d: OutreachRow, db: Db): Promise<DraftAttachmentDTO | null> {
  if (!d.attachmentDocumentId) return null;
  const r = await resolveAttachment(d.attachmentDocumentId, db).catch(() => null);
  if (!r) return null;
  let file = r.file;
  if (!file && d.attachmentFileId && d.attachmentVersionId && d.attachmentVersionId === r.latestVersionId && !r.unsaved) {
    [file] = await db.select().from(files).where(eq(files.id, d.attachmentFileId));
  }
  const option = optionOf(r.doc, file ?? null, d.jobId, r.headerName);
  return { ...option, source: r.source, name: file && d.attachmentName && file.id !== r.doc.sourceFileId ? d.attachmentName : option.name };
}

export type PrepareDeps = { pdf?: typeof renderPdf; storageDir?: string };

export type PreparedAttachment = { fileId: string; name: string; size: number; mime: string; source: "file" | "pdf"; documentId: string; versionId: string | null; pages: number | null; versionCreated: boolean };

/**
 * Gets the draft's attachment ready to send: the original file for an unedited upload, or a PDF made from the
 * resume's current text. A PDF is stored (it leaves the app, so the exact bytes are kept) and the version it was
 * made from is recorded on the draft. If nothing changed since the last time, the same file is reused. Returns null
 * when the draft has no attachment.
 */
export async function prepareAttachment(jobId: string, deps: PrepareDeps = {}, db: Db = defaultDb()): Promise<PreparedAttachment | null> {
  const [draft] = await db.select().from(outreachEmails).where(and(eq(outreachEmails.jobId, jobId), eq(outreachEmails.status, "draft")));
  if (!draft?.attachmentDocumentId) return null;
  const r = await resolveAttachment(draft.attachmentDocumentId, db);
  const setDraft = (patch: Partial<typeof outreachEmails.$inferInsert>) => db.update(outreachEmails).set({ ...patch, updatedAt: new Date() }).where(eq(outreachEmails.id, draft.id));

  if (r.source === "file" && r.file) {
    checkSize(r.file.size, "The attached file");
    const latest = await latestVersion(r.doc.id, db);
    await setDraft({ attachmentFileId: r.file.id, attachmentVersionId: latest?.id ?? null, attachmentName: null });
    return { fileId: r.file.id, name: fileDisplayName(r.file), size: r.file.size, mime: r.file.mime, source: "file", documentId: r.doc.id, versionId: latest?.id ?? null, pages: null, versionCreated: false };
  }

  const made = await createVersion(r.doc.id, { reason: "attach" }, db);
  if (made.created) await enqueueDocumentIndex(r.doc.id, {}, db).catch(() => null);

  const reusable = draft.attachmentFileId && draft.attachmentVersionId === made.version.id && draft.attachmentFileId !== r.doc.sourceFileId;
  if (reusable) {
    const [file] = await db.select().from(files).where(eq(files.id, draft.attachmentFileId!));
    if (file) {
      const pages = await countPdfPages(await getFileBytes(file.sha256, { db, dir: deps.storageDir })).catch(() => null);
      return { fileId: file.id, name: draft.attachmentName?.trim() || fileDisplayName(file), size: file.size, mime: file.mime, source: "pdf", documentId: r.doc.id, versionId: made.version.id, pages, versionCreated: false };
    }
  }

  let out: Awaited<ReturnType<typeof exportDocument>>;
  try {
    out = await exportDocument(r.doc.id, { format: "pdf", versionId: made.version.id }, { db, pdf: deps.pdf });
  } catch (err) {
    throw new OutreachError(`Could not make the PDF from "${r.doc.title}": ${err instanceof Error ? err.message : "unknown error"}`, "send_failed");
  }
  checkSize(out.bytes.length, `The PDF made from "${r.doc.title}"`);
  const stored = await putFile(out.bytes, { mime: PDF_MIME, originalName: out.filename }, { db, dir: deps.storageDir });
  await setDraft({ attachmentFileId: stored.id, attachmentVersionId: made.version.id, attachmentName: out.filename });
  return { fileId: stored.id, name: out.filename, size: stored.size, mime: PDF_MIME, source: "pdf", documentId: r.doc.id, versionId: made.version.id, pages: out.pages ?? null, versionCreated: made.created };
}

/** After an email went out: the version it was made from can never change. */
export async function lockSentVersion(versionId: string | null, jobId: string, at: Date, db: Db): Promise<void> {
  if (versionId) await lockVersion(versionId, { jobId, at }, db);
}
