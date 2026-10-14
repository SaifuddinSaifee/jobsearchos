"use client";

import { AlertTriangle, ClipboardCheck, Library, Loader2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Collapse } from "@/components/ui/collapse";
import { SkipButton } from "./skip-button";
import { isPreparing, useCareerStatus } from "./use-career-status";

/**
 * Sidebar footer: sources on their way into the career record. Shows what is being read and how far along the batch
 * is, and links straight to the review when one is ready. It slides away when there is nothing to show.
 */
export function CareerTracker() {
  const { data, isSuccess } = useCareerStatus();
  const preparing = data ? isPreparing(data) : false;
  const ready = data?.counts.ready ?? 0;
  const failed = data?.counts.failed ?? 0;
  const visible = isSuccess && !!data && (preparing || ready > 0 || failed > 0);

  // Keep showing the last non-empty status while the card slides away, so it does not collapse to empty text.
  const [shown, setShown] = useState(data);
  if (visible && shown !== data) setShown(data);
  const s = visible ? data : shown;
  if (!s) return <Collapse open={false}>{null}</Collapse>;

  const waiting = s.counts.queued;
  const href = s.counts.ready > 0 ? "/library/record/review" : "/library?tab=record";
  const progress = s.total ? s.done / s.total : 0;
  const working = isPreparing(s);

  return (
    <Collapse open={visible}>
      <div className="mx-1 mb-1 rounded-lg border bg-sidebar-accent/40 text-xs transition-colors duration-200 has-[a:hover]:bg-sidebar-accent group-data-[collapsible=icon]:hidden">
        <Link href={href} className="block rounded-lg p-2.5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none" aria-live="polite">
          <div className="flex items-center gap-2 font-medium">
            {working ? (
              <Loader2 className="size-3.5 animate-spin text-primary motion-reduce:animate-none" aria-hidden />
            ) : (
              <Library className="size-3.5 text-muted-foreground" aria-hidden />
            )}
            <span key={working ? "working" : "idle"} className="animate-in fade-in duration-200 motion-reduce:animate-none">
              {working ? "Building career record" : "Career record"}
            </span>
          </div>

          <Collapse open={working}>
            <div className="pt-1.5">
              <div
                key={s.current?.id ?? "next"}
                className="truncate text-muted-foreground animate-in fade-in slide-in-from-bottom-1 duration-200 motion-reduce:animate-none"
                title={s.current?.label}
              >
                {s.current?.status === "running" ? `Reading ${s.current.label}` : "Starting the next source"}
              </div>
              <div className="pt-2">
                <div className="h-1 overflow-hidden rounded-full bg-border">
                  <div
                    className="h-full rounded-full bg-primary transition-[width] duration-700 ease-out motion-reduce:transition-none"
                    style={{ width: `${Math.max(progress * 100, 6)}%` }}
                  />
                </div>
                <div className="mt-1 text-muted-foreground tabular-nums">
                  {s.done} of {s.total} done
                </div>
              </div>
            </div>
          </Collapse>

          <Collapse open={s.counts.ready > 0}>
            <div className="flex items-start gap-1.5 pt-2 text-amber-700 dark:text-amber-300">
              <ClipboardCheck className="mt-px size-3.5 shrink-0" aria-hidden />
              <span className="min-w-0">
                <span className="block truncate" title={s.current?.label}>
                  Ready to review: {s.current?.label ?? "a source"}
                </span>
                {waiting > 0 && <span className="block text-muted-foreground tabular-nums">{waiting} more waiting after it</span>}
              </span>
            </div>
          </Collapse>
          <Collapse open={s.counts.failed > 0}>
            <div className="flex items-center gap-1.5 pt-2 text-destructive">
              <AlertTriangle className="size-3.5" aria-hidden />
              <span className="tabular-nums">{s.counts.failed}</span> could not be prepared
            </div>
          </Collapse>
        </Link>
        {/* Outside the link, so stopping never also navigates. */}
        <Collapse open={!!s.current}>
          {s.current && (
            <div className="px-1.5 pb-1.5">
              <SkipButton proposalId={s.current.id} ready={s.current.status === "ready"} size="xs" variant="ghost" />
            </div>
          )}
        </Collapse>
      </div>
    </Collapse>
  );
}
