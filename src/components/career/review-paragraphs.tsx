"use client";

import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { NativeSelect } from "@/components/ui/native-select";
import type { ResolvedParagraph } from "@/lib/career/apply";
import type { ParagraphChoice } from "@/lib/career/proposal-schema";
import { roleChoices } from "@/lib/career/role-choices";
import type { CareerRecord } from "@/lib/career/schema";
import { cn } from "@/lib/utils";
import { IncludeToggle } from "./include-toggle";
import type { Decide } from "./review-employer";

const clip = (text: string, n = 70) => (text.length > n ? `${text.slice(0, n - 3)}...` : text);

/** The paragraphs of a cover letter: what each one is, and where it goes. Boilerplate is skipped. */
export function ParagraphGroup({ items, record, decide }: { items: ResolvedParagraph[]; record: CareerRecord; decide: Decide }) {
  if (items.length === 0) return null;
  const roles = roleChoices(record, 500);
  return (
    <section className="space-y-2 rounded-lg border p-4 animate-in fade-in slide-in-from-bottom-1 duration-300 motion-reduce:animate-none">
      <h3 className="text-sm font-semibold">
        Cover letter paragraphs <span className="font-normal text-muted-foreground tabular-nums">{items.length}</span>
      </h3>
      <p className="text-xs text-muted-foreground">
        A story about a job goes under that role in your record. A reason for applying is kept on its own. Greetings and sign-offs are skipped.
      </p>
      <ul className="space-y-2">
        {items.map((p) => (
          <ParagraphCard key={p.item.key} resolved={p} roles={roles} record={record} decide={decide} />
        ))}
      </ul>
    </section>
  );
}

function ParagraphCard({
  resolved,
  roles,
  record,
  decide,
}: {
  resolved: ResolvedParagraph;
  roles: { id: string; label: string }[];
  record: CareerRecord;
  decide: Decide;
}) {
  const { item, choice, included } = resolved;
  const skipped = choice.kind === "boilerplate";
  const role = choice.roleId ? record.employers.flatMap((e) => e.roles).find((r) => r.id === choice.roleId) : undefined;
  const change = (patch: Partial<ParagraphChoice>) => decide(item.key, { paragraph: { ...choice, ...patch } });

  return (
    <li className={cn("space-y-2 rounded-md bg-muted/30 p-3 text-sm transition-opacity duration-200", !included && "opacity-60")}>
      <div className="flex items-start gap-2">
        <IncludeToggle included={included} disabled={skipped} onChange={(v) => decide(item.key, { include: v })} label={clip(item.text, 40)} />
        <p className={cn("min-w-0 flex-1 whitespace-pre-wrap", !included && "text-muted-foreground")}>{item.text}</p>
        {skipped && <Badge variant="outline">Skipped</Badge>}
      </div>
      {item.removedBefore && <p className="pl-8 text-xs text-muted-foreground">You removed this before, so it starts out left out.</p>}

      <div className="grid gap-2 pl-8 sm:grid-cols-2">
        <label className="space-y-1 text-xs text-muted-foreground">
          This is
          <NativeSelect
            size="sm"
            value={choice.kind}
            onChange={(e) => {
              const kind = e.target.value as ParagraphChoice["kind"];
              change({ kind, roleId: kind === "story" ? choice.roleId : null, factId: null });
            }}
          >
            <option value="story">A story about a job</option>
            <option value="motivation_company">{item.companyName ? `A reason for applying to ${item.companyName}` : "A reason for applying (company unknown)"}</option>
            <option value="motivation_general">A general reason for this kind of work</option>
            <option value="boilerplate">Skip it (greeting, sign-off, filler)</option>
          </NativeSelect>
        </label>

        {choice.kind === "story" && (
          <label className="space-y-1 text-xs text-muted-foreground">
            About the role
            <NativeSelect size="sm" value={choice.roleId ?? ""} onChange={(e) => change({ roleId: e.target.value || null, factId: null })}>
              <option value="">Pick a role</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {clip(r.label, 80)}
                </option>
              ))}
            </NativeSelect>
          </label>
        )}

        {choice.kind === "story" && role && (
          <label className="space-y-1 text-xs text-muted-foreground sm:col-span-2">
            Which fact is it
            <NativeSelect size="sm" value={choice.factId ?? ""} onChange={(e) => change({ factId: e.target.value || null })}>
              <option value="">A new fact</option>
              {role.facts.map((f) => (
                <option key={f.id} value={f.id}>
                  Same as: {clip(f.wordings[0]?.text ?? "", 90)}
                </option>
              ))}
            </NativeSelect>
          </label>
        )}
      </div>

      {choice.kind === "story" && !choice.roleId && (
        <p className="flex items-start gap-1.5 pl-8 text-xs">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          Pick the role this story is about, or it is left out.
        </p>
      )}
      {choice.kind === "motivation_company" && !item.companyName && (
        <p className="flex items-start gap-1.5 pl-8 text-xs">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          This letter is not linked to a company, so the reason is kept without one.
        </p>
      )}
    </li>
  );
}
