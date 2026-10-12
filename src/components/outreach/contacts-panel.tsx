"use client";

import { Check, Globe, Info, Pencil, Plus, Search, UsersRound } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
  addContactAction,
  doNotContactAction,
  markVerifiedAction,
  removeContactAction,
  setWebsiteAction,
  updateContactAction,
  revealEmailAction,
} from "@/app/(app)/jobs/[id]/outreach/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useNow } from "@/components/jobs/use-now";
import type { PatternId } from "@/lib/outreach/patterns";
import type { EmailResult } from "@/lib/outreach/email-finder";
import { isSearchActive, type ContactDTO, type SearchItem, type SentDTO } from "@/lib/outreach/types";
import { ContactCard, ContactCardSkeleton, type ContactAction } from "./contact-card";
import { ContactDialog, type ContactForm } from "./contact-dialog";
import { SearchProgress } from "./search-progress";

type Lists = { contacts: ContactDTO[]; sent: SentDTO[]; sentToday: number };

function ago(now: Date, iso: string | null): string {
  if (!iso) return "just now";
  const minutes = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours} ${hours === 1 ? "hour" : "hours"} ago` : `${Math.round(hours / 24)} days ago`;
}

export function ContactsPanel({
  jobId,
  contacts,
  selectedId,
  domain,
  canSaveWebsite,
  sources,
  patterns,
  search,
  onFind,
  onSelect,
  onLists,
  onDomain,
}: {
  jobId: string;
  contacts: ContactDTO[];
  selectedId: string | null;
  domain: string | null;
  canSaveWebsite: boolean;
  sources: { posting: true; web: boolean; prospeo: boolean };
  patterns: PatternId[];
  /** The latest background search for this job, if any. */
  search: SearchItem | null;
  /** Queues a search; resolves once it is queued (not when it finishes). */
  onFind: () => Promise<void>;
  onSelect: (id: string) => void;
  onLists: (lists: Lists) => void;
  onDomain: (domain: string | null) => void;
}) {
  const [starting, setStarting] = useState(false);
  const now = useNow();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ contact: ContactDTO | null } | null>(null);
  const [dialogBusy, setDialogBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [editingSite, setEditingSite] = useState(false);
  const [site, setSite] = useState("");
  const [savingSite, setSavingSite] = useState(false);

  async function find() {
    setStarting(true);
    await onFind();
    setStarting(false);
  }

  const finding = starting || isSearchActive(search);
  const finished = search && !isSearchActive(search) ? search : null;
  const notes = finished ? (finished.status === "failed" ? [finished.error ?? "The search failed."] : finished.notes) : [];

  async function saveContact(form: ContactForm) {
    setDialogBusy(true);
    setDialogError(null);
    const edit = dialog?.contact;
    const res = edit ? await updateContactAction(jobId, edit.id, form) : await addContactAction(jobId, form);
    setDialogBusy(false);
    if (!res.ok) return setDialogError(res.error);
    onLists(res);
    setDialog(null);
    toast.success(edit ? "Contact updated" : "Contact added");
    // A person added by hand is almost always the one to email, so select them.
    const added = "added" in res ? (res.added as ContactDTO) : null;
    if (added) onSelect(added.id);
  }

  async function act(contact: ContactDTO, action: ContactAction) {
    if (action === "edit") return setDialog({ contact });
    setBusyId(contact.id);
    const res =
      action === "reveal"
        ? await revealEmailAction(jobId, contact.id)
        : action === "mark-verified"
          ? await markVerifiedAction(jobId, contact.id)
          : action === "remove"
            ? await removeContactAction(jobId, contact.id)
            : await doNotContactAction(jobId, contact.id, action === "do-not-contact");
    setBusyId(null);
    if (!res.ok) return toast.error(res.error);
    onLists(res);

    if (action === "reveal" && "found" in res) {
      const found = res.found as EmailResult;
      if (found.kind === "found") {
        const cost = found.cost > 0 ? `, ${found.cost} Prospeo credit` : ", free";
        return toast.success(`Found ${found.email}`, { description: `${found.source}${cost}` });
      }
      const [first] = found.guesses;
      if (!first) return toast.message("No email found", { description: "Add the company website, or type an address in yourself." });
      return toast.message("No verified email found", {
        description: `The most likely address is ${first}. It is only a guess, so it will stay Unverified.`,
        action: {
          label: "Use this guess",
          onClick: async () => {
            const r = await updateContactAction(jobId, contact.id, { name: contact.name, title: contact.title, email: first, kind: contact.kind, linkedinUrl: contact.linkedinUrl ?? "" });
            if (r.ok) onLists(r);
            else toast.error(r.error);
          },
        },
      });
    }

    const done: Record<ContactAction, string> = {
      edit: "",
      reveal: "",
      "mark-verified": "Marked as verified",
      "do-not-contact": `${contact.name} will not be emailed`,
      "allow-contact": `${contact.name} can be emailed again`,
      remove: `${contact.name} removed`,
    };
    toast.success(done[action]);
  }

  async function saveSite() {
    setSavingSite(true);
    const res = await setWebsiteAction(jobId, site);
    setSavingSite(false);
    if (!res.ok) return toast.error(res.error);
    onDomain(res.domain);
    setEditingSite(false);
    toast.success(res.domain ? `Company website set to ${res.domain}` : "Company website cleared");
  }

  const missing = [!sources.web && "web search (TAVILY_API_KEY)", !sources.prospeo && "Prospeo (PROSPEO_API_KEY)"].filter(Boolean);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UsersRound className="size-4" aria-hidden /> Who to email
          {contacts.length > 0 && <span className="text-sm font-normal text-muted-foreground">{contacts.length}</span>}
        </CardTitle>
        <CardDescription>
          The best person is usually the hiring manager for the team, or the founder at a small company.
          {" Finding an email tries your saved contacts and a public search first. A Prospeo credit is only used if those find nothing."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Button onClick={find} loading={finding}>
            <Search /> {finding ? "Searching..." : contacts.length > 0 ? "Search again" : "Find people"}
          </Button>
          <Button variant="outline" onClick={() => setDialog({ contact: null })}>
            <Plus /> Add someone
          </Button>
        </div>

        {canSaveWebsite && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Globe className="size-4 text-muted-foreground" aria-hidden />
            {editingSite ? (
              <form
                className="flex flex-1 items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!savingSite) void saveSite();
                }}
              >
                <Input autoFocus value={site} onChange={(e) => setSite(e.target.value)} placeholder="company.com" aria-label="Company website" className="h-7 max-w-56" />
                <Button type="submit" size="sm" loading={savingSite}>
                  <Check /> Save
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setEditingSite(false)} disabled={savingSite}>
                  Cancel
                </Button>
              </form>
            ) : (
              <>
                <span className="text-muted-foreground">Company website:</span>
                <span className={domain ? "font-medium" : "text-muted-foreground"}>{domain ?? "not set"}</span>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => {
                    setSite(domain ?? "");
                    setEditingSite(true);
                  }}
                >
                  <Pencil /> {domain ? "Change" : "Set it"}
                </Button>
                {!domain && <span className="text-xs text-muted-foreground">Helps find people and suggest email formats.</span>}
              </>
            )}
          </div>
        )}

        {finished && now && (
          <p className="text-xs text-muted-foreground">
            Last search {finished.status === "done" ? `found ${finished.found ?? 0} ${finished.found === 1 ? "person" : "people"}` : "failed"},{" "}
            {ago(now, finished.finishedAt)}.
          </p>
        )}

        {notes.length > 0 && !finding && (
          <div role="status" className="space-y-1 rounded-lg bg-muted p-3 text-sm text-muted-foreground animate-in fade-in duration-200 motion-reduce:animate-none">
            {notes.map((n) => (
              <p key={n} className="flex gap-2">
                <Info className="mt-0.5 size-4 shrink-0" aria-hidden /> {n}
              </p>
            ))}
          </div>
        )}

        {finding && (
          <div className="space-y-2">
            <SearchProgress search={search} />
            {contacts.length === 0 && (
              <>
                <ContactCardSkeleton />
                <ContactCardSkeleton />
              </>
            )}
          </div>
        )}

        {finding && contacts.length === 0 ? null : contacts.length === 0 ? (
          <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            <p className="font-medium text-foreground">No one yet</p>
            <p className="mx-auto mt-1 max-w-xs">
              Find people reads the posting for named contacts and searches the company for whoever would hire for this role. Or add someone you already know.
            </p>
            {missing.length > 0 && <p className="mx-auto mt-2 max-w-xs text-xs">Not set up: {missing.join(" and ")}.</p>}
          </div>
        ) : (
          <div role="radiogroup" aria-label="Recipient" className={finding ? "space-y-2 opacity-60 transition-opacity" : "space-y-2"}>
            {contacts.map((c) => (
              <ContactCard
                key={c.id}
                contact={c}
                selected={c.id === selectedId}
                busy={busyId === c.id}
                hasDomain={Boolean(domain)}
                onSelect={() => onSelect(c.id)}
                onAction={(a) => act(c, a)}
              />
            ))}
          </div>
        )}
      </CardContent>

      <ContactDialog
        open={dialog !== null}
        contact={dialog?.contact ?? null}
        domain={domain}
        patterns={patterns}
        busy={dialogBusy}
        error={dialogError}
        onClose={() => {
          setDialog(null);
          setDialogError(null);
        }}
        onSave={saveContact}
      />
    </Card>
  );
}
