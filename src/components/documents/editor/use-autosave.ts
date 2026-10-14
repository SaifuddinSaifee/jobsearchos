"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DocJSON } from "@/lib/documents/build";

export type SaveStatus = "saved" | "dirty" | "saving" | "error" | "conflict";

const DELAY_MS = 800;
const RETRY_MS = 4000;
const KEEPALIVE_MAX = 60_000;

type Payload = { content: DocJSON; subject: string };

/**
 * Writes the editor's content to the server shortly after typing stops, one request at a time. Edits that arrive while
 * a save is running are saved straight after it. If another tab saved in between, the server refuses (409) and nothing
 * is overwritten: the status becomes "conflict" and the page asks to reload. A save that fails is tried again.
 */
export function useAutosave({ documentId, initialRevision, onSaved }: { documentId: string; initialRevision: number; onSaved?: () => void }) {
  const [status, setStatus] = useState<SaveStatus>("saved");
  const revision = useRef(initialRevision);
  const dirty = useRef(false);
  const inflight = useRef<Promise<boolean> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const statusRef = useRef<SaveStatus>("saved");
  const readRef = useRef<(() => Payload) | null>(null);
  const runRef = useRef<(keepalive?: boolean) => Promise<boolean>>(async () => true);
  const onSavedRef = useRef(onSaved);
  useEffect(() => {
    onSavedRef.current = onSaved;
  });

  /** Tells the hook how to read what is on the page. Call it from an effect whenever the page can change. */
  const setReader = useCallback((read: () => Payload) => {
    readRef.current = read;
  }, []);

  const set = useCallback((s: SaveStatus) => {
    statusRef.current = s;
    setStatus(s);
  }, []);

  const run = useCallback(
    async (keepalive = false): Promise<boolean> => {
      if (statusRef.current === "conflict") return false;
      if (inflight.current) await inflight.current;
      if (!dirty.current) return statusRef.current !== "error";

      dirty.current = false;
      set("saving");
      const attempt = (async () => {
        try {
          const body = JSON.stringify({ ...readRef.current?.(), revision: revision.current });
          const res = await fetch(`/api/documents/${documentId}/draft`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body,
            // A request that is allowed to outlive the page, so a save still running when the tab closes or reloads is not
            // cancelled. Browsers allow this only for small bodies (64 KB); a resume is well under that.
            keepalive: keepalive || body.length < KEEPALIVE_MAX,
          });
          if (res.status === 409) {
            set("conflict");
            return false;
          }
          if (!res.ok) throw new Error("save failed");
          revision.current = (await res.json()).revision;
          set(dirty.current ? "dirty" : "saved");
          onSavedRef.current?.();
          return true;
        } catch {
          dirty.current = true;
          set("error");
          clearTimeout(timer.current);
          timer.current = setTimeout(() => void runRef.current(), RETRY_MS);
          return false;
        }
      })();
      inflight.current = attempt;
      const ok = await attempt;
      inflight.current = null;
      // Typing continued during the save: save that too.
      return ok && dirty.current ? runRef.current() : ok;
    },
    [documentId, set],
  );
  useEffect(() => {
    runRef.current = run;
  }, [run]);

  /** Call after every change. */
  const markDirty = useCallback(() => {
    if (statusRef.current === "conflict") return;
    dirty.current = true;
    set("dirty");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void run(), DELAY_MS);
  }, [run, set]);

  /** Saves now, and resolves when it is on the server (true) or could not be (false). */
  const flush = useCallback(() => {
    clearTimeout(timer.current);
    return run();
  }, [run]);

  // Closing the tab or leaving the page still saves what was typed last.
  useEffect(() => {
    const leave = () => {
      if (dirty.current) void run(true);
    };
    const hidden = () => document.visibilityState === "hidden" && leave();
    window.addEventListener("pagehide", leave);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("pagehide", leave);
      document.removeEventListener("visibilitychange", hidden);
      clearTimeout(timer.current);
      leave();
    };
  }, [run]);

  return { status, markDirty, flush, setReader };
}
