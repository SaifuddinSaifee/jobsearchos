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
import { ScrollArea } from "@/components/ui/scroll-area";
import { JobDraftSchema, REMOTE_TYPES, type JobDraft } from "@/lib/jobs/schema";

function Text({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

export function JobReviewForm({ initial }: { initial: JobDraft }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [duplicate, setDuplicate] = useState<{ id: string; company: string; title: string } | null>(null);
  const form = useForm<JobDraft>({ resolver: zodResolver(JobDraftSchema), defaultValues: initial });
  const { register, control, handleSubmit, formState } = form;

  const submit = handleSubmit(
    (values) =>
      startTransition(async () => {
        const res = await saveJobAction(values);
        if (res.ok) {
          toast.success("Job saved");
          router.push("/jobs");
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
          <Text label="Company">
            <Input {...register("company")} />
            {err("company")}
          </Text>
          <Text label="Title">
            <Input {...register("title")} />
            {err("title")}
          </Text>
          <Text label="Location">
            <Input {...register("location")} />
          </Text>
          <Text label="Remote type">
            <select
              {...register("remoteType")}
              className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
            >
              {REMOTE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </Text>
          <Text label="Employment type">
            <Input {...register("employmentType")} />
          </Text>
          <Text label="Posted (YYYY-MM-DD)">
            <Input {...register("postedAt")} />
          </Text>
          <Text label="Salary min">
            <Input type="number" {...register("salaryMin", { setValueAs: (v) => (v === "" || v == null ? null : Number(v)) })} />
          </Text>
          <Text label="Salary max">
            <Input type="number" {...register("salaryMax", { setValueAs: (v) => (v === "" || v == null ? null : Number(v)) })} />
          </Text>
          <Text label="Currency">
            <Input {...register("salaryCurrency")} placeholder="USD" />
          </Text>
          <Text label="Period">
            <Input {...register("salaryPeriod")} placeholder="year / month / hour" />
          </Text>
        </div>
        <Text label="Application URL">
          <Input {...register("applicationUrl")} />
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

        {duplicate && (
          <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
            Already saved: <strong>{duplicate.title}</strong> at <strong>{duplicate.company}</strong>.{" "}
            <Link href="/jobs" className="underline">
              View in Jobs
            </Link>
          </div>
        )}

        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="animate-spin" />}
          Save job
        </Button>
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
