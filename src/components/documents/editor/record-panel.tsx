"use client";

import type { Editor } from "@tiptap/core";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { BookOpen, Check, Loader2, Plus, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { normalizeText } from "@/lib/career/normalize";
import type { PanelRole } from "@/lib/career/panel";
import { cn } from "@/lib/utils";
import { insertBullet } from "./commands";
import { useRoleUnderCursor } from "./use-role-under-cursor";

type Answer = { hasRecord: boolean; role: PanelRole | null };

/** Waits for the value to stop changing, so typing a title does not ask the server on every key. */
function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return settled;
}

async function fetchWordings(documentId: string, [id, company, title, dates]: [string, string, string, string]): Promise<Answer> {
  const params = new URLSearchParams({ documentId, roleBlockId: id, company, title, dates });
  const res = await fetch(`/api/career/wordings?${params}`);
  if (!res.ok) throw new Error("Could not load your career record");
  return res.json();
}

/** The career record's wordings for the role the cursor is in, each one click from the page. */
export function RecordPanel({ editor, documentId, onClose }: { editor: Editor; documentId: string; onClose: () => void }) {
  const role = useRoleUnderCursor(editor);
  // Typing a title changes the question on every key; ask once it has settled.
  const settledKey = useSettled(role ? JSON.stringify([role.id, role.company, role.title, role.dates]) : null, 300);
  const settled = settledKey ? (JSON.parse(settledKey) as [string, string, string, string]) : null;
  const [onlyFit, setOnlyFit] = useState(true);

  const query = useQuery({
    queryKey: ["career-wordings", documentId, settledKey],
    queryFn: () => fetchWordings(documentId, settled as [string, string, string, string]),
    enabled: settled !== null,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
  const found = query.data?.role ?? null;
  const onPage = new Set((role?.bullets ?? []).map(normalizeText));

  function insert(text: string) {
    if (!role) return;
    if (insertBullet(editor, role.pos, text)) toast.success(`Added to ${role.title || "this role"}`);
    else toast.error("That could not be added here.");
  }

  const facts = (found?.facts ?? [])
    .map((f) => ({ ...f, wordings: f.wordings.filter((w) => !onlyFit || w.fits) }))
    .filter((f) => f.wordings.length > 0);

  return (
    <aside
      aria-label="Your career record"
      className="fixed top-60 right-4 z-30 max-h-[calc(100vh-16rem)] w-80 space-y-3 overflow-y-auto rounded-lg border bg-background p-3 shadow-lg animate-in fade-in slide-in-from-right-3 duration-300 motion-reduce:animate-none"
    >
      <header className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          <BookOpen className="size-4" aria-hidden />
          Career record
        </h2>
        <Button type="button" variant="ghost" size="icon-xs" aria-label="Close the career record panel" onClick={onClose}>
          <X />
        </Button>
      </header>

      {!role ? (
        <p className="text-sm text-muted-foreground">Put the cursor in a role to see what your record has for it.</p>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            For <span className="font-medium text-foreground">{[role.title, role.company].filter(Boolean).join(" at ") || "this role"}</span>
            {query.isFetching && <Loader2 className="ml-1.5 inline size-3 animate-spin motion-reduce:animate-none" aria-label="Loading" />}
          </p>

          {query.isError ? (
            <p className="text-sm text-destructive">Could not load your career record.</p>
          ) : query.data && !query.data.hasRecord ? (
            <p className="text-sm text-muted-foreground">
              You have no career record yet. <Link href="/library?tab=record" className="underline underline-offset-2">Build it from your library</Link> to reuse your wording here.
            </p>
          ) : query.data && !found ? (
            <p className="text-sm text-muted-foreground">Nothing in your record for this role yet.</p>
          ) : found ? (
            <>
              {found.matchedFramingId && found.framings.length > 1 && (
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input type="checkbox" className="size-3.5" checked={onlyFit} onChange={(e) => setOnlyFit(e.target.checked)} />
                  Only wordings that fit {found.title}
                </label>
              )}
              {facts.length === 0 && <p className="text-sm text-muted-foreground">Your record has no wordings for this role{onlyFit ? " under this title" : ""}.</p>}
              <ul className="space-y-2">
                {facts.map((f) => (
                  <li key={f.id} className="space-y-1.5 rounded-md border p-2">
                    {f.wordings.map((w) => {
                      const there = onPage.has(normalizeText(w.text));
                      return (
                        <div key={w.id} className={cn("flex items-start gap-2 text-sm", !w.fits && "opacity-60")}>
                          <div className="min-w-0 flex-1 space-y-1">
                            <p>{w.text}</p>
                            <div className="flex flex-wrap gap-1">
                              {w.form === "paragraph" && <Badge variant="secondary">Story</Badge>}
                              {w.framing && <Badge variant="outline">{w.framing}</Badge>}
                            </div>
                          </div>
                          {there ? (
                            <Badge variant="secondary" className="shrink-0">
                              <Check aria-hidden /> On the page
                            </Badge>
                          ) : (
                            <Button type="button" size="xs" variant="outline" className="shrink-0" onClick={() => insert(w.text)} aria-label={`Insert into the page: ${w.text.slice(0, 40)}`}>
                              <Plus aria-hidden /> Insert
                            </Button>
                          )}
                        </div>
                      );
                    })}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> Looking in your record
            </p>
          )}
        </div>
      )}
    </aside>
  );
}
