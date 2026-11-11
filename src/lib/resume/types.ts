/** Client-safe types for reading resumes into sections (no database or server imports). */

export type IndexStatus = "queued" | "running" | "ready" | "failed";

/** Where a library resume is in being read into sections (the state of its latest version). */
export type IndexInfo = {
  id: string;
  documentId: string;
  versionId: string;
  status: IndexStatus;
  note: string | null;
  error: string | null;
};

export const isIndexActive = (status: IndexStatus | undefined) => status === "queued" || status === "running";

/** What reading says about a resume, in words. Null when there is nothing to say: it is read, or never needed it. */
export function indexLabel(info: IndexInfo | undefined): string | null {
  switch (info?.status) {
    case "queued":
      return "Waiting to be read";
    case "running":
      return "Reading into sections";
    case "failed":
      return "Could not be read";
    default:
      return null;
  }
}
