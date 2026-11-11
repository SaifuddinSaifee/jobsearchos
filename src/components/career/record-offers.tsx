"use client";

import { useQueryClient } from "@tanstack/react-query";
import { BookmarkPlus, ChevronDown, CircleCheck, ClipboardCheck, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { addDocumentsAction, setRecordChoiceAction } from "@/app/(app)/library/record/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapse } from "@/components/ui/collapse";
import type { DocumentOffer } from "@/lib/career/offer";
import { describeSummary } from "@/lib/career/offer-summary";
import { KIND_LABELS } from "@/lib/documents/types";
import { cn } from "@/lib/utils";
import { CAREER_STATUS_KEY } from "./use-career-status";
import { DOCUMENT_OFFER_KEY } from "./use-document-offer";

type NewOffer = Extract<DocumentOffer, { state: "new" }>;

/**
 * Resumes and cover letters that are not in the career record and would add something to it, with what each would
 * add (worked out without AI). The user ticks the ones that belong in the record: Add puts them in as suggested, one
 * after another; Review shows each for review first. Documents set to "never" are listed apart, to ask again.
 */
export function RecordOffers({
  offers,
  recordExists,
  handled,
}: {
  offers: NewOffer[];
  recordExists: boolean;
  /** Resumes and cover letters with nothing to choose: in the record (or adding nothing new), or left out in review. */
  handled: { inRecord: number; leftOut: number };
}) {
  const router = useRouter();
  const client = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<"add" | "review" | string | null>(null);
  const [showNever, setShowNever] = useState(false);

  const open = offers.filter((o) => o.choice !== "never");
  const never = offers.filter((o) => o.choice === "never");
  const chosen = open.filter((o) => selected.has(o.documentId)).map((o) => o.documentId);
  const all = open.length > 0 && chosen.length === open.length;

  const refresh = async () => {
    await Promise.all([client.invalidateQueries({ queryKey: CAREER_STATUS_KEY }), client.invalidateQueries({ queryKey: DOCUMENT_OFFER_KEY })]);
    router.refresh();
  };

  async function add(autoApply: boolean) {
    setBusy(autoApply ? "add" : "review");
    try {
      const res = await addDocumentsAction(chosen, autoApply);
      if (!res.ok) return void toast.error(res.error);
      const n = res.queued + res.open;
      if (n === 0) toast.success("Those are already in your record");
      else toast.success(autoApply ? `Adding ${n === 1 ? "1 document" : `${n} documents`} to your record` : `${n === 1 ? "1 document" : `${n} documents`} queued for review`);
      setSelected(new Set());
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  async function choose(documentId: string, choice: "never" | null) {
    setBusy(documentId);
    try {
      const res = await setRecordChoiceAction(documentId, choice);
      if (!res.ok) return void toast.error(res.error);
      setSelected((s) => {
        const next = new Set(s);
        next.delete(documentId);
        return next;
      });
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  const toggle = (id: string, on: boolean) =>
    setSelected((s) => {
      const next = new Set(s);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  if (offers.length === 0) {
    const total = handled.inRecord + handled.leftOut;
    return (
      <p className="flex items-start gap-2 rounded-lg border border-dashed px-4 py-3 text-sm text-muted-foreground animate-in fade-in duration-300 motion-reduce:animate-none">
        <CircleCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          {!recordExists && total === 0
            ? "Add a resume or cover letter to the Library first. It will be listed here to choose for your record."
            : `Nothing new to add. ${
                handled.leftOut === 0
                  ? total === 1
                    ? "Your one document is in your record."
                    : `All ${total} of your resumes and cover letters are in your record.`
                  : `Of your ${total} resumes and cover letters, ${handled.inRecord} ${handled.inRecord === 1 ? "is" : "are"} in your record and ${handled.leftOut} ${handled.leftOut === 1 ? "was" : "were"} left out.`
              } A document that would add something new shows up here.`}
        </span>
      </p>
    );
  }

  return (
    <section aria-labelledby="offers-heading" className="space-y-3 rounded-lg border p-4 animate-in fade-in slide-in-from-bottom-1 duration-300 motion-reduce:animate-none">
      <div className="space-y-1">
        <h3 id="offers-heading" className="text-sm font-medium">
          Not in your record <span className="ml-1 text-xs tabular-nums text-muted-foreground">{open.length}</span>
        </h3>
        <p className="text-sm text-muted-foreground">
          {open.length > 0
            ? "Choose what belongs in your record. These counts come from comparing words, so nothing has been sent to the AI; only the documents you add are."
            : "Everything else is in your record, or adds nothing new to it."}
        </p>
      </div>

      {open.length > 0 && (
        <>
          <label className="flex w-fit cursor-pointer items-center gap-2 text-sm">
            <Checkbox
              checked={all}
              indeterminate={chosen.length > 0 && !all}
              onCheckedChange={(on) => setSelected(on ? new Set(open.map((o) => o.documentId)) : new Set())}
            />
            Select all
          </label>
          <ul className="divide-y rounded-lg border">
            {open.map((o) => (
              <OfferRow key={o.documentId} offer={o} checked={selected.has(o.documentId)} onCheck={(on) => toggle(o.documentId, on)}>
                <Button size="xs" variant="ghost" loading={busy === o.documentId} disabled={busy !== null} onClick={() => choose(o.documentId, "never")}>
                  Never
                </Button>
              </OfferRow>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-2">
            <Button loading={busy === "add"} disabled={chosen.length === 0 || busy !== null} onClick={() => add(true)}>
              <BookmarkPlus aria-hidden />
              {chosen.length > 0 ? `Add ${chosen.length} to record` : "Add to record"}
            </Button>
            <Button variant="outline" loading={busy === "review"} disabled={chosen.length === 0 || busy !== null} onClick={() => add(false)}>
              <ClipboardCheck aria-hidden />
              Review each first
            </Button>
          </div>
        </>
      )}

      {never.length > 0 && (
        <div className="space-y-2">
          <Button size="xs" variant="ghost" aria-expanded={showNever} onClick={() => setShowNever((v) => !v)}>
            <ChevronDown className={cn("transition-transform duration-200 motion-reduce:transition-none", showNever && "rotate-180")} aria-hidden />
            {never.length} set to never be added
          </Button>
          <Collapse open={showNever}>
            <ul className="divide-y rounded-lg border">
              {never.map((o) => (
                <OfferRow key={o.documentId} offer={o}>
                  <Button size="xs" variant="ghost" loading={busy === o.documentId} disabled={busy !== null} onClick={() => choose(o.documentId, null)}>
                    <RotateCcw aria-hidden />
                    Ask again
                  </Button>
                </OfferRow>
              ))}
            </ul>
          </Collapse>
        </div>
      )}
    </section>
  );
}

function OfferRow({
  offer,
  checked,
  onCheck,
  children,
}: {
  offer: NewOffer;
  checked?: boolean;
  onCheck?: (on: boolean) => void;
  children: React.ReactNode;
}) {

  const id = `offer-${offer.documentId}`;
  return (
    <li className={cn("flex items-start gap-3 px-3 py-2.5 text-sm transition-colors duration-150 hover:bg-muted/40", checked && "bg-muted/50")}>
      {onCheck && <Checkbox className="mt-0.5" checked={checked} onCheckedChange={onCheck} aria-labelledby={id} />}
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <Link id={id} href={`/library/${offer.documentId}`} className="truncate font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">
            {offer.title}
          </Link>
          <Badge variant="outline">{KIND_LABELS[offer.kind]}</Badge>
          {offer.isBase && <Badge variant="secondary">Base</Badge>}
          {offer.choice === "later" && <Badge variant="outline">Not now</Badge>}
        </div>
        <p className="text-muted-foreground">
          {describeSummary(offer.summary, offer.kind)}
        </p>
      </div>
      <div className="shrink-0">{children}</div>
    </li>
  );
}
