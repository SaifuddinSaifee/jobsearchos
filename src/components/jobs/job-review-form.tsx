"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { saveJobAction } from "@/app/(app)/new/actions";
import { LinesField, TagsField } from "@/components/profile/fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { draftToMarkdownJob } from "@/lib/jobs/markdown";
import { JobDraftSchema, REMOTE_TYPES, type JobDraft } from "@/lib/jobs/schema";
import { MarkdownButtons, toMarkdownFile } from "./markdown-actions";

function Text({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}

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
  const { register, control, handleSubmit, formState } = form;

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

  const err = (name: keyof JobDraft) =>
    formState.errors[name] && <p className="text-xs text-destructive">Required or invalid</p>;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_24rem]">
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Text label="Company" htmlFor="f-company">
            <Input id="f-company" {...register("company")} />
            {err("company")}
          </Text>
          <Text label="Title" htmlFor="f-title">
            <Input id="f-title" {...register("title")} />
            {err("title")}
          </Text>
          <Text label="Location" htmlFor="f-location">
            <Input id="f-location" {...register("location")} />
          </Text>
          <Text label="Remote type" htmlFor="f-remoteType">
            <select id="f-remoteType" {...register("remoteType")}
              className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
            >
              {REMOTE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </Text>
          <Text label="Employment type" htmlFor="f-employmentType">
            <Input id="f-employmentType" {...register("employmentType")} />
          </Text>
          <Text label="Posted (YYYY-MM-DD)" htmlFor="f-postedAt">
            <Input id="f-postedAt" {...register("postedAt")} />
          </Text>
          <Text label="Salary min" htmlFor="f-salaryMin">
            <Input id="f-salaryMin" {...register("salaryMin", { setValueAs: (v) => (v === "" || v == null ? null : Number(v)) })} />
          </Text>
          <Text label="Salary max" htmlFor="f-salaryMax">
            <Input id="f-salaryMax" {...register("salaryMax", { setValueAs: (v) => (v === "" || v == null ? null : Number(v)) })} />
          </Text>
          <Text label="Currency" htmlFor="f-salaryCurrency">
            <Input id="f-salaryCurrency" {...register("salaryCurrency")} placeholder="USD" />
          </Text>
          <Text label="Period" htmlFor="f-salaryPeriod">
            <Input id="f-salaryPeriod" {...register("salaryPeriod")} placeholder="year / month / hour" />
          </Text>
        </div>
        <Text label="Application URL" htmlFor="f-applicationUrl">
            <Input id="f-applicationUrl" {...register("applicationUrl")} />
        </Text>

        <Controller
          control={control}
          name="responsibilities"
          render={({ field }) => (
            <LinesField label="Responsibilities" rows={6} value={field.value} onChange={field.onChange} />
          )}
        />
        <Controller
          control={control}
          name="requirements.required"
          render={({ field }) => (
            <LinesField label="Required qualifications" rows={6} value={field.value} onChange={field.onChange} />
          )}
        />
        <Controller
          control={control}
          name="requirements.preferred"
          render={({ field }) => (
            <LinesField label="Preferred qualifications" rows={4} value={field.value} onChange={field.onChange} />
          )}
        />
        <Controller
          control={control}
          name="technologies"
          render={({ field }) => <TagsField label="Technologies" value={field.value} onChange={field.onChange} />}
        />
        <Controller
          control={control}
          name="keywords"
          render={({ field }) => (
            <TagsField label="Keywords" value={field.value} onChange={field.onChange} hint="Used to find similar past resumes. Separate with commas." />
          )}
        />

        <div className="space-y-1.5">
          <Label htmlFor="aboutCompany">About the company (as written in the posting)</Label>
          <Textarea id="aboutCompany" rows={5} {...register("aboutCompany")} placeholder="Nothing about the employer was found in the posting." />
        </div>

        {(initial.companyNote || initial.companyResearch) && (
          <div className="space-y-2 rounded-lg border bg-muted/30 p-3 text-sm">
            <div className="font-medium">Company profile</div>
            {initial.companyNote && <p className="text-muted-foreground">{initial.companyNote}</p>}
            {initial.companyResearch && (
              <details>
                <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
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
          <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
            Already saved: <strong>{duplicate.title}</strong> at <strong>{duplicate.company}</strong>.{" "}
            <Link href="/jobs" className="underline">
              View in Jobs
            </Link>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button type="submit" disabled={pending}>
            {pending && <Loader2 className="animate-spin" />}
            Save job
          </Button>
          {/* Uses the form's current values, so edits you make above are included. */}
          <MarkdownButtons build={() => toMarkdownFile(draftToMarkdownJob({ ...initial, ...form.getValues() }))} />
        </div>
      </form>

      <aside className="lg:sticky lg:top-4 lg:self-start">
        <h3 className="mb-2 text-sm font-medium">Source text</h3>
        <ScrollArea className="h-[70vh] rounded-lg border">
          <pre className="whitespace-pre-wrap p-3 text-xs">{initial.rawText}</pre>
        </ScrollArea>
      </aside>
    </div>
  );
}
