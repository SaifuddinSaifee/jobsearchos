"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Trash2 } from "lucide-react";
import { useTransition } from "react";
import {
  Controller,
  useFieldArray,
  useForm,
  type Control,
  type FieldPath,
  type UseFormRegister,
} from "react-hook-form";
import { toast } from "sonner";
import { saveProfileAction } from "@/app/(app)/profile/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ProfileSchema, type Profile } from "@/lib/profile/schema";
import { LinesField, TagsField } from "./fields";

type Props = {
  initial: Profile;
  baseResumeFileId?: string | null;
  changeNote?: string;
  onSaved?: () => void;
};

function Text({
  label,
  name,
  register,
  className,
}: {
  label: string;
  name: FieldPath<Profile>;
  register: UseFormRegister<Profile>;
  className?: string;
}) {
  return (
    <div className={`space-y-1.5 ${className ?? ""}`}>
      <Label>{label}</Label>
      <Input {...register(name)} />
    </div>
  );
}

function Section({
  title,
  onAdd,
  addLabel,
  children,
}: {
  title: string;
  onAdd?: () => void;
  addLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{title}</h2>
        {onAdd && (
          <Button type="button" variant="outline" size="sm" onClick={onAdd}>
            <Plus /> {addLabel ?? "Add"}
          </Button>
        )}
      </div>
      {children}
    </section>
  );
}

function ItemCard({
  title,
  onRemove,
  children,
}: {
  title: string;
  onRemove: () => void;
  children: React.ReactNode;
}) {
  return (
    <Card size="sm" className="animate-in fade-in slide-in-from-top-1 duration-200 motion-reduce:animate-none">
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="text-sm">{title}</CardTitle>
        <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${title}`} onClick={onRemove}>
          <Trash2 />
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">{children}</CardContent>
    </Card>
  );
}

function Lines({
  control,
  name,
  label,
  rows,
}: {
  control: Control<Profile>;
  name: FieldPath<Profile>;
  label: string;
  rows?: number;
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <LinesField label={label} rows={rows} value={field.value as string[]} onChange={field.onChange} />
      )}
    />
  );
}

function Tags({
  control,
  name,
  label,
}: {
  control: Control<Profile>;
  name: FieldPath<Profile>;
  label: string;
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <TagsField label={label} value={field.value as string[]} onChange={field.onChange} />
      )}
    />
  );
}

export function ProfileEditor({ initial, baseResumeFileId, changeNote, onSaved }: Props) {
  const [pending, startTransition] = useTransition();
  const { control, register, handleSubmit } = useForm<Profile>({
    resolver: zodResolver(ProfileSchema),
    defaultValues: initial,
  });

  const experience = useFieldArray({ control, name: "experience" });
  const skills = useFieldArray({ control, name: "skills" });
  const projects = useFieldArray({ control, name: "projects" });
  const education = useFieldArray({ control, name: "education" });
  const certifications = useFieldArray({ control, name: "certifications" });

  const onSubmit = handleSubmit((values) =>
    startTransition(async () => {
      const result = await saveProfileAction(values, baseResumeFileId, changeNote);
      if (result.ok) {
        toast.success(`Saved as version ${result.version}`);
        onSaved?.();
      } else {
        toast.error(result.error);
      }
    }),
  );

  return (
    <form onSubmit={onSubmit} className="space-y-8">
      <Section title="Contact">
        <div className="grid gap-3 sm:grid-cols-2">
          <Text label="Name" name="contact.name" register={register} />
          <Text label="Email" name="contact.email" register={register} />
          <Text label="Phone" name="contact.phone" register={register} />
          <Text label="Location" name="contact.location" register={register} />
        </div>
        <Lines control={control} name="contact.links" label="Links (LinkedIn, GitHub, portfolio)" rows={3} />
      </Section>

      <Section title="Summary">
        <Textarea rows={4} {...register("summary")} />
      </Section>

      <Section
        title="Experience"
        addLabel="Add role"
        onAdd={() =>
          experience.append({
            company: "",
            title: "",
            location: "",
            start: "",
            end: "",
            current: false,
            bullets: [],
          })
        }
      >
        {experience.fields.map((f, i) => (
          <ItemCard
            key={f.id}
            title={`Role ${i + 1}`}
            onRemove={() => experience.remove(i)}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Text label="Title" name={`experience.${i}.title`} register={register} />
              <Text label="Company" name={`experience.${i}.company`} register={register} />
              <Text label="Location" name={`experience.${i}.location`} register={register} />
              <div className="grid grid-cols-2 gap-3">
                <Text label="Start" name={`experience.${i}.start`} register={register} />
                <Text label="End" name={`experience.${i}.end`} register={register} />
              </div>
            </div>
            <Controller
              control={control}
              name={`experience.${i}.current`}
              render={({ field }) => (
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                  Current role
                </label>
              )}
            />
            <Lines control={control} name={`experience.${i}.bullets`} label="Bullets" rows={5} />
          </ItemCard>
        ))}
      </Section>

      <Section
        title="Skills"
        addLabel="Add category"
        onAdd={() => skills.append({ category: "", items: [] })}
      >
        {skills.fields.map((f, i) => (
          <ItemCard key={f.id} title={`Category ${i + 1}`} onRemove={() => skills.remove(i)}>
            <Text label="Category" name={`skills.${i}.category`} register={register} />
            <Tags control={control} name={`skills.${i}.items`} label="Skills" />
          </ItemCard>
        ))}
      </Section>

      <Section title="Technologies">
        <Tags control={control} name="technologies" label="All tools, languages and frameworks" />
      </Section>

      <Section
        title="Projects"
        addLabel="Add project"
        onAdd={() =>
          projects.append({ name: "", description: "", technologies: [], bullets: [], url: "" })
        }
      >
        {projects.fields.map((f, i) => (
          <ItemCard key={f.id} title={`Project ${i + 1}`} onRemove={() => projects.remove(i)}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Text label="Name" name={`projects.${i}.name`} register={register} />
              <Text label="URL" name={`projects.${i}.url`} register={register} />
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Textarea rows={2} {...register(`projects.${i}.description`)} />
            </div>
            <Tags control={control} name={`projects.${i}.technologies`} label="Technologies" />
            <Lines control={control} name={`projects.${i}.bullets`} label="Bullets" rows={3} />
          </ItemCard>
        ))}
      </Section>

      <Section
        title="Education"
        addLabel="Add education"
        onAdd={() =>
          education.append({
            institution: "",
            degree: "",
            field: "",
            start: "",
            end: "",
            details: "",
          })
        }
      >
        {education.fields.map((f, i) => (
          <ItemCard key={f.id} title={`Education ${i + 1}`} onRemove={() => education.remove(i)}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Text label="Institution" name={`education.${i}.institution`} register={register} />
              <Text label="Degree" name={`education.${i}.degree`} register={register} />
              <Text label="Field" name={`education.${i}.field`} register={register} />
              <div className="grid grid-cols-2 gap-3">
                <Text label="Start" name={`education.${i}.start`} register={register} />
                <Text label="End" name={`education.${i}.end`} register={register} />
              </div>
            </div>
            <Text label="Details" name={`education.${i}.details`} register={register} />
          </ItemCard>
        ))}
      </Section>

      <Section
        title="Certifications"
        addLabel="Add certification"
        onAdd={() => certifications.append({ name: "", issuer: "", date: "" })}
      >
        {certifications.fields.map((f, i) => (
          <ItemCard
            key={f.id}
            title={`Certification ${i + 1}`}
            onRemove={() => certifications.remove(i)}
          >
            <div className="grid gap-3 sm:grid-cols-3">
              <Text label="Name" name={`certifications.${i}.name`} register={register} />
              <Text label="Issuer" name={`certifications.${i}.issuer`} register={register} />
              <Text label="Date" name={`certifications.${i}.date`} register={register} />
            </div>
          </ItemCard>
        ))}
      </Section>

      <Section title="Achievements">
        <Lines control={control} name="achievements" label="Achievements" rows={4} />
      </Section>

      <div className="sticky bottom-0 -mx-6 border-t bg-background/90 px-6 py-3 backdrop-blur">
        <Button type="submit" loading={pending}>
          {pending ? "Saving..." : "Save profile"}
        </Button>
      </div>
    </form>
  );
}
