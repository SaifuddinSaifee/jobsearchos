"use client";

import dynamic from "next/dynamic";
import { useSyncExternalStore } from "react";
import type { DocumentEditorProps } from "./editor/document-editor";

const DocumentEditor = dynamic(() => import("./editor/document-editor").then((m) => m.DocumentEditor), {
  ssr: false,
  loading: () => <div className="h-96 animate-pulse rounded-xl bg-muted/60 motion-reduce:animate-none" aria-label="Loading the editor" />,
});

const QUERY = "(min-width: 768px)";
const subscribe = (cb: () => void) => {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};

/**
 * Loads the editor only where there is room to write on a page: on a phone it shows the page to read (and the export
 * still works). The editor's code is not downloaded at all in that case.
 */
export function EditorLoader({ fallback, ...props }: DocumentEditorProps & { fallback: React.ReactNode }) {
  const wide = useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => true,
  );
  if (!wide) {
    return (
      <div className="space-y-3">
        <p className="rounded-lg border bg-muted/40 px-4 py-2.5 text-sm text-muted-foreground">Editing needs a wider screen. You can read and export this document here.</p>
        {fallback}
      </div>
    );
  }
  return <DocumentEditor {...props} />;
}
