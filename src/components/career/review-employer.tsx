"use client";

import { AlertTriangle, ChevronDown, GitCompare } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapse } from "@/components/ui/collapse";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import type { DecisionPatch } from "@/lib/career/decisions";
import type { RoleSuggestion } from "@/lib/career/proposal-schema";
import type { ResolvedBullet, ResolvedEmployer, ResolvedRole } from "@/lib/career/apply";
import { formatDates } from "@/lib/career/dates";
import type { CareerRecord, Role } from "@/lib/career/schema";
import { cn } from "@/lib/utils";
import { IncludeToggle } from "./include-toggle";

export type Decide = (key: string, patch: DecisionPatch) => void;
/** Compares a role item's bullets with the role it was moved under. Resolves when the proposal has been updated. */
export type Regroup = (roleKey: string, target: RoleSuggestion) => Promise<void>;

const ENTER = "animate-in fade-in slide-in-from-bottom-1 duration-300 motion-reduce:animate-none";
const WHY: Record<string, string> = {
  lineage: "Same bullet as in an earlier document, edited.",
  near: "Same words, with different punctuation or case.",
  model: "Suggested as the same accomplishment.",
  user: "You chose this fact.",
};

const clip = (text: string, n = 90) => (text.length > n ? `${text.slice(0, n - 3)}...` : text);
const roleLabel = (r: Role) => `${r.framings[0]?.title || "Role"}, ${formatDates(r) || "no dates"}`;

export function EmployerCard({
  resolved,
  record,
  decide,
  setRoleBullets,
  regroup,
}: {
  resolved: ResolvedEmployer;
  record: CareerRecord;
  decide: Decide;
  setRoleBullets: (roleKey: string, include: boolean) => void;
  regroup: Regroup;
}) {
  const { item, target, included } = resolved;
  const existing = target.to === "existing" ? record.employers.find((e) => e.id === target.employerId) : undefined;
  return (
    <section className={cn("space-y-3 rounded-lg border p-4 transition-opacity duration-200", ENTER, !included && "opacity-60")}>
      <header className="flex flex-wrap items-center gap-2">
        <IncludeToggle included={included} onChange={(v) => decide(item.key, { include: v })} label={item.name} />
        <h3 className="text-sm font-semibold">{item.name}</h3>
        {existing ? <Badge variant="secondary">Matches {existing.name} in your record</Badge> : <Badge>New employer</Badge>}
        {item.removedBefore && <Badge variant="outline">You removed this before</Badge>}
        <NativeSelect
          size="sm"
          className="ml-auto w-56"
          aria-label={`Employer for ${item.name}`}
          value={target.to === "existing" ? target.employerId : "new"}
          onChange={(e) =>
            decide(item.key, { employer: e.target.value === "new" ? { to: "new" } : { to: "existing", employerId: e.target.value } })
          }
        >
          <option value="new">New employer</option>
          {record.employers.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </NativeSelect>
      </header>
      <div className="space-y-3">
        {resolved.roles.map((r) => (
          <RoleBlock key={r.item.key} resolved={r} employerRoles={existing?.roles ?? []} decide={decide} setRoleBullets={setRoleBullets} regroup={regroup} />
        ))}
      </div>
    </section>
  );
}

function RoleBlock({
  resolved,
  employerRoles,
  decide,
  setRoleBullets,
  regroup,
}: {
  resolved: ResolvedRole;
  employerRoles: Role[];
  decide: Decide;
  setRoleBullets: (roleKey: string, include: boolean) => void;
  regroup: Regroup;
}) {
  const { item, target, included, angle } = resolved;
  const [showKnown, setShowKnown] = useState(false);
  const [comparing, setComparing] = useState(false);
  // The role the bullets were last compared with. Starts as the role the suggestion was made for.
  const suggestedId = item.suggestion.to === "new" ? null : item.suggestion.roleId;
  const [comparedWith, setComparedWith] = useState<string | null>(suggestedId);
  const targetId = target.to === "new" ? null : target.roleId;
  const targetRole = target.to === "new" ? undefined : employerRoles.find((r) => r.id === target.roleId);
  const known = resolved.bullets.filter((b) => b.target.to === "known");
  const rest = resolved.bullets.filter((b) => b.target.to !== "known");

  function pickRole(value: string) {
    if (value === "new") return decide(item.key, { role: { to: "new" } });
    const role = employerRoles.find((r) => r.id === value);
    const framing = role?.framings.find((f) => f.title.trim().toLowerCase() === item.title.trim().toLowerCase());
    decide(item.key, { role: framing ? { to: "same", roleId: value, framingId: framing.id } : { to: "framing", roleId: value } });
  }

  function pickFraming(value: string) {
    if (target.to === "new") return;
    decide(item.key, { role: value === "new" ? { to: "framing", roleId: target.roleId } : { to: "same", roleId: target.roleId, framingId: value } });
  }

  const newFraming = target.to !== "same" || !target.framingId;

  return (
    <div className={cn("space-y-2 rounded-md bg-muted/30 p-3 transition-opacity duration-200", !included && "opacity-60")}>
      <div className="flex flex-wrap items-center gap-2">
        <IncludeToggle included={included} onChange={(v) => decide(item.key, { include: v })} label={item.title || "this role"} />
        <div className="min-w-0 text-sm">
          <span className="font-medium">{item.title || "Untitled role"}</span>
          <span className="text-muted-foreground">
            {item.datesText ? `, ${item.datesText}` : ""}
            {item.location ? `, ${item.location}` : ""}
          </span>
        </div>
        {item.removedBefore && <Badge variant="outline">You removed this before</Badge>}
        {!item.datesReadable && <Badge variant="outline">Dates could not be read</Badge>}
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="space-y-1 text-xs text-muted-foreground">
          Goes under
          <NativeSelect
            size="sm"
            value={target.to === "new" ? "new" : target.roleId}
            disabled={employerRoles.length === 0}
            onChange={(e) => pickRole(e.target.value)}
          >
            <option value="new">A separate role</option>
            {employerRoles.map((r) => (
              <option key={r.id} value={r.id}>
                {roleLabel(r)}
              </option>
            ))}
          </NativeSelect>
        </label>
        {targetRole && (
          <label className="space-y-1 text-xs text-muted-foreground">
            Told as
            <NativeSelect size="sm" value={target.to === "same" && target.framingId ? target.framingId : "new"} onChange={(e) => pickFraming(e.target.value)}>
              {targetRole.framings.map((f) => (
                <option key={f.id} value={f.id}>
                  Existing framing: {f.title}
                </option>
              ))}
              <option value="new">New framing: {item.title || "Untitled"}</option>
            </NativeSelect>
          </label>
        )}
        {newFraming && (
          <label className="space-y-1 text-xs text-muted-foreground">
            Angle (for example Product or Engineering)
            <Input value={angle} maxLength={80} onChange={(e) => decide(item.key, { angle: e.target.value })} className="h-7" />
          </label>
        )}
      </div>

      {targetId !== comparedWith && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-background px-2.5 py-1.5 text-xs">
          <p className="min-w-0 flex-1 text-muted-foreground">
            You moved this role, so the suggestions for its bullets may not fit. Compare them with the new role to update them.
          </p>
          <Button
            type="button"
            size="xs"
            variant="outline"
            loading={comparing}
            onClick={async () => {
              setComparing(true);
              try {
                await regroup(item.key, target);
                setComparedWith(targetId);
              } finally {
                setComparing(false);
              }
            }}
          >
            <GitCompare aria-hidden />
            Compare bullets with this role
          </Button>
        </div>
      )}

      {item.dateNote && (
        <p className="flex items-start gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-xs">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {item.dateNote}
        </p>
      )}

      {resolved.bullets.length > 0 && (
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-muted-foreground">Bullets</p>
            <div className="flex gap-1">
              <Button type="button" size="xs" variant="ghost" onClick={() => setRoleBullets(item.key, true)}>
                Include all
              </Button>
              <Button type="button" size="xs" variant="ghost" onClick={() => setRoleBullets(item.key, false)}>
                Leave all out
              </Button>
            </div>
          </div>
          <ul className="space-y-1">
            {rest.map((b) => (
              <BulletRow key={b.item.key} resolved={b} targetRole={targetRole} decide={decide} siblings={rest} />
            ))}
          </ul>
          {known.length > 0 && (
            <div>
              <Button type="button" size="xs" variant="ghost" aria-expanded={showKnown} onClick={() => setShowKnown((v) => !v)}>
                <ChevronDown className={cn("transition-transform duration-200", showKnown && "rotate-180")} aria-hidden />
                {known.length} already in your record
              </Button>
              <Collapse open={showKnown}>
                <ul className="space-y-1 pt-1">
                  {known.map((b) => (
                    <BulletRow key={b.item.key} resolved={b} targetRole={targetRole} decide={decide} siblings={[]} />
                  ))}
                </ul>
              </Collapse>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function BulletRow({
  resolved,
  targetRole,
  decide,
  siblings,
}: {
  resolved: ResolvedBullet;
  targetRole: Role | undefined;
  decide: Decide;
  /** The other bullets of this role that are going in as new facts, which this one may be the same as. */
  siblings: ResolvedBullet[];
}) {
  const { item, target, included } = resolved;
  const fact = target.to === "new" ? undefined : targetRole?.facts.find((f) => f.id === target.factId);
  const others = siblings.filter((s) => s.item.key !== item.key && s.target.to === "new" && !s.target.withKey);
  const joined = target.to === "new" && target.withKey ? siblings.find((s) => s.item.key === target.withKey) : undefined;
  const canChoose = target.to !== "known" && ((targetRole && targetRole.facts.length > 0) || others.length > 0 || joined);

  const value = target.to === "fact" ? `fact:${target.factId}` : target.to === "new" && target.withKey ? `with:${target.withKey}` : "new";
  function choose(v: string) {
    if (v === "new") decide(item.key, { bullet: { to: "new" } });
    else if (v.startsWith("fact:")) decide(item.key, { bullet: { to: "fact", factId: v.slice(5), why: "user" } });
    else decide(item.key, { bullet: { to: "new", withKey: v.slice(5) } });
  }

  return (
    <li
      className={cn(
        "space-y-1 rounded-md px-2 py-1.5 text-sm transition-[background-color,opacity] duration-100 hover:bg-muted/60",
        !included && "opacity-50",
      )}
    >
      <div className="flex items-start gap-2">
        <IncludeToggle included={included} onChange={(v) => decide(item.key, { include: v })} label={clip(item.text, 40)} />
        <p className={cn("min-w-0 flex-1", !included && "line-through")}>{item.text}</p>
        {target.to === "known" ? (
          <Badge variant="secondary">Already in your record</Badge>
        ) : target.to === "fact" ? (
          <Badge variant="secondary">Same fact, new wording</Badge>
        ) : joined ? (
          <Badge variant="secondary">Same as another new bullet</Badge>
        ) : (
          <Badge>New fact</Badge>
        )}
      </div>
      {item.removedBefore && <p className="pl-8 text-xs text-muted-foreground">You removed this before, so it starts out left out.</p>}
      {fact && target.to === "fact" && (
        <div className="space-y-0.5 pl-8 text-xs text-muted-foreground">
          <p>{WHY[target.why]}</p>
          <p className="border-l-2 pl-2">Already worded: {clip(fact.wordings[0]?.text ?? "")}</p>
        </div>
      )}
      {joined && (
        <p className="border-l-2 pl-2 text-xs text-muted-foreground ml-8">Grouped with: {clip(joined.item.text)}</p>
      )}
      {canChoose && (
        <label className="block pl-8 text-xs text-muted-foreground">
          <span className="sr-only">Which fact is this</span>
          <NativeSelect size="sm" className="max-w-md" value={value} onChange={(e) => choose(e.target.value)}>
            <option value="new">A new fact</option>
            {targetRole?.facts.map((f) => (
              <option key={f.id} value={`fact:${f.id}`}>
                Same as: {clip(f.wordings[0]?.text ?? "", 70)}
              </option>
            ))}
            {others.map((o) => (
              <option key={o.item.key} value={`with:${o.item.key}`}>
                Same as new bullet: {clip(o.item.text, 60)}
              </option>
            ))}
            {joined && (
              <option value={`with:${joined.item.key}`}>Same as new bullet: {clip(joined.item.text, 60)}</option>
            )}
          </NativeSelect>
        </label>
      )}
    </li>
  );
}
