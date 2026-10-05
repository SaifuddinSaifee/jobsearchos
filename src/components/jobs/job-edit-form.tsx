"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Save } from "lucide-react";
import { useEffect, useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { updateJobAction } from "@/app/(app)/jobs/actions";
import { Button } from "@/components/ui/button";
import { JobEditSchema, REMOTE_TYPES, type JobEdit } from "@/lib/jobs/schema";
import type { DeletedState, JobDetail } from "@/lib/jobs/types";
import { JobFields } from "./job-fields";

function toEdit(d: JobDetail): JobEdit {
  return {
    company: d.company,
    title: d.title,
    location: d.location,
    remoteType: (REMOTE_TYPES as readonly string[]).includes(d.remoteType)
      ? (d.remoteType as JobEdit["remoteType"])
      : "unknown",
    employmentType: d.employmentType ?? "",
    salaryMin: d.salaryMin,
    salaryMax: d.salaryMax,
    salaryCurrency: d.salaryCurrency ?? "",
    salaryPeriod: d.salaryPeriod ?? "",
    postedAt: d.postedAt ?? "",
    applicationUrl: d.applyUrl ?? "",
    aboutCompany: d.aboutCompany,
    responsibilities: d.responsibilities,
    requirements: d.requirements,
    technologies: d.technologies,
    keywords: d.keywords,
  };
}

/** Edits a saved job in place. The original fetched posting (snapshot) is never changed. */
export function JobEditForm({
  detail,
  onCancel,
  onSaved,
  onDirty,
}: {
  detail: JobDetail;
  onCancel: () => void;
  onSaved: (removedCompanies: DeletedState["companies"]) => void;
  onDirty: (dirty: boolean) => void;
}) {
  const [pending, startTransition] = useTransition();
  const form = useForm<JobEdit>({ resolver: zodResolver(JobEditSchema), defaultValues: toEdit(detail) });
  const dirty = form.formState.isDirty;

  // Lets the table warn before closing or moving to another job with unsaved edits.
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);

  const submit = form.handleSubmit(
    (values) =>
      startTransition(async () => {
        const res = await updateJobAction(detail.jobId, values);
        if (!res.ok) return void toast.error(res.error);
        onDirty(false);
        onSaved(res.removedCompanies);
      }),
    () => toast.error("Fix the highlighted fields first"),
  );

  return (
    <form
      onSubmit={submit}
      className="space-y-4 border-t px-6 py-4 animate-in fade-in slide-in-from-bottom-1 duration-200 motion-reduce:animate-none"
    >
      <p className="text-sm text-muted-foreground">
        Changing the company links this job to that company. The original posting text is kept as it was fetched.
      </p>
      <JobFields form={form} />
      <div className="sticky bottom-0 -mx-6 flex items-center justify-end gap-2 border-t bg-background/95 px-6 py-3 backdrop-blur">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" loading={pending} disabled={!dirty}>
          <Save />
          Save changes
        </Button>
      </div>
    </form>
  );
}
