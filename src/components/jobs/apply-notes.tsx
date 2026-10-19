"use client";

import { useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Check, ClipboardList, Copy, ExternalLink, Info, Mail, Paperclip, Send, Sparkles, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { fillApplyNotesAction } from "@/app/(app)/jobs/actions";
import { Button } from "@/components/ui/button";
import { copyText } from "@/lib/clipboard";
import { applyNoteHref } from "@/lib/jobs/links";
import type { ApplyNote, ApplyNoteKind } from "@/lib/jobs/schema";

/** `label` names the kind in the edit form; `short` heads its row in the How to apply box. */
export const APPLY_NOTE_KIND: Record<ApplyNoteKind, { label: string; short: string; Icon: LucideIcon }> = {
  where: { label: "Where to apply", short: "Apply via", Icon: Send },
  include: { label: "Include", short: "Include", Icon: Paperclip },
  deadline: { label: "Deadline", short: "Deadline", Icon: CalendarClock },
  other: { label: "Note", short: "Also note", Icon: Info },
};

/** Where to apply first, then what to send, deadlines and the rest. */
const ORDER: ApplyNoteKind[] = ["where", "include", "deadline", "other"];

const LINK_CLASS =
  "inline-flex items-center gap-1 font-medium break-all underline decoration-foreground/30 underline-offset-2 transition-colors hover:decoration-foreground";

/** Copies an address in place and confirms on the button itself, where the user is looking. */
function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(id);
  }, [copied]);
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      aria-label={copied ? "Copied" : label}
      title={label}
      className="ml-0.5 text-muted-foreground"
      onClick={() => copyText(value).then(() => setCopied(true), (e: Error) => toast.error(e.message))}
    >
      <span key={copied ? "done" : "idle"} className="animate-in fade-in zoom-in-95 duration-200 motion-reduce:animate-none">
        {copied ? <Check className="text-emerald-600 dark:text-emerald-400" aria-hidden /> : <Copy aria-hidden />}
      </span>
    </Button>
  );
}

/**
 * The note's text with its link made clickable: where the text already names the address it becomes the link in
 * place, otherwise a short link is added after the text.
 */
function NoteText({ text, link }: { text: string; link: string }) {
  const target = applyNoteHref(link);
  if (!target) return <>{text}</>;
  const raw = target.email ? target.href.slice("mailto:".length) : link.trim();
  const at = text.indexOf(raw);
  const props = {
    href: target.href,
    title: target.email ? `Email ${raw}` : target.href,
    ...(target.email ? {} : { target: "_blank", rel: "noopener noreferrer" }),
  };
  const Icon = target.email ? Mail : ExternalLink;
  const copy = target.email && <CopyButton value={raw} label={`Copy ${raw}`} />;
  if (at >= 0) {
    return (
      <>
        {text.slice(0, at)}
        <span className="inline-flex items-center">
          <a {...props} className={LINK_CLASS}>
            <Icon className="size-3.5 shrink-0" aria-hidden />
            {raw}
          </a>
          {copy}
        </span>
        {text.slice(at + raw.length)}
      </>
    );
  }
  return (
    <>
      {text}{" "}
      <span className="inline-flex items-center">
        <a {...props} className={LINK_CLASS}>
          <Icon className="size-3.5 shrink-0" aria-hidden />
          {target.email ? raw : `Open ${new URL(target.href).hostname.replace(/^www\./, "")}`}
        </a>
        {copy}
      </span>
    </>
  );
}

/** "Include a short note" reads as "A short note" under the row's own Include heading. */
function withoutKindPrefix(kind: ApplyNoteKind, text: string): string {
  if (kind !== "include") return text;
  const rest = text.replace(/^include\s+/i, "");
  return rest ? rest[0].toUpperCase() + rest.slice(1) : text;
}

/**
 * The posting's instructions on how to apply, shown next to the apply links so they are read before applying: a
 * posting that says "apply through this form, not here" makes the usual apply button the wrong one. Notes are grouped
 * by kind, one labelled row each: where to apply first, then what to send, deadlines and the rest.
 */
export function ApplyNotesCallout({ notes }: { notes: ApplyNote[] }) {
  if (!notes.length) return null;
  const groups = ORDER.map((kind) => ({ kind, items: notes.filter((n) => n.kind === kind) })).filter((g) => g.items.length);
  return (
    <section
      aria-labelledby="how-to-apply"
      className="@container overflow-hidden rounded-xl border border-amber-500/30 bg-amber-500/[0.06] text-sm animate-in fade-in slide-in-from-top-1 duration-200 motion-reduce:animate-none"
    >
      <header className="flex flex-wrap items-center gap-x-2 gap-y-0.5 border-b border-amber-500/20 px-4 py-2.5">
        <ClipboardList className="size-4 text-amber-600 dark:text-amber-400" aria-hidden />
        <h3 id="how-to-apply" className="font-medium">
          How to apply
        </h3>
        <span className="ml-auto hidden text-xs text-muted-foreground @md:inline">From the posting. Read before applying.</span>
      </header>
      <dl className="grid gap-x-6 gap-y-3 px-4 py-3 @md:grid-cols-[6.5rem_1fr]">
        {groups.map(({ kind, items }) => {
          const { short, Icon } = APPLY_NOTE_KIND[kind];
          return (
            <div key={kind} className="contents">
              <dt className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground @md:h-5">
                <Icon className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
                {short}
              </dt>
              <dd className="-mt-2 @md:mt-0">
                {items.length === 1 ? (
                  <NoteText text={withoutKindPrefix(kind, items[0].text)} link={items[0].link} />
                ) : (
                  <ul className="list-disc space-y-1 pl-4 marker:text-amber-600/70 dark:marker:text-amber-400/70">
                    {items.map((n, i) => (
                      <li key={i}>
                        <NoteText text={withoutKindPrefix(kind, n.text)} link={n.link} />
                      </li>
                    ))}
                  </ul>
                )}
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}

/** For jobs saved before apply notes were extracted: reads the saved posting text once to look for them. */
export function FindApplyNotesButton({ jobId }: { jobId: string }) {
  const queryClient = useQueryClient();
  const [finding, setFinding] = useState(false);

  async function find() {
    setFinding(true);
    const res = await fillApplyNotesAction(jobId);
    setFinding(false);
    if (!res.ok) return void toast.error(res.error);
    await queryClient.invalidateQueries({ queryKey: ["job", jobId] });
    if (res.notes.length) toast.success("Found instructions on how to apply");
    else toast.message("The posting has no special instructions on how to apply");
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      loading={finding}
      onClick={() => void find()}
      title="Reads the posting text saved with this job, so it works even if the posting was taken down"
    >
      <Sparkles />
      Check the posting for how to apply
    </Button>
  );
}
