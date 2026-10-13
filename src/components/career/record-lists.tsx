"use client";

import { MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { SimpleKind } from "@/lib/career/edit-schema";
import type { CareerRecord, Provenance, SourceRef } from "@/lib/career/schema";
import { useRecordEdit } from "./record-edit";
import { SourceChips } from "./source-chips";

type Row = { id: string; title: string; detail?: string; sources: SourceRef[]; provenance: Provenance };

/** Skills, projects, education, certifications and achievements of the record. */
export function SimpleLists({ record }: { record: CareerRecord }) {
  const { ask, run } = useRecordEdit();
  const groups: { title: string; kind: SimpleKind; rows: Row[]; add?: () => void; edit?: (r: Row) => void }[] = [
    {
      title: "Skills",
      kind: "skill",
      rows: record.skills.map((s) => ({ id: s.id, title: s.name, detail: s.category, sources: s.sources, provenance: s.provenance })),
      add: () =>
        ask({
          title: "Add a skill",
          fields: [
            { name: "name", label: "Skill", kind: "text", value: "" },
            { name: "category", label: "Category (for example Languages)", kind: "text", value: "", optional: true },
          ],
          submitLabel: "Add",
          onSubmit: (v) => run({ op: "addSkill", name: String(v.name).trim(), category: String(v.category).trim() }),
        }),
      edit: (r) =>
        ask({
          title: "Edit skill",
          fields: [
            { name: "name", label: "Skill", kind: "text", value: r.title },
            { name: "category", label: "Category", kind: "text", value: r.detail ?? "", optional: true },
          ],
          submitLabel: "Save",
          onSubmit: (v) => run({ op: "editSkill", skillId: r.id, name: String(v.name).trim(), category: String(v.category).trim() }),
        }),
    },
    {
      title: "Projects",
      kind: "project",
      rows: record.projects.map((p) => ({ id: p.id, title: p.name, detail: p.description || `${p.wordings.length} wordings`, sources: p.sources, provenance: p.provenance })),
    },
    {
      title: "Education",
      kind: "education",
      rows: record.education.map((e) => ({
        id: e.id,
        title: e.institution,
        detail: [e.degree, e.field].filter(Boolean).join(" in "),
        sources: e.sources,
        provenance: e.provenance,
      })),
    },
    {
      title: "Certifications",
      kind: "certification",
      rows: record.certifications.map((c) => ({ id: c.id, title: c.name, detail: c.issuer, sources: c.sources, provenance: c.provenance })),
    },
    {
      title: "Achievements",
      kind: "achievement",
      rows: record.achievements.map((a) => ({ id: a.id, title: a.text, sources: a.sources, provenance: a.provenance })),
      add: () =>
        ask({
          title: "Add an achievement",
          fields: [{ name: "text", label: "Achievement", kind: "textarea", value: "" }],
          submitLabel: "Add",
          onSubmit: (v) => run({ op: "addAchievement", text: String(v.text) }),
        }),
      edit: (r) =>
        ask({
          title: "Edit achievement",
          fields: [{ name: "text", label: "Achievement", kind: "textarea", value: r.title }],
          submitLabel: "Save",
          onSubmit: (v) => run({ op: "editAchievement", achievementId: r.id, text: String(v.text) }),
        }),
    },
    {
      title: "Reasons for applying",
      kind: "motivation",
      rows: record.motivations.map((m) => ({
        id: m.id,
        title: m.text,
        detail: m.scope === "company" ? (m.companyName ? `for ${m.companyName}` : "for one company") : "general",
        sources: m.sources,
        provenance: m.provenance,
      })),
    },
  ];

  const { sources } = useRecordEdit();
  return (
    <div className="space-y-3">
      {groups
        .filter((g) => g.rows.length > 0 || g.add)
        .map((g) => (
          <section key={g.kind} className="space-y-2 rounded-lg border p-3 animate-in fade-in slide-in-from-bottom-1 duration-300 motion-reduce:animate-none">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">
                {g.title} <span className="font-normal text-muted-foreground tabular-nums">{g.rows.length}</span>
              </h3>
              {g.add && (
                <Button type="button" size="xs" variant="ghost" onClick={g.add}>
                  <Plus aria-hidden />
                  Add
                </Button>
              )}
            </div>
            {g.rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing yet.</p>
            ) : (
              <ul className="divide-y">
                {g.rows.map((r) => (
                  <li key={r.id} className="flex items-start gap-2 py-1.5 text-sm transition-colors duration-100 hover:bg-muted/40">
                    <div className="min-w-0 flex-1 space-y-1">
                      <p>
                        {r.title}
                        {r.detail && <span className="text-muted-foreground">{`, ${r.detail}`}</span>}
                      </p>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {(r.provenance.origin === "user" || r.provenance.user.length > 0) && (
                          <Badge variant="outline">{r.provenance.user.length > 0 ? "Edited by you" : "Added by you"}</Badge>
                        )}
                        <SourceChips sources={r.sources} info={sources} />
                      </div>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-xs" aria-label={`Actions for ${r.title}`} />}>
                        <MoreHorizontal />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-40">
                        {g.edit && (
                          <>
                            <DropdownMenuItem onClick={() => g.edit?.(r)}>
                              <Pencil aria-hidden />
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                          </>
                        )}
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() =>
                            ask({
                              title: `Delete ${r.title.length > 40 ? "this item" : r.title}?`,
                              description: "A later merge will propose leaving it out. You can undo this by restoring a version.",
                              fields: [],
                              submitLabel: "Delete",
                              destructive: true,
                              onSubmit: () => run({ op: "deleteItem", kind: g.kind, itemId: r.id }),
                            })
                          }
                        >
                          <Trash2 aria-hidden />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
    </div>
  );
}
