/** Client-safe types for the resume search index (no database or server imports). */

export type IndexStatus = "queued" | "running" | "ready" | "failed";

/** Where a library resume is in the search-index pipeline (the state of its latest version). */
export type IndexInfo = {
  id: string;
  documentId: string;
  versionId: string;
  status: IndexStatus;
  chunkCount: number;
  note: string | null;
  error: string | null;
};

export const isIndexActive = (status: IndexStatus | undefined) => status === "queued" || status === "running";

/** What the index says about a resume, in words. */
export function indexLabel(info: IndexInfo | undefined): string {
  if (!info) return "Not indexed";
  switch (info.status) {
    case "queued":
      return "Waiting to index";
    case "running":
      return "Indexing";
    case "ready":
      if (info.chunkCount === 0) return "Nothing to index yet";
      return `Indexed, ${info.chunkCount} ${info.chunkCount === 1 ? "section" : "sections"}`;
    case "failed":
      return "Indexing failed";
  }
}
