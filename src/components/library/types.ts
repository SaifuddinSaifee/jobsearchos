import type { DocumentKind, DocumentOrigin } from "@/lib/documents/types";

/** A document as the list shows it. Dates are ISO strings so the row can cross from server to client. */
export type LibraryRow = {
  id: string;
  kind: DocumentKind;
  origin: DocumentOrigin;
  title: string;
  isBase: boolean;
  jobId: string | null;
  jobTitle: string | null;
  companyName: string | null;
  targetRole: string | null;
  writtenOn: string | null;
  versionCount: number;
  locked: boolean;
  updatedAt: string;
};

export type JobChoice = { id: string; label: string };

export const ORIGIN_LABELS: Record<DocumentOrigin, string> = {
  uploaded: "Uploaded",
  pasted: "Pasted",
  blank: "Written here",
  copied: "Copy",
  sent: "Sent",
  generated: "Generated",
};
