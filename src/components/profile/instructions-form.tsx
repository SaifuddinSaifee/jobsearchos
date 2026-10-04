"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Trash2 } from "lucide-react";
import { useTransition } from "react";
import { Controller, useFieldArray, useForm } from "react-hook-form";
import { toast } from "sonner";
import { saveInstructionsAction } from "@/app/(app)/profile/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  GenerationInstructionsSchema,
  TONES,
  type GenerationInstructions,
} from "@/lib/profile/schema";

const optionalInt = (v: unknown) => (v === "" || v == null ? null : Number(v));

export function InstructionsForm({ initial }: { initial: GenerationInstructions }) {
  const [pending, startTransition] = useTransition();
  const { control, register, handleSubmit } = useForm<GenerationInstructions>({
    resolver: zodResolver(GenerationInstructionsSchema),
    defaultValues: initial,
  });
  const limits = useFieldArray({ control, name: "sectionLimits" });

  const onSubmit = handleSubmit((values) =>
    startTransition(async () => {
      const result = await saveInstructionsAction(values);
      if (result.ok) toast.success(`Saved as version ${result.version}`);
      else toast.error(result.error);
    }),
  );

  return (
    <form onSubmit={onSubmit} className="max-w-2xl space-y-5">
      <div className="space-y-1.5">
        <Label htmlFor="styleRules">Style rules</Label>
        <Textarea
          id="styleRules"
          rows={6}
          placeholder="e.g. Start bullets with strong verbs. Quantify impact. No first-person pronouns."
          {...register("styleRules")}
        />
      </div>

      <div className="space-y-2">
        <Label>Tone</Label>
        <Controller
          control={control}
          name="tone"
          render={({ field }) => (
            <div className="flex flex-wrap gap-2">
              {TONES.map((tone) => (
                <Button
                  key={tone}
                  type="button"
                  size="sm"
                  variant={field.value === tone ? "default" : "outline"}
                  onClick={() => field.onChange(tone)}
                >
                  {tone}
                </Button>
              ))}
            </div>
          )}
        />
      </div>

      <div className="space-y-2">
        <Label>Section limits</Label>
        <p className="text-xs text-muted-foreground">
          Keeps generated text short enough for your compact resume template.
        </p>
        {limits.fields.map((f, i) => (
          <div key={f.id} className="grid grid-cols-[1fr_7rem_7rem_auto] items-center gap-2">
            <Input placeholder="Section (e.g. Experience)" {...register(`sectionLimits.${i}.section`)} />
            <Input
              type="number"
              min={1}
              placeholder="Max bullets"
              {...register(`sectionLimits.${i}.maxBullets`, { setValueAs: optionalInt })}
            />
            <Input
              type="number"
              min={1}
              placeholder="Max chars"
              {...register(`sectionLimits.${i}.maxChars`, { setValueAs: optionalInt })}
            />
            <Button type="button" variant="ghost" size="icon" onClick={() => limits.remove(i)}>
              <Trash2 />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => limits.append({ section: "", maxBullets: null, maxChars: null })}
        >
          <Plus /> Add section limit
        </Button>
      </div>

      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save instructions"}
      </Button>
    </form>
  );
}
