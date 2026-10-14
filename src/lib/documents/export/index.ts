import type { Db } from "@/lib/db";
import type { DocumentRow, DocumentVersionRow } from "@/lib/db/schema";
import type { DocJSON } from "../build";
import { docToMarkdown } from "../convert/doc-to-markdown";
import { docToText } from "../convert/doc-to-text";
import { parsePageSettings, type PageSettings } from "../page-settings";
import { firstOf, headerOf, plainText } from "../read";
import { createVersion, DocumentError, getEditorData, getVersion, type DbOrTx } from "../service";
import { renderDocx } from "./docx";
import { formatsFor, FORMAT_INFO, type ExportFormat } from "./formats";
import { renderPdf } from "./pdf";

export { EXPORT_FORMATS, FORMAT_INFO, formatsFor, type ExportFormat } from "./formats";

/** Characters that are not allowed in file names on common systems. */
const clean = (s: string) => s.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim();

/** "Name - Company - Role.ext", leaving out whatever is not known. Falls back to the document's title. */
export function exportFilename(parts: { name?: string | null; title: string; company?: string | null; role?: string | null }, ext: string): string {
  const named = [parts.name, parts.company, parts.role].map((p) => clean(p ?? "")).filter(Boolean);
  const stem = (named.length > 0 && parts.name?.trim() ? named : [clean(parts.title)]).join(" - ").slice(0, 120).trim() || "document";
  return `${stem}.${ext}`;
}

export type ExportResult = {
  bytes: Buffer;
  mime: string;
  filename: string;
  /** Pages in the PDF. */
  pages?: number;
  /** The version the file was made from, for files that leave the app (PDF, Word). */
  version?: DocumentVersionRow;
  /** True when making this export saved a new version. */
  versionCreated?: boolean;
  settings: PageSettings;
};

export type ExportDeps = {
  db?: Db;
  pdf?: typeof renderPdf;
  docx?: typeof renderDocx;
};

/** The text of an email export: the subject on its own line first, then the body. */
const withSubject = (subject: string, body: string) => (subject ? `Subject: ${subject}\n\n${body}` : body);

/**
 * Makes a file from a document. Without `versionId` it exports what is in the editor now; PDF and Word files first
 * save that as a version (reason "export", skipped if nothing changed), so the exact content of every file that left
 * the app can be found again. With `versionId` it exports that saved version as it was.
 */
export async function exportDocument(documentId: string, opts: { format: ExportFormat; versionId?: string | null }, deps: ExportDeps = {}): Promise<ExportResult> {
  const db = deps.db as DbOrTx | undefined;
  const data = await getEditorData(documentId, db);
  if (!data) throw new DocumentError("not_found", "Document not found");
  const { document: doc } = data;
  if (!formatsFor(doc.kind).includes(opts.format)) throw new DocumentError("blocked", "An email can be exported as Markdown or plain text.");

  let content: DocJSON = data.draft.content;
  let subject = data.draft.subject;
  let settings = data.pageSettings;
  let version: DocumentVersionRow | undefined;
  let versionCreated = false;

  if (opts.versionId) {
    const v = await getVersion(opts.versionId, db);
    if (!v || v.documentId !== documentId) throw new DocumentError("not_found", "Version not found");
    version = v;
    ({ content, subject } = v);
    settings = parsePageSettings(v.pageSettings);
  } else if (opts.format === "pdf" || opts.format === "docx") {
    const made = await createVersion(documentId, { reason: "export" }, db);
    version = made.version;
    versionCreated = made.created;
    ({ content, subject } = made.version);
    settings = parsePageSettings(made.version.pageSettings);
  }

  const info = FORMAT_INFO[opts.format];
  const filename = exportFilename(...filenameParts(doc, content, data.job?.company ?? null, data.job?.title ?? null, info.ext));
  const base = { mime: info.mime, filename, version, versionCreated, settings };

  if (opts.format === "md") return { ...base, bytes: Buffer.from(withSubject(subject, docToMarkdown(content)) + "\n", "utf8") };
  if (opts.format === "txt") return { ...base, bytes: Buffer.from(withSubject(subject, docToText(content)) + "\n", "utf8") };
  if (opts.format === "docx") return { ...base, bytes: await (deps.docx ?? renderDocx)(content, settings, { title: doc.title }) };
  const pdf = await (deps.pdf ?? renderPdf)(content, settings, { title: doc.title });
  return { ...base, bytes: pdf.bytes, pages: pdf.pages };
}

function filenameParts(doc: DocumentRow, content: DocJSON, jobCompany: string | null, jobTitle: string | null, ext: string): [Parameters<typeof exportFilename>[0], string] {
  const header = headerOf(content);
  const name = header ? plainText(firstOf(header, "headerName")).trim() : "";
  return [{ name, title: doc.title, company: doc.companyName ?? jobCompany, role: doc.targetRole ?? jobTitle }, ext];
}
