"use client";

import { RefreshCw, Sparkles } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatDate } from "@/lib/jobs/format";
import { cn } from "@/lib/utils";
import { useResumeActions } from "./use-resume-actions";

/**
 * Above the editor of a resume that was written for a job: where it came from, and a way to write it again (for when
 * it missed, or the career record has more in it now). The new one is saved as the next version, so this one stays in
 * the version history.
 */
export function GeneratedStrip({
  jobId,
  jobLabel,
  writtenOn,
  beforeRegenerate,
}: {
  jobId: string;
  jobLabel: string | null;
  writtenOn: string | null;
  /** Saves what is being typed, so the version kept behind the new one is what is on screen now. */
  beforeRegenerate: () => Promise<unknown>;
}) {
  const { busy, start } = useResumeActions(jobId);
  const [confirm, setConfirm] = useState(false);

  async function regenerate() {
    await beforeRegenerate();
    const ok = await start({ regenerate: true, open: true });
    if (ok) setConfirm(false);
  }

  return (
    <>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border bg-muted/40 px-4 py-2.5 text-sm">
        <Sparkles className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1">
          Written for {jobLabel ?? "a job"}
          {writtenOn ? ` on ${formatDate(writtenOn)}` : ""}, from your career record.
        </span>
        <Link href={`/jobs?job=${jobId}`} className={cn(buttonVariants({ variant: "ghost", size: "xs" }))}>
          View job
        </Link>
        <Button size="xs" variant="outline" onClick={() => setConfirm(true)}>
          <RefreshCw aria-hidden />
          Regenerate
        </Button>
      </p>

      <Dialog open={confirm} onOpenChange={(open) => !busy && setConfirm(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Write this resume again?</DialogTitle>
            <DialogDescription>
              It is matched against your career record again and written as a new version of this resume. What you have now stays in the version history, and what you told it you have is remembered.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={busy !== null} onClick={() => setConfirm(false)}>
              Cancel
            </Button>
            <Button loading={busy === "start"} onClick={regenerate}>
              Regenerate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
