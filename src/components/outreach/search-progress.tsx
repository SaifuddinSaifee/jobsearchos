"use client";

import { CircleAlert, CircleCheck, CircleDashed, Loader2 } from "lucide-react";
import { SEARCH_STEP_LABEL, SEARCH_STEPS, type SearchItem } from "@/lib/outreach/types";
import { cn } from "@/lib/utils";

/** The steps of a running search with their state, so waiting never looks like nothing is happening. */
export function SearchProgress({ search }: { search: SearchItem | null }) {
  const queued = !search || search.status === "queued";
  return (
    <div role="status" aria-label="Searching for people" className="space-y-2.5 rounded-xl border bg-card p-3 text-sm animate-in fade-in duration-200 motion-reduce:animate-none">
      <ul className="space-y-1.5">
        {SEARCH_STEPS.map((name) => {
          const s = search?.steps[name];
          const Icon = !s ? CircleDashed : s.status === "running" ? Loader2 : s.status === "done" ? CircleCheck : s.status === "failed" ? CircleAlert : CircleDashed;
          return (
            <li key={name} className={cn("flex items-center gap-2 transition-opacity duration-200", !s && "opacity-50")}>
              <Icon
                aria-hidden
                className={cn(
                  "size-4 shrink-0 transition-colors",
                  s?.status === "running" && "animate-spin text-primary motion-reduce:animate-none",
                  s?.status === "done" && "text-green-600",
                  s?.status === "failed" && "text-destructive",
                  (!s || s.status === "skipped") && "text-muted-foreground",
                )}
              />
              <span className={s?.status === "skipped" ? "text-muted-foreground" : undefined}>{SEARCH_STEP_LABEL[name]}</span>
              {s?.detail && <span className="text-xs text-muted-foreground">{s.detail}</span>}
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-muted-foreground">
        {queued ? "Waiting for a free worker. " : ""}You can leave this page. The search keeps running and you will be told when it finishes.
      </p>
    </div>
  );
}
