import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db as defaultDb, type Db } from "@/lib/db";
import { documentDrafts, documents, documentVersions, files, outreachAttachments, outreachEmails, type DocumentRow, type FileRow, type OutreachAttachmentRow } from "@/lib/db/schema";
import { exportDocument, exportFilename } from "@/lib/documents/export";
import { countPdfPages, renderPdf } from "@/lib/documents/export/pdf";
import { createVersion, latestVersion, lockVersion, type DbOrTx } from "@/lib/documents/service";
import { fileDisplayName } from "@/lib/resume/files";
import { enqueueDocumentIndex } from "@/lib/resume/indexing";
import { getFileBytes, putFile } from "@/lib/storage/local";
import { OutreachError } from "./errors";
import { ATTACHABLE_TYPES, attachmentKey, formatBytes, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS, type AttachmentOption, type AttachmentRef, type DraftAttachmentDTO } from "./types";

// What goes out with an email. The user picks any number of library resumes and cover letters, and can upload other
// files for the email alone (a proposal, a writing sample). A library upload nobody has edited since goes as its
// original file (their own formatting, untouched); anything else in the library is turned into a PDF when the email
// is sent. A plain uploaded file always goes exactly as it was uploaded.

export const PDF_MIME = "application/pdf";

const ATTACHABLE_KINDS = ["resume", "cover_letter"] as const;
type AttachableKind = (typeof ATTACHABLE_KINDS)[number];

/** True when the document's content has changed since it was uploaded or imported (an edit, a restore, an export...). */
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

/** The name at the top of the document, which a PDF's file name starts with. */
const headerNameSql = sql<string | null>`(select d.content #>> '{content,0,content,0,content,0,text}' from ${documentDrafts} d where d.document_id = ${documents.id} and d.content #>> '{content,0,type}' = 'header')`;

const latestVersionIdSql = sql<string | null>`(select v.id from ${documentVersions} v where v.document_id = ${documents.id} order by v.version desc limit 1)`;

type Resolved = { doc: DocumentRow; source: "file" | "pdf"; file: FileRow | null; edited: boolean; unsaved: boolean; latestVersionId: string | null; headerName: string | null };

/** What attaching this library document would send right now. Throws a message for the user if it cannot be attached. */
export async function resolveAttachment(documentId: string, db: Db): Promise<Resolved> {
  const [row] = await db
    .select({ doc: documents, file: files, edited: editedSql, unsaved: unsavedSql, latestVersionId: latestVersionIdSql, headerName: headerNameSql })
    .from(documents)
    .leftJoin(files, eq(files.id, documents.sourceFileId))
    .where(and(eq(documents.id, documentId), isNull(documents.deletedAt)));
  if (!row) throw new OutreachError("That document is no longer in your library. Choose another.", "invalid");
  if (!(ATTACHABLE_KINDS as readonly string[]).includes(row.doc.kind)) throw new OutreachError("Only a resume or a cover letter from the library can be attached.", "invalid");
  const useFile = row.file !== null && !row.edited;
  return { doc: row.doc, source: useFile ? "file" : "pdf", file: useFile ? row.file : null, edited: row.edited, unsaved: row.unsaved, latestVersionId: row.latestVersionId, headerName: row.headerName };
}

/** The base resume's id, which a new draft starts with. */
export async function baseDocumentId(db: Db): Promise<string | null> {
  const [row] = await db.select({ id: documents.id }).from(documents).where(and(eq(documents.isBase, true), isNull(documents.deletedAt)));
  return row?.id ?? null;
}

const kindFor = (doc: Pick<DocumentRow, "isBase" | "jobId">, jobId: string): AttachmentOption["kind"] => (doc.isBase ? "base" : doc.jobId === jobId ? "job" : "past");

/**
 * The name of a PDF made from a library document. A cover letter says so, because it is usually written for the same
 * job as the resume next to it and would otherwise get the same "Name - Company - Role" name.
 */
function pdfName(doc: Pick<DocumentRow, "kind">, exported: string): string {
  return doc.kind === "cover_letter" ? exported.replace(/\.pdf$/i, " - Cover letter.pdf") : exported;
}

/** The PDF's file name as the export will make it (what the person sees in the picker before it exists). */
const guessName = (doc: Pick<DocumentRow, "kind" | "title" | "companyName" | "targetRole">, headerName: string | null) =>
  pdfName(doc, exportFilename({ name: headerName, title: doc.title, company: doc.companyName, role: doc.targetRole }, "pdf"));

function optionOf(doc: DocumentRow, file: FileRow | null, jobId: string, headerName: string | null, label?: string): AttachmentOption {
  return {
    documentId: doc.id,
    docKind: doc.kind as AttachableKind,
    kind: kindFor(doc, jobId),
    label: label ?? doc.title,
    source: file ? "file" : "pdf",
    name: file ? fileDisplayName(file) : guessName(doc, headerName),
    size: file?.size ?? null,
    mime: file?.mime ?? PDF_MIME,
    fileId: file?.id ?? null,
  };
}

/** A file uploaded only for an email, as an option. */
export function fileOption(file: FileRow, name?: string | null): AttachmentOption {
  return { documentId: null, docKind: null, kind: "upload", label: "Uploaded for this email", source: "file", name: name?.trim() || fileDisplayName(file), size: file.size, mime: file.mime, fileId: file.id };
}

/** One library document as an option (used right after an upload). */
export async function optionForDocument(documentId: string, jobId: string, db: Db, label?: string): Promise<AttachmentOption> {
  const r = await resolveAttachment(documentId, db);
  return optionOf(r.doc, r.file, jobId, r.headerName, label);
}

/**
 * The library documents that can be attached to an email for this job, in the order they are offered: the base resume
 * (the default), what was written for this job (resumes, then cover letters), the rest of the resumes, then the rest of
 * the cover letters. Most recently changed first within each group.
 */
export async function attachmentOptions(jobId: string, db: Db): Promise<AttachmentOption[]> {
  const rows = await db
    .select({ doc: documents, file: files, edited: editedSql, headerName: headerNameSql })
    .from(documents)
    .leftJoin(files, eq(files.id, documents.sourceFileId))
    .where(and(inArray(documents.kind, [...ATTACHABLE_KINDS]), isNull(documents.deletedAt)))
    .orderBy(desc(documents.isBase), desc(documents.updatedAt))
    .limit(100);
  const group = (d: DocumentRow) => (d.isBase ? 0 : (d.jobId === jobId ? 1 : 3) + (d.kind === "resume" ? 0 : 1));
  const label = (d: DocumentRow) => (d.isBase ? "Base resume" : d.companyName ? `${d.title} (${d.companyName})` : d.title);
  return rows
    .sort((a, b) => group(a.doc) - group(b.doc))
    .map((r) => optionOf(r.doc, r.file && !r.edited ? r.file : null, jobId, r.headerName, label(r.doc)));
}

/** Throws unless one file is small enough to send. */
export function checkSize(size: number, what: string) {
  if (size > MAX_ATTACHMENT_BYTES) throw new OutreachError(`${what} is larger than 5 MB. Choose a smaller file.`, "invalid");
}

const startsWith = (b: Buffer, sig: number[] | string) => {
  const s = typeof sig === "string" ? Buffer.from(sig, "latin1") : Buffer.from(sig);
  return b.length >= s.length && b.subarray(0, s.length).equals(s);
};
const isText = (b: Buffer) => {
  if (b.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(b);
    return true;
  } catch {
    return false;
  }
};
const ZIP = [0x50, 0x4b, 0x03, 0x04];
/** What each accepted file must look like inside, so a renamed file of another type is not sent under a false name. */
const LOOKS_LIKE: Record<string, (b: Buffer) => boolean> = {
  pdf: (b) => b.subarray(0, 1024).includes("%PDF-"),
  docx: (b) => startsWith(b, ZIP),
  pptx: (b) => startsWith(b, ZIP),
  xlsx: (b) => startsWith(b, ZIP),
  odt: (b) => startsWith(b, ZIP),
  doc: (b) => startsWith(b, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
  rtf: (b) => startsWith(b, "{\\rtf"),
  png: (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  jpg: (b) => startsWith(b, [0xff, 0xd8, 0xff]),
  jpeg: (b) => startsWith(b, [0xff, 0xd8, 0xff]),
  txt: isText,
  md: isText,
  csv: isText,
};

/** The type a file uploaded for an email is stored and sent as. Throws a message for the user if it cannot be attached. */
export function attachableMime(name: string, bytes: Buffer): string {
  const ext = /\.([a-z0-9]+)$/i.exec(name.trim())?.[1]?.toLowerCase() ?? "";
  const mime = ATTACHABLE_TYPES[ext];
  if (!mime) throw new OutreachError("That type of file cannot be attached. Use a PDF, Word, text, slides, spreadsheet or image file.", "invalid");
  if (bytes.length === 0) throw new OutreachError("That file is empty.", "invalid");
  checkSize(bytes.length, "That file");
  if (!LOOKS_LIKE[ext](bytes)) throw new OutreachError(`That file does not look like a .${ext} file. Open it and save it again, then upload it.`, "invalid");
  return mime;
}

/** Stores a file uploaded to go with an email as it is. It is not added to the library. */
export async function storeUploadedAttachment(file: { bytes: Buffer; name: string }, db: Db): Promise<AttachmentOption> {
  const mime = attachableMime(file.name, file.bytes);
  const stored = await putFile(file.bytes, { mime, originalName: file.name.trim() }, { db });
  return fileOption(stored);
}

const refKey = (r: AttachmentRef) => ("documentId" in r ? attachmentKey({ documentId: r.documentId, fileId: null }) : attachmentKey({ documentId: null, fileId: r.fileId }));
const rowKey = (r: Pick<OutreachAttachmentRow, "documentId" | "fileId">) => attachmentKey(r);

/** Throws unless every attachment chosen for a draft can go (it exists, is the right kind, and is small enough). Drops repeats. */
export async function checkRefs(refs: AttachmentRef[], db: Db): Promise<AttachmentRef[]> {
  const unique = [...new Map(refs.map((r) => [refKey(r), r])).values()];
  if (unique.length > MAX_ATTACHMENTS) throw new OutreachError(`An email can carry at most ${MAX_ATTACHMENTS} attachments.`, "invalid");
  for (const ref of unique) {
    if ("documentId" in ref) {
      const r = await resolveAttachment(ref.documentId, db);
      if (r.file) checkSize(r.file.size, `"${fileDisplayName(r.file)}"`);
      continue;
    }
    const [file] = await db.select().from(files).where(eq(files.id, ref.fileId));
    if (!file) throw new OutreachError("That file is no longer stored. Upload it again.", "invalid");
    if (!Object.values(ATTACHABLE_TYPES).includes(file.mime)) throw new OutreachError("That file cannot be attached.", "invalid");
    checkSize(file.size, `"${fileDisplayName(file)}"`);
  }
  return unique;
}

/**
 * Makes the email's attachments exactly `refs`, in that order. Attachments that stay keep what was prepared for them
 * (so an unchanged PDF is not made again); the rest are removed or added.
 */
export async function setAttachments(emailId: string, refs: AttachmentRef[], db: DbOrTx): Promise<void> {
  const current = await db.select().from(outreachAttachments).where(eq(outreachAttachments.emailId, emailId));
  const byKey = new Map(current.map((r) => [rowKey(r), r]));
  const wanted = new Set(refs.map(refKey));
  const drop = current.filter((r) => !wanted.has(rowKey(r))).map((r) => r.id);
  if (drop.length > 0) await db.delete(outreachAttachments).where(inArray(outreachAttachments.id, drop));
  for (const [position, ref] of refs.entries()) {
    const existing = byKey.get(refKey(ref));
    if (existing) {
      if (existing.position !== position) await db.update(outreachAttachments).set({ position }).where(eq(outreachAttachments.id, existing.id));
      continue;
    }
    await db
      .insert(outreachAttachments)
      .values({ emailId, position, ...("documentId" in ref ? { documentId: ref.documentId } : { fileId: ref.fileId }) })
      .onConflictDoNothing();
  }
}

/** An email's attachment rows, in order. */
export function attachmentRows(emailId: string, db: Db): Promise<OutreachAttachmentRow[]> {
  return db.select().from(outreachAttachments).where(eq(outreachAttachments.emailId, emailId)).orderBy(asc(outreachAttachments.position));
}

/**
 * One attachment as shown on a draft: what is chosen and, if it has been prepared and nothing changed since, the file
 * that will go. Returns null when its document has since been deleted or its file is gone.
 */
async function draftAttachment(a: OutreachAttachmentRow, jobId: string, db: Db): Promise<DraftAttachmentDTO | null> {
  if (!a.documentId) {
    const [file] = a.fileId ? await db.select().from(files).where(eq(files.id, a.fileId)) : [];
    return file ? fileOption(file, a.name) : null;
  }
  const r = await resolveAttachment(a.documentId, db).catch(() => null);
  if (!r) return null;
  let file = r.file;
  if (!file && a.fileId && a.versionId && a.versionId === r.latestVersionId && !r.unsaved) {
    [file] = await db.select().from(files).where(eq(files.id, a.fileId));
  }
  const option = optionOf(r.doc, file ?? null, jobId, r.headerName);
  return { ...option, source: r.source, name: file && a.name && file.id !== r.doc.sourceFileId ? a.name : option.name };
}

/** The attachments shown on a draft, in order. */
export async function draftAttachments(email: { id: string; jobId: string }, db: Db): Promise<DraftAttachmentDTO[]> {
  const rows = await attachmentRows(email.id, db);
  const out = await Promise.all(rows.map((a) => draftAttachment(a, email.jobId, db)));
  return out.filter((a): a is DraftAttachmentDTO => a !== null);
}

export type PrepareDeps = { pdf?: typeof renderPdf; storageDir?: string };

export type PreparedAttachment = {
  fileId: string;
  name: string;
  size: number;
  mime: string;
  source: "file" | "pdf";
  /** The library document it came from; null for a file uploaded only for the email. */
  documentId: string | null;
  versionId: string | null;
  pages: number | null;
  versionCreated: boolean;
};

/**
 * Gets one attachment ready to send: a plain uploaded file as it is, the original file for an unedited library upload,
 * or a PDF made from the document's current text. A PDF is stored (it leaves the app, so the exact bytes are kept) and
 * the version it was made from is recorded on the attachment. If nothing changed since the last time, the same file is
 * reused.
 */
async function prepareOne(a: OutreachAttachmentRow, deps: PrepareDeps, db: Db): Promise<PreparedAttachment> {
  const setRow = (patch: Partial<typeof outreachAttachments.$inferInsert>) => db.update(outreachAttachments).set(patch).where(eq(outreachAttachments.id, a.id));

  if (!a.documentId) {
    const [file] = a.fileId ? await db.select().from(files).where(eq(files.id, a.fileId)) : [];
    if (!file) throw new OutreachError("An attached file is no longer stored. Remove it and upload it again.", "invalid");
    const name = a.name?.trim() || fileDisplayName(file);
    checkSize(file.size, `"${name}"`);
    return { fileId: file.id, name, size: file.size, mime: file.mime, source: "file", documentId: null, versionId: null, pages: null, versionCreated: false };
  }

  const r = await resolveAttachment(a.documentId, db);
  if (r.source === "file" && r.file) {
    checkSize(r.file.size, `"${fileDisplayName(r.file)}"`);
    const latest = await latestVersion(r.doc.id, db);
    await setRow({ fileId: r.file.id, versionId: latest?.id ?? null, name: null });
    return { fileId: r.file.id, name: fileDisplayName(r.file), size: r.file.size, mime: r.file.mime, source: "file", documentId: r.doc.id, versionId: latest?.id ?? null, pages: null, versionCreated: false };
  }

  const made = await createVersion(r.doc.id, { reason: "attach" }, db);
  if (made.created && r.doc.kind === "resume") await enqueueDocumentIndex(r.doc.id, {}, db).catch(() => null);

  const reusable = a.fileId && a.versionId === made.version.id && a.fileId !== r.doc.sourceFileId;
  if (reusable) {
    const [file] = await db.select().from(files).where(eq(files.id, a.fileId!));
    if (file) {
      const pages = await countPdfPages(await getFileBytes(file.sha256, { db, dir: deps.storageDir })).catch(() => null);
      return { fileId: file.id, name: a.name?.trim() || fileDisplayName(file), size: file.size, mime: file.mime, source: "pdf", documentId: r.doc.id, versionId: made.version.id, pages, versionCreated: false };
    }
  }

  let out: Awaited<ReturnType<typeof exportDocument>>;
  try {
    out = await exportDocument(r.doc.id, { format: "pdf", versionId: made.version.id }, { db, pdf: deps.pdf });
  } catch (err) {
    throw new OutreachError(`Could not make the PDF from "${r.doc.title}": ${err instanceof Error ? err.message : "unknown error"}`, "send_failed");
  }
  checkSize(out.bytes.length, `The PDF made from "${r.doc.title}"`);
  const name = pdfName(r.doc, out.filename);
  const stored = await putFile(out.bytes, { mime: PDF_MIME, originalName: name }, { db, dir: deps.storageDir });
  await setRow({ fileId: stored.id, versionId: made.version.id, name });
  return { fileId: stored.id, name, size: stored.size, mime: PDF_MIME, source: "pdf", documentId: r.doc.id, versionId: made.version.id, pages: out.pages ?? null, versionCreated: made.created };
}

/**
 * Gets every attachment of the job's draft ready to send, in order (see `prepareOne`), and checks they fit in one email
 * together. Returns an empty list when the draft has none.
 */
export async function prepareAttachments(jobId: string, deps: PrepareDeps = {}, db: Db = defaultDb()): Promise<PreparedAttachment[]> {
  const [draft] = await db.select({ id: outreachEmails.id }).from(outreachEmails).where(and(eq(outreachEmails.jobId, jobId), eq(outreachEmails.status, "draft")));
  if (!draft) return [];
  const out: PreparedAttachment[] = [];
  // One at a time: making a PDF starts a browser, and the order is the order they go out in.
  for (const a of await attachmentRows(draft.id, db)) out.push(await prepareOne(a, deps, db));
  const total = out.reduce((n, a) => n + a.size, 0);
  if (total > MAX_ATTACHMENT_BYTES) {
    throw new OutreachError(`The attachments add up to ${formatBytes(total)}, more than the 5 MB one email can carry. Remove one or use smaller files.`, "invalid");
  }
  return out;
}

/** After an email went out: the versions it was made from can never change. */
export async function lockSentVersions(versionIds: (string | null)[], jobId: string, at: Date, db: Db): Promise<void> {
  for (const id of new Set(versionIds)) if (id) await lockVersion(id, { jobId, at }, db);
}
