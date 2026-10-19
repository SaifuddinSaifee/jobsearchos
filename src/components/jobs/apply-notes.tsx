"use client";

import { useQueryClient } from "@tanstack/react-query";
import { CalendarClock, ClipboardList, ExternalLink, Info, Mail, Paperclip, Send, Sparkles, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { fillApplyNotesAction } from "@/app/(app)/jobs/actions";
import { Button } from "@/components/ui/button";
import { applyNoteHref } from "@/lib/jobs/links";
import type { ApplyNote, ApplyNoteKind } from "@/lib/jobs/schema";

export const APPLY_NOTE_KIND: Record<ApplyNoteKind, { label: string; Icon: LucideIcon }> = {
  where: { label: "Where to apply", Icon: Send },
  include: { label: "Include", Icon: Paperclip },
  deadline: { label: "Deadline", Icon: CalendarClock },
  other: { label: "Note", Icon: Info },
};

/** Where to apply first, then what to send, deadlines and the rest. */
const ORDER: ApplyNoteKind[] = ["where", "include", "deadline", "other"];

const LINK_CLASS =
  "inline-flex items-center gap-1 font-medium break-all underline decoration-foreground/30 underline-offset-2 transition-colors hover:decoration-foreground";

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
  if (at >= 0) {
    return (
      <>
        {text.slice(0, at)}
        <a {...props} className={LINK_CLASS}>
          <Icon className="size-3.5 shrink-0" aria-hidden />
          {raw}
        </a>
        {text.slice(at + raw.length)}
      </>
    );
  }
  return (
    <>
      {text}{" "}
      <a {...props} className={LINK_CLASS}>
        <Icon className="size-3.5 shrink-0" aria-hidden />
        {target.email ? raw : `Open ${new URL(target.href).hostname.replace(/^www\./, "")}`}
      </a>
    </>
  );
}

/**
 * The posting's instructions on how to apply, shown next to the apply links so they are read before applying: a
 * posting that says "apply through this form, not here" makes the usual apply button the wrong one.
 */
export function ApplyNotesCallout({ notes }: { notes: ApplyNote[] }) {
  if (!notes.length) return null;
  const sorted = [...notes].sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
  return (
    <section
      aria-labelledby="how-to-apply"
      className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm animate-in fade-in slide-in-from-top-1 duration-200 motion-reduce:animate-none"
    >
      <h3 id="how-to-apply" className="flex items-center gap-1.5 font-medium">
        <ClipboardList className="size-4 text-amber-600 dark:text-amber-400" aria-hidden />
        How to apply
      </h3>
      <ul className="mt-2 space-y-1.5">
        {sorted.map((n, i) => {
          const { label, Icon } = APPLY_NOTE_KIND[n.kind];
          return (
            <li key={i} className="flex gap-2">
              <Icon className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
              <span>
                <span className="font-medium">{label}:</span> <NoteText text={n.text} link={n.link} />
              </span>
            </li>
          );
        })}
      </ul>
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
