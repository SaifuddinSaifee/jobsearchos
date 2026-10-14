"use client";

import {
  AlertTriangle,
  Building2,
  ChevronDown,
  GitMerge,
  MoreHorizontal,
  Pencil,
  Plus,
  Split,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapse } from "@/components/ui/collapse";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { formatDates } from "@/lib/career/dates";
import { wordingFitsFraming } from "@/lib/career/framing";
import type { CareerRecord, Employer, Fact, Role, Wording } from "@/lib/career/schema";
import { cn } from "@/lib/utils";
import { useRecordEdit } from "./record-edit";
import { SimpleLists } from "./record-lists";
import { SourceChips } from "./source-chips";

const ENTER = "animate-in fade-in slide-in-from-bottom-1 duration-300 motion-reduce:animate-none";
const clip = (text: string, n = 70) => (text.length > n ? `${text.slice(0, n - 3)}...` : text);

export function RecordBrowser({ record }: { record: CareerRecord }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const has = (s: string) => s.toLowerCase().includes(q);

  const employers = [...record.employers].sort((a, b) => latestEnd(b) - latestEnd(a));
  const roleMatches = (r: Role) =>
    r.framings.some((f) => has(`${f.title} ${f.angle}`)) || r.facts.some((f) => f.wordings.some((w) => has(w.text)));
  const employerShown = (e: Employer) => !q || has(e.names.join(" ")) || e.roles.some(roleMatches);

  const shown = employers.filter(employerShown);
  return (
    <div className="space-y-4">
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search employers, titles and wordings"
        aria-label="Search the career record"
        className="max-w-md"
      />
      {shown.length === 0 && record.employers.length > 0 && <p className="text-sm text-muted-foreground">Nothing in your record matches that.</p>}
      <div className="space-y-3">
        {shown.map((e, i) => (
          <EmployerSection key={e.id} employer={e} q={q} defaultOpen={i < 3} />
        ))}
      </div>
      {!q && <SimpleLists record={record} />}
    </div>
  );
}

/** A rough "most recent first": open roles first, then the latest year seen in any role's end date. */
function latestEnd(e: Employer): number {
  let best = 0;
  for (const r of e.roles) {
    if (r.current) return Number.MAX_SAFE_INTEGER;
    const year = Number((r.end.match(/\d{4}/) ?? r.start.match(/\d{4}/) ?? [0])[0]);
    best = Math.max(best, year);
  }
  return best;
}

function EmployerSection({ employer, q, defaultOpen }: { employer: Employer; q: string; defaultOpen: boolean }) {
  const { ask, run } = useRecordEdit();
  const [open, setOpen] = useState(defaultOpen);
  const expanded = open || q.length > 0;
  const facts = employer.roles.reduce((n, r) => n + r.facts.length, 0);
  const nameMatches = q.length > 0 && employer.names.join(" ").toLowerCase().includes(q);

  return (
    <section className={cn("rounded-lg border", ENTER)}>
      <header className="flex items-center gap-2 px-3 py-2">
        <Button
          type="button"
          variant="ghost"
          className="h-auto min-w-0 flex-1 justify-start gap-2 px-1 py-1 text-left"
          aria-expanded={expanded}
          onClick={() => setOpen((v) => !v)}
        >
          <ChevronDown className={cn("transition-transform duration-200", !expanded && "-rotate-90")} aria-hidden />
          <Building2 className="text-muted-foreground" aria-hidden />
          <span className="truncate text-sm font-semibold">{employer.name}</span>
          <span className="text-xs font-normal text-muted-foreground tabular-nums">
            {employer.roles.length} {employer.roles.length === 1 ? "role" : "roles"}, {facts} {facts === 1 ? "fact" : "facts"}
          </span>
        </Button>
        {employer.provenance.user.includes("name") && <Badge variant="outline">Edited by you</Badge>}
        {employer.companyId && (
          <Link href={`/companies/${employer.companyId}`} className="rounded-4xl focus-visible:ring-2 focus-visible:ring-ring">
            <Badge variant="secondary" className="transition-opacity hover:opacity-70">
              In Companies
            </Badge>
          </Link>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`Actions for ${employer.name}`} />}>
            <MoreHorizontal />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem
              onClick={() =>
                ask({
                  title: "Rename employer",
                  fields: [{ name: "name", label: "Name", kind: "text", value: employer.name }],
                  submitLabel: "Save",
                  onSubmit: (v) => run({ op: "editEmployer", employerId: employer.id, name: String(v.name) }),
                })
              }
            >
              <Pencil aria-hidden />
              Rename
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={() =>
                ask({
                  title: `Delete ${employer.name}?`,
                  description: "Its roles, facts and wordings leave your record. A later merge will propose leaving them out. You can undo this by restoring a version.",
                  fields: [],
                  submitLabel: "Delete",
                  destructive: true,
                  onSubmit: () => run({ op: "deleteEmployer", employerId: employer.id }),
                })
              }
            >
              <Trash2 aria-hidden />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>
      <Collapse open={expanded}>
        <div className="space-y-3 border-t p-3">
          {employer.roles.length === 0 && <p className="text-sm text-muted-foreground">No roles.</p>}
          {employer.roles.map((r) => (
            <RoleCard key={r.id} employer={employer} role={r} q={q} showAll={nameMatches} />
          ))}
        </div>
      </Collapse>
    </section>
  );
}

function RoleCard({ employer, role, q, showAll }: { employer: Employer; role: Role; q: string; showAll: boolean }) {
  const { ask, run } = useRecordEdit();
  const [framingId, setFramingId] = useState<string | null>(null);
  const has = (s: string) => s.toLowerCase().includes(q);
  const roleText = role.framings.some((f) => has(`${f.title} ${f.angle}`));
  const framingOptions = [{ value: "", label: "No particular framing" }, ...role.framings.map((f) => ({ value: f.id, label: f.title }))];
  const showAllFacts = !q || showAll || roleText;
  const facts = role.facts.filter((f) => showAllFacts || f.wordings.some((w) => has(w.text)));
  const dates = formatDates(role);
  const hidden = q.length > 0 && !showAll && !roleText && facts.length === 0;
  if (hidden) return null;

  return (
    <article className="space-y-2 rounded-md bg-muted/30 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Framings of this role">
            {role.framings.map((f) => (
              <Button
                key={f.id}
                type="button"
                size="xs"
                variant={framingId === f.id ? "default" : "outline"}
                aria-pressed={framingId === f.id}
                title={role.framings.length > 1 ? "Show only the wordings written for this framing" : undefined}
                onClick={() => setFramingId((cur) => (cur === f.id ? null : f.id))}
              >
                {f.title}
                {f.angle && <span className="font-normal opacity-70">{f.angle}</span>}
              </Button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {[dates || "No dates", role.location].filter(Boolean).join(", ")}
            {role.provenance.user.some((f) => ["start", "end", "current"].includes(f)) && " (edited by you)"}
          </p>
          {role.framings.some((f) => f.targetRoles.length > 0) && (
            <p className="text-xs text-muted-foreground">Written for: {[...new Set(role.framings.flatMap((f) => f.targetRoles))].join(", ")}</p>
          )}
        </div>
        <RoleMenu employer={employer} role={role} />
      </div>

      {role.dateNotes.length > 0 && (
        <ul className="space-y-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-xs">
          {role.dateNotes.map((n) => (
            <li key={n} className="flex items-start gap-1.5">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              Dates differ: {n}
            </li>
          ))}
        </ul>
      )}

      <ul className="space-y-2">
        {facts.map((f) => (
          <FactRow key={f.id} role={role} fact={f} framingId={framingId} />
        ))}
      </ul>
      <Button
        type="button"
        size="xs"
        variant="ghost"
        onClick={() =>
          ask({
            title: "Add a fact",
            description: "Something you did in this role, in your own words.",
            fields: [
              { name: "text", label: "What you did", kind: "textarea", value: "" },
              { name: "framingId", label: "Written for", kind: "select", value: "", options: framingOptions },
            ],
            submitLabel: "Add",
            onSubmit: (v) => run({ op: "addFact", roleId: role.id, text: String(v.text), framingId: String(v.framingId) || null }),
          })
        }
      >
        <Plus aria-hidden />
        Add a fact
      </Button>
    </article>
  );
}

function RoleMenu({ employer, role }: { employer: Employer; role: Role }) {
  const { ask, run } = useRecordEdit();
  const others = employer.roles.filter((r) => r.id !== role.id);
  const label = role.framings[0]?.title || "this role";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`Actions for ${label}`} />}>
        <MoreHorizontal />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuItem
          onClick={() =>
            ask({
              title: "Edit dates and location",
              description: "Your dates win: a later merge will not change them.",
              fields: [
                { name: "start", label: "Start", kind: "text", value: role.start, optional: true },
                { name: "end", label: "End", kind: "text", value: role.end, optional: true },
                { name: "current", label: "I still work here", kind: "checkbox", value: role.current },
                { name: "location", label: "Location", kind: "text", value: role.location, optional: true },
              ],
              submitLabel: "Save",
              onSubmit: (v) =>
                run({ op: "editRole", roleId: role.id, start: String(v.start).trim(), end: String(v.end).trim(), current: Boolean(v.current), location: String(v.location).trim() }),
            })
          }
        >
          <Pencil aria-hidden />
          Edit dates and location
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() =>
            ask({
              title: "Add a framing",
              description: "Another title this role was written under, for example Product Manager for a role listed as Engineer elsewhere.",
              fields: [
                { name: "title", label: "Title", kind: "text", value: "" },
                { name: "angle", label: "Angle (for example Product)", kind: "text", value: "", optional: true },
              ],
              submitLabel: "Add",
              onSubmit: (v) => run({ op: "addFraming", roleId: role.id, title: String(v.title).trim(), angle: String(v.angle).trim() }),
            })
          }
        >
          <Plus aria-hidden />
          Add a framing
        </DropdownMenuItem>
        {role.framings.length > 0 && <DropdownMenuSeparator />}
        {role.framings.map((f) => (
          <DropdownMenuItem
            key={f.id}
            onClick={() =>
              ask({
                title: "Edit framing",
                fields: [
                  { name: "title", label: "Title", kind: "text", value: f.title },
                  { name: "angle", label: "Angle", kind: "text", value: f.angle, optional: true },
                ],
                submitLabel: "Save",
                onSubmit: (v) => run({ op: "editFraming", framingId: f.id, title: String(v.title).trim(), angle: String(v.angle).trim() }),
              })
            }
          >
            <Pencil aria-hidden />
            Edit framing: {clip(f.title, 28)}
          </DropdownMenuItem>
        ))}
        {role.framings.length > 1 &&
          role.framings.map((f) => (
            <DropdownMenuItem
              key={`split-${f.id}`}
              onClick={() =>
                ask({
                  title: `Make ${f.title} a separate role?`,
                  description: "It keeps the same dates, and the wordings written for it move with it, each as a fact of its own.",
                  fields: [],
                  submitLabel: "Split",
                  onSubmit: () => run({ op: "splitFraming", framingId: f.id }),
                })
              }
            >
              <Split aria-hidden />
              Split off: {clip(f.title, 28)}
            </DropdownMenuItem>
          ))}
        {others.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Merge into another role</DropdownMenuLabel>
            {others.map((o) => (
              <DropdownMenuItem
                key={o.id}
                onClick={() =>
                  ask({
                    title: "Merge roles?",
                    description: `${label} joins ${o.framings[0]?.title ?? "the other role"}: their dates widen, and all facts and framings are kept.`,
                    fields: [],
                    submitLabel: "Merge",
                    onSubmit: () => run({ op: "mergeRoles", roleId: role.id, intoRoleId: o.id }),
                  })
                }
              >
                <GitMerge aria-hidden />
                {clip(`${o.framings[0]?.title ?? "Role"}, ${formatDates(o)}`, 36)}
              </DropdownMenuItem>
            ))}
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onClick={() =>
            ask({
              title: "Delete this role?",
              description: "Its facts and wordings leave your record. A later merge will propose leaving them out. You can undo this by restoring a version.",
              fields: [],
              submitLabel: "Delete",
              destructive: true,
              onSubmit: () => run({ op: "deleteRole", roleId: role.id }),
            })
          }
        >
          <Trash2 aria-hidden />
          Delete role
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function FactRow({ role, fact, framingId }: { role: Role; fact: Fact; framingId: string | null }) {
  const { ask, run } = useRecordEdit();
  const wordings = framingId ? fact.wordings.filter((w) => wordingFitsFraming(role, w, framingId)) : fact.wordings;
  if (wordings.length === 0) return null;
  const otherFacts = role.facts.filter((f) => f.id !== fact.id);
  const framingOptions = [{ value: "", label: "No particular framing" }, ...role.framings.map((f) => ({ value: f.id, label: f.title }))];

  return (
    <li className={cn("rounded-md border bg-background px-3 py-2 transition-colors duration-100 hover:border-foreground/25", ENTER)}>
      <ul className="space-y-2">
        {wordings.map((w) => (
          <WordingRow key={w.id} role={role} fact={fact} wording={w} />
        ))}
      </ul>
      <div className="mt-1 flex flex-wrap gap-1">
        <Button
          type="button"
          size="xs"
          variant="ghost"
          onClick={() =>
            ask({
              title: "Add another wording",
              description: "The same accomplishment, told another way.",
              fields: [
                { name: "text", label: "Wording", kind: "textarea", value: "" },
                { name: "framingId", label: "Written for", kind: "select", value: "", options: framingOptions },
              ],
              submitLabel: "Add",
              onSubmit: (v) => run({ op: "addWording", factId: fact.id, text: String(v.text), framingId: String(v.framingId) || null }),
            })
          }
        >
          <Plus aria-hidden />
          Add a wording
        </Button>
        {otherFacts.length > 0 && (
          <Button
            type="button"
            size="xs"
            variant="ghost"
            onClick={() =>
              ask({
                title: "Merge into another fact",
                description: "All the wordings of this fact join the other one. Use it when two facts describe the same accomplishment.",
                fields: [
                  {
                    name: "into",
                    label: "Merge into",
                    kind: "select",
                    value: otherFacts[0].id,
                    options: otherFacts.map((f) => ({ value: f.id, label: clip(f.wordings[0]?.text ?? "Empty fact") })),
                  },
                ],
                submitLabel: "Merge",
                onSubmit: (v) => run({ op: "mergeFacts", factId: fact.id, intoFactId: String(v.into) }),
              })
            }
          >
            <GitMerge aria-hidden />
            Merge into another fact
          </Button>
        )}
        <Button
          type="button"
          size="xs"
          variant="ghost"
          className="text-destructive hover:text-destructive"
          onClick={() =>
            ask({
              title: "Delete this fact?",
              description: "Every wording of it leaves your record. A later merge will propose leaving them out.",
              fields: [],
              submitLabel: "Delete",
              destructive: true,
              onSubmit: () => run({ op: "deleteFact", factId: fact.id }),
            })
          }
        >
          <Trash2 aria-hidden />
          Delete fact
        </Button>
      </div>
    </li>
  );
}

function WordingRow({ role, fact, wording }: { role: Role; fact: Fact; wording: Wording }) {
  const { ask, run, sources } = useRecordEdit();
  const framing = role.framings.find((f) => f.id === wording.framingId);
  const otherFacts = role.facts.filter((f) => f.id !== fact.id);
  const edited = wording.provenance.user.includes("text") || wording.provenance.origin === "user";

  return (
    <li className="space-y-1">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm">
            {wording.form === "paragraph" && <Badge variant="secondary" className="mr-1.5 align-middle">Story</Badge>}
            {wording.text}
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            {framing && role.framings.length > 1 && <Badge variant="secondary">{framing.angle || framing.title}</Badge>}
            {edited && <Badge variant="outline">{wording.provenance.origin === "user" && !wording.provenance.user.includes("text") ? "Added by you" : "Edited by you"}</Badge>}
            <SourceChips sources={wording.sources} info={sources} />
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="icon-xs" aria-label={`Actions for ${clip(wording.text, 40)}`} />}>
            <MoreHorizontal />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem
              onClick={() =>
                ask({
                  title: "Edit wording",
                  description: "Your wording wins: a later merge will not change it.",
                  fields: [{ name: "text", label: "Wording", kind: "textarea", value: wording.text }],
                  submitLabel: "Save",
                  onSubmit: (v) => run({ op: "editWording", wordingId: wording.id, text: String(v.text) }),
                })
              }
            >
              <Pencil aria-hidden />
              Edit text
            </DropdownMenuItem>
            {(otherFacts.length > 0 || fact.wordings.length > 1) && (
              <DropdownMenuItem
                onClick={() =>
                  ask({
                    title: "Move this wording",
                    fields: [
                      {
                        name: "to",
                        label: "Move to",
                        kind: "select",
                        value: otherFacts[0]?.id ?? "",
                        options: [
                          ...otherFacts.map((f) => ({ value: f.id, label: `Fact: ${clip(f.wordings[0]?.text ?? "Empty fact")}` })),
                          ...(fact.wordings.length > 1 ? [{ value: "", label: "A fact of its own" }] : []),
                        ],
                      },
                    ],
                    submitLabel: "Move",
                    onSubmit: (v) => run({ op: "moveWording", wordingId: wording.id, toFactId: String(v.to) || null }),
                  })
                }
              >
                <GitMerge aria-hidden />
                Move to another fact
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={() =>
                ask({
                  title: "Delete this wording?",
                  description: "A later merge will propose leaving it out. You can undo this by restoring a version.",
                  fields: [],
                  submitLabel: "Delete",
                  destructive: true,
                  onSubmit: () => run({ op: "deleteWording", wordingId: wording.id }),
                })
              }
            >
              <Trash2 aria-hidden />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
}
