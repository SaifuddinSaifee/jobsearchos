"use client";

import { Controller, type UseFormReturn } from "react-hook-form";
import { LinesField, TagsField } from "@/components/profile/fields";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { REMOTE_TYPES, type JobExtraction } from "@/lib/jobs/schema";

function Text({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}

const toNumber = (v: unknown) => (v === "" || v == null ? null : Number(v));

/** The editable fields of a job, shared by the review form (new jobs) and the edit form (saved jobs). */
export function JobFields({ form }: { form: UseFormReturn<JobExtraction> }) {
  const { register, control, formState } = form;

  const err = (name: "company" | "title" | "salaryMin" | "salaryMax") =>
    formState.errors[name] && (
      <p className="text-xs text-destructive animate-in fade-in slide-in-from-top-1 duration-200 motion-reduce:animate-none">
        {name.startsWith("salary") ? "Enter a number" : formState.errors[name]?.message || "Required"}
      </p>
    );

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Text label="Company" htmlFor="f-company">
          <Input id="f-company" aria-invalid={Boolean(formState.errors.company)} {...register("company")} />
          {err("company")}
        </Text>
        <Text label="Title" htmlFor="f-title">
          <Input id="f-title" aria-invalid={Boolean(formState.errors.title)} {...register("title")} />
          {err("title")}
        </Text>
        <Text label="Location" htmlFor="f-location">
          <Input id="f-location" {...register("location")} />
        </Text>
        <Text label="Remote type" htmlFor="f-remoteType">
          <NativeSelect id="f-remoteType" {...register("remoteType")}>
            {REMOTE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </NativeSelect>
        </Text>
        <Text label="Employment type" htmlFor="f-employmentType">
          <Input id="f-employmentType" {...register("employmentType")} />
        </Text>
        <Text label="Posted (YYYY-MM-DD)" htmlFor="f-postedAt">
          <Input id="f-postedAt" {...register("postedAt")} />
        </Text>
        <Text label="Salary min" htmlFor="f-salaryMin">
          <Input id="f-salaryMin" inputMode="numeric" {...register("salaryMin", { setValueAs: toNumber })} />
          {err("salaryMin")}
        </Text>
        <Text label="Salary max" htmlFor="f-salaryMax">
          <Input id="f-salaryMax" inputMode="numeric" {...register("salaryMax", { setValueAs: toNumber })} />
          {err("salaryMax")}
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
          <TagsField
            label="Keywords"
            value={field.value}
            onChange={field.onChange}
            hint="Used to find similar past resumes. Separate with commas."
          />
        )}
      />

      <div className="space-y-1.5">
        <Label htmlFor="aboutCompany">About the company (as written in the posting)</Label>
        <Textarea
          id="aboutCompany"
          rows={5}
          {...register("aboutCompany")}
          placeholder="Nothing about the employer was found in the posting."
        />
      </div>
    </>
  );
}
