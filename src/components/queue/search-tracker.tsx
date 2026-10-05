"use client";

import { Loader2, UsersRound } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useSearches } from "@/components/outreach/use-searches";
import { Collapse } from "@/components/ui/collapse";
import { isSearchActive, SEARCH_STEP_LABEL, SEARCH_STEPS, searchProgress, type SearchItem } from "@/lib/outreach/types";

/** The step to show on one line: the one running, else the last one finished. */
function stepText(s: SearchItem): string {
  const running = SEARCH_STEPS.find((n) => s.steps[n]?.status === "running");
  if (running) return SEARCH_STEP_LABEL[running];
  return s.status === "queued" ? "Waiting to start" : "Finishing up";
}

/** Sidebar card for background "find people" runs. It slides away when none is working. */
export function SearchTracker() {
  const { searches, isSuccess } = useSearches();
  const active = searches.filter(isSearchActive);
  const visible = isSuccess && active.length > 0;

  // Keep showing the last summary while the card slides away, so it does not collapse to empty text.
  const [shown, setShown] = useState<SearchItem[]>([]);
  if (visible && JSON.stringify(shown) !== JSON.stringify(active)) setShown(active);
  const list = visible ? active : shown;
  const first = list[0];
  const progress = list.length ? list.reduce((n, s) => n + searchProgress(s.steps), 0) / list.length : 0;

  return (
    <Collapse open={visible}>
      {first && (
        <Link
          href={list.length === 1 ? `/jobs/${first.jobId}/outreach` : "/jobs"}
          className="mx-1 mb-1 block rounded-lg border bg-sidebar-accent/40 p-2.5 text-xs transition-colors duration-200 hover:bg-sidebar-accent group-data-[collapsible=icon]:hidden"
          aria-live="polite"
        >
          <div className="flex items-center gap-2 font-medium">
            <Loader2 className="size-3.5 animate-spin text-primary motion-reduce:animate-none" aria-hidden />
            <span>{list.length === 1 ? "Finding people" : `Finding people for ${list.length} jobs`}</span>
          </div>
          <div className="flex items-center gap-1.5 pt-1.5 text-muted-foreground">
            <UsersRound className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">{list.length === 1 ? first.label : stepText(first)}</span>
          </div>
          <div className="pt-2">
            <div className="h-1 overflow-hidden rounded-full bg-border">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-700 ease-out motion-reduce:transition-none"
                style={{ width: `${Math.max(progress * 100, 8)}%` }}
              />
            </div>
            {list.length === 1 && <div className="mt-1 text-muted-foreground">{stepText(first)}</div>}
          </div>
        </Link>
      )}
    </Collapse>
  );
}
