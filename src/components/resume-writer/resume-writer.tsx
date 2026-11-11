"use client";

import { ArrowLeft, ArrowRight, CircleAlert, FileText, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { statusInfo, type ApplicationStatus } from "@/lib/jobs/status";
import { isGenerationOpen, isGenerationWorking, NO_SOURCE_MESSAGE, type GenerationItem, type JobResumeState } from "@/lib/resume-writer/types";
import { cn } from "@/lib/utils";
import { RequirementReview } from "./requirement-review";
import { ResumeProgress, StepList } from "./resume-progress";
import { useJobResume } from "./use-job-resume";
import { useResumeActions } from "./use-resume-actions";

type JobHead = { id: string; title: string; company: string; location: string; status: ApplicationStatus };

/**
 * Writing a resume for a job, from asking for it to opening it in the editor: the start, the progress, the review of
 * what the job asks for, and what to do when it ends. It survives a reload and a trip away, because the work happens in
 * the background and this page only shows where it is.
 */
export function ResumeWriter({ job, initial }: { job: JobHead; initial: JobResumeState }) {
  const router = useRouter();
  const { data } = useJobResume(job.id, initial);
  const actions = useResumeActions(job.id);
  const state = data ?? initial;
  const g = state.generation;
  const status = statusInfo(job.status);

  // Having watched it being made, go straight to the finished resume; arriving at one that was already finished does not.
  const watched = useRef(false);
  useEffect(() => {
    if (isGenerationWorking(g)) watched.current = true;
    else if (g?.status === "done" && g.documentId && watched.current) router.push(`/library/${g.documentId}`);
  }, [g, router]);

  return (
    <div className="space-y-6 animate-in fade-in duration-200 motion-reduce:animate-none">
      <header className="flex flex-wrap items-start gap-x-4 gap-y-3">
        <Link href={`/jobs?job=${job.id}`} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
          <ArrowLeft /> Back to job
        </Link>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg leading-snug font-semibold">{job.title}</h2>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{job.company}</span>
            {job.location && <span>{job.location}</span>}
            <Badge variant="ghost" className={status.tone}>
              {status.label}
            </Badge>
          </p>
        </div>
      </header>

      <div key={g && isGenerationOpen(g) ? g.status : (g?.status ?? "none")} className="animate-in fade-in duration-200 motion-reduce:animate-none">
        {g && (g.status === "queued" || g.status === "matching") ? (
          <ResumeProgress generation={g} title="Matching what the job asks for against your record" stopping={actions.busy === "stop"} onStop={() => actions.stop(g.id)} />
        ) : g && g.status === "review" ? (
          <RequirementReview generation={g} submitting={actions.busy === "review"} onSubmit={(answers, skip, choices) => actions.submitReview(g.id, answers, skip, choices)} />
        ) : g && (g.status === "writing_queued" || g.status === "writing") ? (
          <ResumeProgress generation={g} title="Writing your resume" stopping={actions.busy === "stop"} onStop={() => actions.stop(g.id)} />
        ) : g?.status === "failed" ? (
          <Ended
            tone="error"
            title="The resume could not be written"
            detail={g.error ?? "Something went wrong."}
            timing={g}
            actions={
              <>
                {g.error === NO_SOURCE_MESSAGE && (
                  <Link href="/library" className={cn(buttonVariants({ size: "sm" }))}>
                    Go to the Library
                  </Link>
                )}
                <Button size="sm" variant={g.error === NO_SOURCE_MESSAGE ? "outline" : "default"} loading={actions.busy === "start"} onClick={() => actions.start({ regenerate: !!state.documentId })}>
                  Try again
                </Button>
                {state.documentId && <OpenResume id={state.documentId} label="Open the earlier resume" />}
              </>
            }
          />
        ) : g?.status === "stopped" && !state.documentId ? (
          <Ended
            title="Stopped"
            detail="Nothing was saved."
            timing={g}
            actions={
              <Button size="sm" loading={actions.busy === "start"} onClick={() => actions.start()}>
                <Sparkles aria-hidden />
                Generate resume
              </Button>
            }
          />
        ) : state.documentId ? (
          <Ended
            title="Your resume is ready"
            detail={g?.notes.length ? undefined : "It is saved in your Library, linked to this job."}
            notes={g?.notes}
            timing={g?.status === "done" ? g : undefined}
            actions={<OpenResume id={state.documentId} label="Open resume" primary />}
          />
        ) : (
          <Ended
            title="Write a resume for this job"
            detail="It lines up what the job asks for against your career record, shows you the match, then writes a one-page resume you can edit, download or attach to an email."
            actions={
              <Button size="sm" loading={actions.busy === "start"} onClick={() => actions.start()}>
                <Sparkles aria-hidden />
                Generate resume
              </Button>
            }
          />
        )}
      </div>
    </div>
  );
}

function OpenResume({ id, label, primary }: { id: string; label: string; primary?: boolean }) {
  return (
    <Link href={`/library/${id}`} className={cn(buttonVariants({ size: "sm", variant: primary ? "default" : "outline" }))}>
      <FileText aria-hidden />
      {label}
      <ArrowRight aria-hidden />
    </Link>
  );
}

function Ended({
  title,
  detail,
  notes,
  tone,
  timing,
  actions,
}: {
  title: string;
  detail?: string;
  notes?: string[];
  tone?: "error";
  /** The generation whose steps and times to show, once it has ended. */
  timing?: GenerationItem;
  actions: React.ReactNode;
}) {
  return (
    <div className={cn("space-y-3 rounded-xl border bg-card p-5", tone === "error" && "border-destructive/30 bg-destructive/5")}>
      <h3 className="flex items-center gap-2 text-base font-medium">
        {tone === "error" && <CircleAlert className="size-4 text-destructive" aria-hidden />}
        {title}
      </h3>
      {detail && <p className="max-w-xl text-sm text-muted-foreground">{detail}</p>}
      {notes?.map((n) => (
        <p key={n} className="max-w-xl text-sm text-muted-foreground">
          {n}
        </p>
      ))}
      {timing && Object.keys(timing.steps).length > 0 && (
        <div className="max-w-xl rounded-lg border bg-background/60 p-3 text-sm">
          <StepList generation={timing} live={false} />
        </div>
      )}
      <div className="flex flex-wrap gap-2">{actions}</div>
    </div>
  );
}
