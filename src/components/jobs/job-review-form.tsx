"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm, type UseFormReturn } from "react-hook-form";
import { toast } from "sonner";
import { saveJobAction } from "@/app/(app)/new/actions";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { draftToMarkdownJob } from "@/lib/jobs/markdown";
import { JobDraftSchema, type JobDraft, type JobExtraction } from "@/lib/jobs/schema";
import { JobFields } from "./job-fields";
import { MarkdownButtons, toMarkdownFile } from "./markdown-actions";

export function JobReviewForm({
  initial,
  queueId,
  onSaved,
}: {
  initial: JobDraft;
  /** Set when the draft came from the queue, so saving also resolves that queue item. */
  queueId?: string;
  /** Called after a successful save instead of going to the Jobs page. */
  onSaved?: (jobId: string) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [duplicate, setDuplicate] = useState<{ id: string; company: string; title: string } | null>(null);
  const form = useForm<JobDraft>({ resolver: zodResolver(JobDraftSchema), defaultValues: initial });
  const { handleSubmit } = form;

  const submit = handleSubmit(
    (values) =>
      startTransition(async () => {
        const res = await saveJobAction(values, queueId);
        if (res.ok) {
          if (onSaved) onSaved(res.jobId);
          else {
            toast.success("Job saved");
            router.push("/jobs");
          }
        } else if (res.duplicate) {
          setDuplicate(res.duplicate);
        } else {
          toast.error(res.error);
        }
      }),
    () => toast.error("Fix the highlighted fields first"),
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_24rem]">
      <form onSubmit={submit} className="space-y-4">
        {/* JobDraft extends JobExtraction, so the shared fields can drive this form. */}
        <JobFields form={form as unknown as UseFormReturn<JobExtraction>} />

        {(initial.companyNote || initial.companyResearch) && (
          <div className="space-y-2 rounded-lg border bg-muted/30 p-3 text-sm">
            <div className="font-medium">Company profile</div>
            {initial.companyNote && <p className="text-muted-foreground">{initial.companyNote}</p>}
            {initial.companyResearch && (
              <details>
                <summary className="text-muted-foreground hover:text-foreground">
                  Preview what the research found
                </summary>
                <div className="mt-2 space-y-2">
                  {[
                    ["What they do", initial.companyResearch.about],
                    ["Mission, values and principles", initial.companyResearch.principles],
                    ["Culture", initial.companyResearch.culture],
                  ]
                    .filter(([, t]) => t)
                    .map(([h, t]) => (
                      <div key={h}>
                        <div className="text-xs font-medium">{h}</div>
                        <p className="whitespace-pre-wrap">{t}</p>
                      </div>
                    ))}
                  <ul className="text-xs text-muted-foreground">
                    {(initial.companyResearch.log?.pages ?? initial.companyResearch.sources).map((src) => (
                      <li key={src.url}>
                        {src.title}
                        {src.kind ? ` (${src.kind === "owned" ? "company-owned" : "third-party"})` : ""}
                      </li>
                    ))}
                  </ul>
                  {initial.companyResearch.log && initial.companyResearch.log.queries.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      Searched: {initial.companyResearch.log.queries.join("; ")}
                    </p>
                  )}
                </div>
              </details>
            )}
          </div>
        )}

        {duplicate && (
          <div role="alert" className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm animate-in fade-in slide-in-from-bottom-1 duration-300 motion-reduce:animate-none">
            Already saved: <strong>{duplicate.title}</strong> at <strong>{duplicate.company}</strong>.{" "}
            <Link href="/jobs" className="underline">
              View in Jobs
            </Link>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button type="submit" loading={pending}>
            Save job
          </Button>
          {/* Uses the form's current values, so edits you make above are included. */}
          <MarkdownButtons build={() => toMarkdownFile(draftToMarkdownJob({ ...initial, ...form.getValues() }))} />
        </div>
      </form>

      <aside className="lg:sticky lg:top-16 lg:self-start">
        <h3 className="mb-2 text-sm font-medium">Source text</h3>
        <ScrollArea className="h-[70vh] rounded-lg border">
          <pre className="whitespace-pre-wrap p-3 text-xs">{initial.rawText}</pre>
        </ScrollArea>
      </aside>
    </div>
  );
}
