"use client";

import { useQuery } from "@tanstack/react-query";
import type { DocumentOffer } from "@/lib/career/offer";

/** Prefix of every document's offer query, to refresh them all after a save or an add. */
export const DOCUMENT_OFFER_KEY = ["career-offer"] as const;

async function fetchOffer(documentId: string): Promise<DocumentOffer> {
  const res = await fetch(`/api/career/document/${documentId}`);
  if (!res.ok)
    throw new Error(
      "Could not load where this document stands with your career record",
    );
  return (await res.json()).offer;
}

/** Where a document stands with the career record. Polls while it is being read or added, and not otherwise. */
export function useDocumentOffer(documentId: string) {
  return useQuery({
    queryKey: [...DOCUMENT_OFFER_KEY, documentId],
    queryFn: () => fetchOffer(documentId),
    refetchInterval: (query) => {
      const state = query.state.data?.state;
      return state === "adding" || state === "reading" ? 1500 : false;
    },
  });
}
