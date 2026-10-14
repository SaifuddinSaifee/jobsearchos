"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useTransition } from "react";
import { toast } from "sonner";
import { retryFailedAction } from "@/app/(app)/library/record/actions";
import { Button } from "@/components/ui/button";
import { parseFailure } from "@/lib/career/failure";
import type { CareerStatus } from "@/lib/career/review";
import { FailureDialog } from "./failure-dialog";
import { SkipButton } from "./skip-button";
import { CAREER_STATUS_KEY, useCareerStatus } from "./use-career-status";

/** Shown when no source is waiting for review: the next one is being prepared, something failed, or everything is done. */
export function PreparingNext({ initial }: { initial: CareerStatus }) {
  const router = useRouter();
  const client = useQueryClient();
  const { data } = useCareerStatus(initial);
  const status = data ?? initial;
  const [retrying, startRetry] = useTransition();

  const busy = status.counts.queued + status.counts.running > 0;
  const retry = () =>
    startRetry(async () => {
      const res = await retryFailedAction();
      if (!res.ok) toast.error(res.error);
      await client.invalidateQueries({ queryKey: CAREER_STATUS_KEY });
      router.refresh();
    });
  useEffect(() => {
    if (status.counts.ready > 0) router.refresh();
  }, [status.counts.ready, router]);

  return (
    <div className="space-y-4">
      <Link
        href="/library?tab=record"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Career record
      </Link>

      <div className="animate-in fade-in slide-in-from-bottom-1 rounded-lg border border-dashed p-8 text-center duration-300 motion-reduce:animate-none">
        {busy ? (
          <>
            <Loader2 className="mx-auto size-6 animate-spin text-muted-foreground" aria-hidden />
            <h2 className="mt-3 text-sm font-medium">Preparing the next source</h2>
            <p className="mt-1 text-sm text-muted-foreground" aria-live="polite">
              {status.current ? `Reading ${status.current.label}` : "It will appear here as soon as it is ready."} ({status.done} of {status.total} done)
            </p>
            {status.current?.status === "running" && <SkipButton className="mt-4" proposalId={status.current.id} ready={false} />}
          </>
        ) : status.counts.failed > 0 ? (
          <>
            <h2 className="text-sm font-medium">{status.counts.failed} could not be prepared</h2>
            <ul className="mx-auto mt-2 max-w-md space-y-1 text-sm text-muted-foreground">
              {status.failed.map((f) => (
                <li key={f.id}>
                  {f.label}: {parseFailure(f.error).message}
                </li>
              ))}
            </ul>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <FailureDialog failures={status.failed} retrying={retrying} onRetry={retry} />
              <Button loading={retrying} onClick={retry}>
                <RotateCcw aria-hidden />
                Try again
              </Button>
            </div>
          </>
        ) : (
          <>
            <h2 className="text-sm font-medium">Nothing is waiting for review</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {status.total > 0 ? `All ${status.total} sources are done.` : "Build your career record from the Library to start."}
            </p>
            <Button className="mt-4" variant="outline" nativeButton={false} render={<Link href="/library?tab=record" />}>
              Back to the career record
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
