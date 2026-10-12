"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTransition } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { savePreferencesAction } from "@/app/(app)/profile/actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { PreferencesSchema, REMOTE_MODES, type Preferences } from "@/lib/profile/schema";
import { TagsField } from "./fields";

const REMOTE_LABELS = { remote: "Remote", hybrid: "Hybrid", onsite: "On-site" } as const;

export function PreferencesForm({ initial }: { initial: Preferences }) {
  const [pending, startTransition] = useTransition();
  const { control, register, handleSubmit } = useForm<Preferences>({
    resolver: zodResolver(PreferencesSchema),
    defaultValues: initial,
  });

  const onSubmit = handleSubmit((values) =>
    startTransition(async () => {
      const result = await savePreferencesAction(values);
      if (result.ok) toast.success(`Saved as version ${result.version}`);
      else toast.error(result.error);
    }),
  );

  return (
    <form onSubmit={onSubmit} className="max-w-2xl space-y-5">
      <Controller
        control={control}
        name="targetRoles"
        render={({ field }) => (
          <TagsField label="Target roles" value={field.value} onChange={field.onChange} placeholder="Backend Engineer, Platform Engineer" />
        )}
      />
      <Controller
        control={control}
        name="locations"
        render={({ field }) => (
          <TagsField label="Locations" value={field.value} onChange={field.onChange} placeholder="Berlin, Remote (EU)" />
        )}
      />
      <Controller
        control={control}
        name="countries"
        render={({ field }) => (
          <TagsField label="Countries" value={field.value} onChange={field.onChange} placeholder="Germany, Netherlands" />
        )}
      />

      <div className="space-y-2">
        <Label>Work mode</Label>
        <Controller
          control={control}
          name="remoteModes"
          render={({ field }) => (
            <div className="flex gap-6">
              {REMOTE_MODES.map((mode) => (
                <label key={mode} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={field.value.includes(mode)}
                    onCheckedChange={(checked) =>
                      field.onChange(
                        checked ? [...field.value, mode] : field.value.filter((m) => m !== mode),
                      )
                    }
                  />
                  {REMOTE_LABELS[mode]}
                </label>
              ))}
            </div>
          )}
        />
      </div>

      <div className="grid grid-cols-[1fr_8rem] gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="minSalary">Minimum salary (per year)</Label>
          <Input
            id="minSalary"
            type="number"
            min={0}
            {...register("minSalary", {
              setValueAs: (v) => (v === "" || v == null ? null : Number(v)),
            })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="salaryCurrency">Currency</Label>
          <Input id="salaryCurrency" {...register("salaryCurrency")} />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Controller
          control={control}
          name="needsVisaSponsorship"
          render={({ field }) => (
            <Switch checked={field.value} onCheckedChange={field.onChange} id="visa" />
          )}
        />
        <Label htmlFor="visa">I need visa sponsorship</Label>
      </div>

      <Controller
        control={control}
        name="preferredTechnologies"
        render={({ field }) => (
          <TagsField label="Preferred technologies" value={field.value} onChange={field.onChange} placeholder="TypeScript, PostgreSQL, n8n" />
        )}
      />
      <Controller
        control={control}
        name="excludedRoles"
        render={({ field }) => (
          <TagsField label="Excluded roles" value={field.value} onChange={field.onChange} placeholder="Sales, Support" />
        )}
      />
      <Controller
        control={control}
        name="excludedCompanies"
        render={({ field }) => (
          <TagsField label="Excluded companies" value={field.value} onChange={field.onChange} />
        )}
      />

      <Button type="submit" loading={pending}>
        {pending ? "Saving..." : "Save preferences"}
      </Button>
    </form>
  );
}
