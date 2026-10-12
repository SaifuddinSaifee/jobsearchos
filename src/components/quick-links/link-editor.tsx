"use client";

import { Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  createQuickLinkAction,
  deleteQuickLinkAction,
  updateQuickLinkAction,
} from "@/app/(app)/links/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { QuickLink } from "@/lib/quick-links/types";

const EMPTY = { title: "", url: "", note: "", group: "" };

/**
 * Add (no `link`) or edit a quick link. Groups already in use are offered as suggestions. The parent gives it a
 * new `key` each time it opens, so the fields always start from the link being edited.
 */
export function LinkEditor({
  open,
  onOpenChange,
  link,
  groups,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  link: QuickLink | null;
  groups: string[];
}) {
  const [form, setForm] = useState(() =>
    link ? { title: link.title, url: link.url, note: link.note, group: link.group } : EMPTY,
  );
  const [busy, setBusy] = useState<"save" | "delete" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // The delete button asks for a second click; drop back if that click does not come.
  useEffect(() => {
    if (!confirmDelete) return;
    const id = setTimeout(() => setConfirmDelete(false), 3000);
    return () => clearTimeout(id);
  }, [confirmDelete]);

  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  async function save() {
    setBusy("save");
    const res = link ? await updateQuickLinkAction(link.id, form) : await createQuickLinkAction(form);
    setBusy(null);
    if (!res.ok) return void toast.error(res.error);
    toast.success(link ? "Link updated" : "Link added");
    onOpenChange(false);
  }

  async function remove() {
    if (!link) return;
    if (!confirmDelete) return setConfirmDelete(true);
    setBusy("delete");
    const res = await deleteQuickLinkAction(link.id);
    setBusy(null);
    if (!res.ok) return void toast.error(res.error);
    toast.success(`Deleted ${link.title}`);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{link ? "Edit link" : "Add link"}</DialogTitle>
          <DialogDescription>
            A job board search, a careers page or any dashboard you check daily. Save searches with your filters already in the link.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (form.title.trim() && form.url.trim() && !busy) void save();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="ql-url">Link</Label>
            <Input id="ql-url" autoFocus value={form.url} onChange={set("url")} placeholder="https://www.linkedin.com/jobs/search/?keywords=..." />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ql-title">Name</Label>
            <Input id="ql-title" value={form.title} onChange={set("title")} placeholder="LinkedIn - Senior PM, remote" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ql-group">Group (optional)</Label>
              <Input id="ql-group" list="ql-groups" value={form.group} onChange={set("group")} placeholder="Job boards" />
              <datalist id="ql-groups">
                {groups.map((g) => (
                  <option key={g} value={g} />
                ))}
              </datalist>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ql-note">Note (optional)</Label>
              <Input id="ql-note" value={form.note} onChange={set("note")} placeholder="Sort by newest" />
            </div>
          </div>
          <div className="flex items-center justify-between gap-2 pt-1">
            {link ? (
              <Button type="button" variant="destructive" onClick={() => void remove()} loading={busy === "delete"} disabled={busy === "save"}>
                <Trash2 aria-hidden />
                <span key={confirmDelete ? "confirm" : "idle"} className="animate-in fade-in duration-150 motion-reduce:animate-none">
                  {confirmDelete ? "Click again to delete" : "Delete"}
                </span>
              </Button>
            ) : (
              <span />
            )}
            <Button type="submit" disabled={!form.title.trim() || !form.url.trim() || busy === "delete"} loading={busy === "save"}>
              {link ? "Save" : "Add link"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
