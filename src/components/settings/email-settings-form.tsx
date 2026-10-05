"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, X } from "lucide-react";
import { useTransition } from "react";
import { Controller, useFieldArray, useForm, type FieldError } from "react-hook-form";
import { toast } from "sonner";
import { saveColdEmailSettingsAction } from "@/app/(app)/settings/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ColdEmailSettingsSchema, WEEKDAYS, type ColdEmailSettings } from "@/lib/email/settings-schema";

const DAY_LABELS: Record<(typeof WEEKDAYS)[number], string> = {
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
  sun: "Sun",
};

const ANGLE_OPTIONS = [
  ["auto", "Let the writer choose"],
  ["proof_of_work", "Proof of work with their product"],
  ["value_offer", "Value-first offer"],
  ["question", "Sharp question or observation"],
  ["direct", "Plain direct intro"],
] as const;

const PROVIDER_ORDERS = [
  ["hunter,apollo", "Hunter, then Apollo"],
  ["apollo,hunter", "Apollo, then Hunter"],
  ["hunter", "Hunter only"],
  ["apollo", "Apollo only"],
] as const;

function Field({ label, htmlFor, hint, error, children }: { label: string; htmlFor?: string; hint?: string; error?: FieldError; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? <p className="text-xs text-destructive">{error.message}</p> : hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-start justify-between gap-4 text-sm">
      <span>
        <span className="font-medium">{label}</span>
        {hint ? <span className="block text-xs text-muted-foreground">{hint}</span> : null}
      </span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

export function EmailSettingsForm({ initial }: { initial: ColdEmailSettings }) {
  const [pending, startTransition] = useTransition();
  const {
    control,
    register,
    handleSubmit,
    formState: { errors, isDirty },
    reset,
  } = useForm<ColdEmailSettings>({ resolver: zodResolver(ColdEmailSettingsSchema), defaultValues: initial });
  const links = useFieldArray({ control, name: "links" });

  const onSubmit = handleSubmit((values) =>
    startTransition(async () => {
      const res = await saveColdEmailSettingsAction(values);
      if (res.ok) {
        reset(values);
        toast.success("Email settings saved");
      } else toast.error(res.error);
    }),
  );

  const num = { valueAsNumber: true } as const;

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Sending</CardTitle>
          <CardDescription>Guard rails for your Gmail reputation. Every send is still an explicit click.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Daily send limit" htmlFor="dailyCap" hint="Personalized emails per day. 20 to 30 is a safe range." error={errors.dailyCap}>
              <Input id="dailyCap" type="number" min={1} max={100} {...register("dailyCap", num)} />
            </Field>
            <Field label="Follow-up after (business days)" htmlFor="followUpBusinessDays" error={errors.followUpBusinessDays}>
              <Input id="followUpBusinessDays" type="number" min={1} max={30} {...register("followUpBusinessDays", num)} />
            </Field>
            <Field label="Follow-ups per contact" htmlFor="maxFollowUps" hint="One is usually enough; more reads as spam." error={errors.maxFollowUps}>
              <Input id="maxFollowUps" type="number" min={0} max={2} {...register("maxFollowUps", num)} />
            </Field>
          </div>

          <Field label="Send days" error={errors.sendDays as FieldError | undefined}>
            <Controller
              control={control}
              name="sendDays"
              render={({ field }) => (
                <div className="flex flex-wrap gap-2">
                  {WEEKDAYS.map((d) => {
                    const on = field.value.includes(d);
                    return (
                      <Button
                        key={d}
                        type="button"
                        size="sm"
                        variant={on ? "default" : "outline"}
                        aria-pressed={on}
                        onClick={() => field.onChange(on ? field.value.filter((x) => x !== d) : [...field.value, d])}
                      >
                        {DAY_LABELS[d]}
                      </Button>
                    );
                  })}
                </div>
              )}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Window starts" htmlFor="sendWindowStart" error={errors.sendWindowStart}>
              <Input id="sendWindowStart" type="time" {...register("sendWindowStart")} />
            </Field>
            <Field label="Window ends" htmlFor="sendWindowEnd" error={errors.sendWindowEnd}>
              <Input id="sendWindowEnd" type="time" {...register("sendWindowEnd")} />
            </Field>
          </div>

          <Controller control={control} name="useRecipientTimeZone" render={({ field }) => <Toggle label="Use the recipient's time zone" hint="Otherwise the window is in your own time zone." checked={field.value} onChange={field.onChange} />} />
          <Controller control={control} name="requireVerifiedAddress" render={({ field }) => <Toggle label="Only send to verified addresses" hint="Guessed addresses can bounce and hurt your sender reputation." checked={field.value} onChange={field.onChange} />} />
          <Controller control={control} name="bccSelf" render={({ field }) => <Toggle label="Bcc myself" hint="Keeps a copy of every email in your own inbox." checked={field.value} onChange={field.onChange} />} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Writing defaults</CardTitle>
          <CardDescription>What the cold-email writer starts from. See docs/cold-email.md for the reasoning.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Sender name" htmlFor="senderName" error={errors.senderName}>
              <Input id="senderName" placeholder="Your full name" {...register("senderName")} />
            </Field>
            <Field label="Sign-off name" htmlFor="signOff" hint="Usually your first name." error={errors.signOff}>
              <Input id="signOff" placeholder="Sam" {...register("signOff")} />
            </Field>
            <Field label="Fewest words" htmlFor="minWords" error={errors.minWords}>
              <Input id="minWords" type="number" min={20} max={300} {...register("minWords", num)} />
            </Field>
            <Field label="Most words" htmlFor="maxWords" error={errors.maxWords}>
              <Input id="maxWords" type="number" min={20} max={300} {...register("maxWords", num)} />
            </Field>
            <Field label="Follow-up, most words" htmlFor="followUpMaxWords" error={errors.followUpMaxWords}>
              <Input id="followUpMaxWords" type="number" min={10} max={200} {...register("followUpMaxWords", num)} />
            </Field>
            <Field label="Default angle" htmlFor="defaultAngle">
              <NativeSelect id="defaultAngle" {...register("defaultAngle")}>
                {ANGLE_OPTIONS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>

          <div className="space-y-2">
            <Label>Links in the sign-off</Label>
            <p className="text-xs text-muted-foreground">At most two (LinkedIn, GitHub or a portfolio). More links hurt deliverability.</p>
            {links.fields.map((f, i) => (
              <div key={f.id} className="grid grid-cols-[8rem_1fr_auto] items-start gap-2 animate-in fade-in slide-in-from-top-1 duration-200 motion-reduce:animate-none">
                <Input placeholder="LinkedIn" aria-label="Link label" {...register(`links.${i}.label`)} />
                <div className="space-y-1">
                  <Input placeholder="https://linkedin.com/in/..." aria-label="Link URL" {...register(`links.${i}.url`)} />
                  {errors.links?.[i]?.url ? <p className="text-xs text-destructive">Enter a full URL starting with https://</p> : null}
                </div>
                <Button type="button" variant="ghost" size="icon" aria-label="Remove link" onClick={() => links.remove(i)}>
                  <X />
                </Button>
              </div>
            ))}
            {errors.links?.root ? <p className="text-xs text-destructive">{errors.links.root.message}</p> : null}
            <Button type="button" variant="outline" size="sm" disabled={links.fields.length >= 2} onClick={() => links.append({ label: "", url: "" })}>
              <Plus /> Add link
            </Button>
          </div>

          <Field label="Extra banned phrases" htmlFor="extraBannedPhrases" hint="One per line, added to the built-in list. Emails containing them are flagged before sending.">
            <Controller
              control={control}
              name="extraBannedPhrases"
              render={({ field }) => (
                <Textarea
                  id="extraBannedPhrases"
                  rows={4}
                  defaultValue={field.value.join("\n")}
                  onChange={(e) => field.onChange(e.target.value.split("\n").map((l) => l.trim()).filter(Boolean))}
                />
              )}
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Contact finding</CardTitle>
          <CardDescription>How the app looks up the person to email.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label="Provider order" htmlFor="providerOrder">
            <Controller
              control={control}
              name="providerOrder"
              render={({ field }) => (
                <NativeSelect id="providerOrder" value={field.value.join(",")} onChange={(e) => field.onChange(e.target.value.split(","))}>
                  {PROVIDER_ORDERS.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </NativeSelect>
              )}
            />
          </Field>
          <Controller control={control} name="excludeGenericInboxes" render={({ field }) => <Toggle label="Skip shared inboxes" hint="Never suggest info@, careers@, jobs@ or hr@ addresses." checked={field.value} onChange={field.onChange} />} />
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button type="submit" loading={pending} disabled={!isDirty}>
          {pending ? "Saving..." : "Save email settings"}
        </Button>
        {isDirty ? (
          <Button type="button" variant="ghost" onClick={() => reset(initial)} disabled={pending}>
            Discard changes
          </Button>
        ) : null}
      </div>
    </form>
  );
}
