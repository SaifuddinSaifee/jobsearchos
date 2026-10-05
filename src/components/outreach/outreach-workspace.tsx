"use client";

import { ArrowLeft, CircleCheck, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useStatusTransitions } from "@/components/queue/use-queue";
import { refreshAction, reuseAction, saveDraftAction, sendAction, startSearchAction } from "@/app/(app)/jobs/[id]/outreach/actions";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { sendWarnings } from "@/lib/outreach/checks";
import type { OutreachData } from "@/lib/outreach/service";
import { statusInfo, type ApplicationStatus } from "@/lib/jobs/status";
import { cn } from "@/lib/utils";
import { Composer, type SaveState } from "./composer";
import { ContactsPanel } from "./contacts-panel";
import { SEARCHES_KEY, useSearches } from "./use-searches";
import { SendDialog } from "./send-dialog";
import { SentHistory } from "./sent-history";
import type { ContactDTO, SearchItem, SentDTO } from "@/lib/outreach/types";

type JobHead = { id: string; title: string; company: string; location: string; postingUrl: string | null; status: ApplicationStatus };

const SAVE_DELAY_MS = 700;

export function OutreachWorkspace({ job, initial }: { job: JobHead; initial: OutreachData }) {
  const [contacts, setContacts] = useState<ContactDTO[]>(initial.contacts);
  const [sent, setSent] = useState<SentDTO[]>(initial.sent);
  const [sentToday, setSentToday] = useState(initial.sentToday);
  const [domain, setDomain] = useState(initial.domain);
  const [subject, setSubject] = useState(initial.draft?.subject ?? "");
  const [body, setBody] = useState(initial.draft?.body ?? "");
  const [selectedId, setSelectedId] = useState<string | null>(initial.draft?.contactId ?? null);
  const [mode, setMode] = useState<"write" | "preview">("write");
  const [saveState, setSaveState] = useState<SaveState>(initial.draft ? "saved" : "idle");
  const [sendOpen, setSendOpen] = useState(false);
  const [sendNow, setSendNow] = useState<Date>(() => new Date(0));
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [reuseId, setReuseId] = useState<string | null>(null);

  const { settings, account } = initial;
  const contact = useMemo(() => contacts.find((c) => c.id === selectedId && !c.doNotContact) ?? null, [contacts, selectedId]);

  // ---- autosave: edits are written to the draft shortly after typing stops, one request at a time
  const latest = useRef({ subject, body, contactId: selectedId });
  /** Every edit goes through here so the saver always sees the newest text, even before React re-renders. */
  const edit = useCallback((patch: Partial<{ subject: string; body: string; contactId: string | null }>) => {
    latest.current = { ...latest.current, ...patch };
    if (patch.subject !== undefined) setSubject(patch.subject);
    if (patch.body !== undefined) setBody(patch.body);
    if (patch.contactId !== undefined) setSelectedId(patch.contactId);
  }, []);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const queue = useRef<Promise<boolean>>(Promise.resolve(true));
  const pending = useRef(0);

  const persist = useCallback((): Promise<boolean> => {
    const run = async () => {
      pending.current += 1;
      setSaveState("saving");
      const { subject, body, contactId } = latest.current;
      const res = await saveDraftAction(job.id, { subject, body, contactId });
      pending.current -= 1;
      if (!res.ok) {
        setSaveState("error");
        toast.error(res.error);
        return false;
      }
      if (pending.current === 0 && !timer.current) setSaveState("saved");
      return true;
    };
    queue.current = queue.current.then(run, run);
    return queue.current;
  }, [job.id]);

  const touch = useCallback(
    (immediately = false) => {
      clearTimeout(timer.current);
      setSaveState("dirty");
      if (immediately) {
        timer.current = undefined;
        void persist();
        return;
      }
      timer.current = setTimeout(() => {
        timer.current = undefined;
        void persist();
      }, SAVE_DELAY_MS);
    },
    [persist],
  );

  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    timer.current = undefined;
    return persist();
  }, [persist]);

  // Leaving the page with unsaved typing still saves it.
  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
        const { subject, body, contactId } = latest.current;
        void saveDraftAction(job.id, { subject, body, contactId });
      }
    },
    [job.id],
  );

  function applyLists(l: { contacts: ContactDTO[]; sent: SentDTO[]; sentToday: number }) {
    setContacts(l.contacts);
    setSent(l.sent);
    setSentToday(l.sentToday);
    // A removed or blocked recipient must not stay selected.
    if (selectedId && !l.contacts.some((c) => c.id === selectedId && !c.doNotContact)) {
      edit({ contactId: null });
      touch(true);
    }
  }

  function select(id: string) {
    edit({ contactId: id });
    touch(true);
  }

  function openSend() {
    setSendNow(new Date());
    setSendError(null);
    setSendOpen(true);
  }

  const warnings = useMemo(
    () => (contact ? sendWarnings({ name: contact.name, emailStatus: contact.emailStatus, sentCount: contact.sentCount }, settings, sendNow) : []),
    [contact, settings, sendNow],
  );

  async function confirmSend() {
    if (!contact) return;
    setSending(true);
    setSendError(null);
    if (!(await flush())) {
      setSending(false);
      return setSendError("The draft could not be saved, so nothing was sent.");
    }
    const res = await sendAction(job.id, warnings.map((w) => w.code));
    setSending(false);
    if (!res.ok) return setSendError(res.error);
    applyLists(res);
    edit({ subject: "", body: "", contactId: null });
    setSaveState("idle");
    setSendOpen(false);
    setMode("write");
    toast.success(`Email sent to ${res.sentEmail.contactName}`);
  }

  async function reuse(sentId: string) {
    setReuseId(sentId);
    const res = await reuseAction(job.id, sentId);
    setReuseId(null);
    if (!res.ok) return toast.error(res.error);
    edit({ subject: res.draft.subject, body: res.draft.body, contactId: null });
    setSaveState("saved");
    setMode("write");
    toast.success("Copied into the editor. Choose who to send it to.");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // ---- background search: start it, follow it, and pick up its result when it finishes
  const queryClient = useQueryClient();
  const { searches, isSuccess: searchesLoaded } = useSearches();
  const mine = useMemo(() => searches.filter((x) => x.jobId === job.id), [searches, job.id]);
  const search: SearchItem | null = mine[0] ?? initial.search;

  async function startSearch() {
    const res = await startSearchAction(job.id);
    if (!res.ok) return void toast.error(res.error);
    queryClient.setQueryData<SearchItem[]>(SEARCHES_KEY, (old) => [res.search, ...(old ?? []).filter((x) => x.id !== res.search.id)]);
    void queryClient.invalidateQueries({ queryKey: SEARCHES_KEY });
    if (res.alreadyActive) toast.message("A search is already running for this job.");
  }

  useStatusTransitions(
    mine,
    searchesLoaded,
    useCallback(
      (changes: { item: SearchItem; from: string }[]) => {
        for (const { item, from } of changes) {
          if (from !== "queued" && from !== "running") continue;
          if (item.status === "failed") toast.error("The search failed. See the note below the buttons.");
          if (item.status !== "done" && item.status !== "failed") continue;
          void refreshAction(job.id).then((res) => {
            if (!res.ok) return void toast.error(res.error);
            applyLists(res);
            if (item.status === "done") {
              const n = item.found ?? 0;
              toast.success(n > 0 ? `Found ${n} ${n === 1 ? "person" : "people"}` : "No one found. See the notes below the buttons.");
            }
          });
        }
      },
      // eslint-disable-next-line react-hooks/exhaustive-deps -- applyLists changes every render; only its latest version matters
      [job.id, selectedId],
    ),
  );

  const status = statusInfo(job.status);
  const gmailOk = account && !account.needsReconnect;

  return (
    <div className="space-y-6 animate-in fade-in duration-200 motion-reduce:animate-none">
      <header className="flex flex-wrap items-start gap-x-4 gap-y-3">
        <Link href={`/jobs?job=${job.id}`} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
          <ArrowLeft /> Back to job
        </Link>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg leading-snug font-semibold">{job.title}</h2>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{job.company}</span>
            {job.location && <span>{job.location}</span>}
            <Badge variant="ghost" className={status.tone}>
              {status.label}
            </Badge>
          </p>
        </div>
        <Link
          href="/settings?tab=email"
          className={cn(
            "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-sm outline-none transition-[background-color,scale] hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97]",
            !gmailOk && "border-destructive/40 text-destructive",
          )}
        >
          {gmailOk ? <CircleCheck className="size-4 text-green-600" aria-hidden /> : <TriangleAlert className="size-4" aria-hidden />}
          {gmailOk ? `Sending from ${account.email}` : account ? "Reconnect Gmail" : "Connect Gmail to send"}
        </Link>
      </header>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <ContactsPanel
          jobId={job.id}
          contacts={contacts}
          selectedId={contact?.id ?? null}
          domain={domain}
          canSaveWebsite={initial.canSaveWebsite}
          sources={initial.sources}
          patterns={initial.patterns}
          search={search}
          onFind={startSearch}
          onSelect={select}
          onLists={applyLists}
          onDomain={setDomain}
        />
        <Composer
          account={account}
          contact={contact}
          subject={subject}
          body={body}
          mode={mode}
          saveState={saveState}
          settings={settings}
          sentToday={sentToday}
          onSubject={(v) => {
            edit({ subject: v });
            touch();
          }}
          onBody={(v) => {
            edit({ body: v });
            touch();
          }}
          onPasteEmail={(s, b) => {
            edit({ subject: s, body: b });
            touch();
          }}
          onMode={setMode}
          onSend={openSend}
        />
      </div>

      <SentHistory sent={sent} busyId={reuseId} onReuse={reuse} />

      <SendDialog
        open={sendOpen}
        contact={contact}
        from={account?.email ?? ""}
        subject={subject}
        body={body}
        warnings={warnings}
        sentToday={sentToday}
        dailyCap={settings.dailyCap}
        busy={sending}
        error={sendError}
        onClose={() => setSendOpen(false)}
        onConfirm={confirmSend}
      />
    </div>
  );
}
