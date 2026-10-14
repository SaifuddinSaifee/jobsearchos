import type { DocumentKind } from "../types";

// Safe to import from client code: no server-only modules.

export const EXPORT_FORMATS = ["pdf", "docx", "md", "txt"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const FORMAT_INFO: Record<ExportFormat, { label: string; ext: string; mime: string }> = {
  pdf: { label: "PDF", ext: "pdf", mime: "application/pdf" },
  docx: { label: "Word (DOCX)", ext: "docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  md: { label: "Markdown", ext: "md", mime: "text/markdown; charset=utf-8" },
  txt: { label: "Plain text", ext: "txt", mime: "text/plain; charset=utf-8" },
};

/** Formats a kind of document can be exported as. Emails are text; PDF and Word are for documents you send as files. */
export function formatsFor(kind: DocumentKind): readonly ExportFormat[] {
  return kind === "email" ? ["md", "txt"] : EXPORT_FORMATS;
}
