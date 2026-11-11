"use client";

import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, BookmarkPlus, CircleCheck, ClipboardCheck, Clock, Library, Loader2, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { addOpenDocumentAction, setRecordChoiceAction } from "@/app/(app)/library/record/actions";
import { useEditorSession } from "@/components/documents/editor/session";
import { Button } from "@/components/ui/button";
import { Collapse } from "@/components/ui/collapse";
import type { DocumentOffer } from "@/lib/career/offer";
import { describeSummary } from "@/lib/career/offer-summary";
import { parseFailure } from "@/lib/career/failure";
import { cn } from "@/lib/utils";
import { CAREER_STATUS_KEY } from "./use-career-status";
import { DOCUMENT_OFFER_KEY, useDocumentOffer } from "./use-document-offer";

/** Adding the open document, with or without a review, and answering "Not now" or "Never". Shared by the card and the button. */
function useRecordActions(documentId: string) {
  const client = useQueryClient();
  const session = useEditorSession();
  const [busy, setBusy] = useState<"add" | "review" | "later" | "never" | null>(null);

  const refresh = () =>
    Promise.all([client.invalidateQueries({ queryKey: DOCUMENT_OFFER_KEY }), client.invalidateQueries({ queryKey: CAREER_STATUS_KEY })]);

  async function add(autoApply: boolean) {
    setBusy(autoApply ? "add" : "review");
    try {
      // The record gets what is on the page now, so the latest typing is saved first.
      await session?.flushRef.current?.();
      const res = await addOpenDocumentAction(documentId, autoApply);
      if (!res.ok) return void toast.error(res.error);
      if (res.skipped > 0) toast.success("This is already in your career record");
      else toast.success(autoApply ? "Adding it to your career record" : "Preparing it for your review");
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  async function choose(choice: "later" | "never" | null) {
    setBusy(choice === "never" ? "never" : "later");
    try {
      const res = await setRecordChoiceAction(documentId, choice);
      if (!res.ok) return void toast.error(res.error);
      if (choice === "never") {
        toast.success("It will not be offered to your career record again", {
          action: { label: "Undo", onClick: () => void setRecordChoiceAction(documentId, null).then(refresh) },
        });
      }
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  return { busy, add, choose };
}

/** Tells the user when an add they started has finished: added, or waiting for their review. */
function useFinishedToast(offer: DocumentOffer | undefined) {
  const router = useRouter();
  const last = useRef(offer?.state);
  useEffect(() => {
    const was = last.current;
    last.current = offer?.state;
    if (was !== "adding" || !offer) return;
    if (offer.state === "in-record" || offer.state === "nothing-new") toast.success(`${offer.title} is in your career record`);
    else if (offer.state === "review") {
      toast.success(`${offer.title} is ready to review`, {
        action: { label: "Review", onClick: () => router.push("/library/record/review") },
      });
    } else if (offer.state === "failed") toast.error(`${offer.title} could not be added to your career record`);
  }, [offer, router]);
}

/**
 * Above the page in the editor: what adding this document to the career record would bring, worked out without
 * AI, with Add (one click), Review first, Not now and Never. Only shown while there is something to decide.
 */
export function RecordOfferCard({ documentId }: { documentId: string }) {
  const { data: offer } = useDocumentOffer(documentId);
  const { busy, add, choose } = useRecordActions(documentId);
  const [shown, setShown] = useState(offer);

  const open = !!offer && ((offer.state === "new" && offer.choice === null) || offer.state === "failed");
  // Keep the last content while the card slides away, so it does not collapse to empty.
  if (open && shown !== offer) setShown(offer);
  const o = open ? offer : shown;

  return (
    <Collapse open={open}>
      {o && (o.state === "new" || o.state === "failed") && (
        <section
          aria-label="Career record"
          className={cn(
            "mb-3 rounded-lg border px-4 py-3 text-sm",
            o.state === "failed" ? "border-destructive/30 bg-destructive/5" : "bg-muted/40",
          )}
        >
          {o.state === "failed" ? (
            <div key="failed" className="flex flex-wrap items-center justify-between gap-3 animate-in fade-in duration-200 motion-reduce:animate-none">
              <p className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
                <span>Could not add this to your career record: {parseFailure(o.error).message}</span>
              </p>
              <Button size="sm" variant="outline" loading={busy === "add"} disabled={busy !== null} onClick={() => add(true)}>
                <RotateCcw aria-hidden />
                Try again
              </Button>
            </div>
          ) : (
            <div key="new" className="space-y-2.5 animate-in fade-in duration-200 motion-reduce:animate-none">
              <Summary offer={o} />
              <div className="flex flex-wrap gap-2">
                <Button size="sm" loading={busy === "add"} disabled={busy !== null} onClick={() => add(true)}>
                  <BookmarkPlus aria-hidden />
                  Add to record
                </Button>
                <Button size="sm" variant="outline" loading={busy === "review"} disabled={busy !== null} onClick={() => add(false)}>
                  <ClipboardCheck aria-hidden />
                  Review first
                </Button>
                <Button size="sm" variant="ghost" loading={busy === "later"} disabled={busy !== null} onClick={() => choose("later")}>
                  <Clock aria-hidden />
                  Not now
                </Button>
                <Button size="sm" variant="ghost" loading={busy === "never"} disabled={busy !== null} onClick={() => choose("never")}>
                  Never for this document
                </Button>
              </div>
            </div>
          )}
        </section>
      )}
    </Collapse>
  );
}

function Summary({ offer }: { offer: Extract<DocumentOffer, { state: "new" | "set-aside" }> }) {

  return (
    <div className="space-y-1">
      <p className="flex items-center gap-2 font-medium">
        <Library className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        Not in your career record yet
      </p>
      <p className="text-muted-foreground">
        {describeSummary(offer.summary, offer.kind)}
      </p>
    </div>
  );
}

/**
 * In the document header: where this document stands with the career record, and the one-click Add whenever adding
 * makes sense (including after "Not now" or "Never", which adding overrides).
 */
export function RecordButton({ documentId }: { documentId: string }) {
  const { data: offer } = useDocumentOffer(documentId);
  const { busy, add } = useRecordActions(documentId);
  useFinishedToast(offer);
  if (!offer || offer.state === "reading" || offer.state === "empty") return null;

  const key = offer.state;
  const fade = "animate-in fade-in duration-200 motion-reduce:animate-none";
  if (offer.state === "adding") {
    return (
      <span key={key} className={cn("inline-flex items-center gap-1.5 text-xs text-muted-foreground", fade)} aria-live="polite">
        <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
        {offer.autoApply ? "Adding to career record" : "Preparing for review"}
      </span>
    );
  }
  if (offer.state === "review") {
    return (
      <Button key={key} className={fade} variant="outline" size="sm" nativeButton={false} render={<Link href="/library/record/review" />}>
        <ClipboardCheck aria-hidden />
        Review for record
      </Button>
    );
  }
  if (offer.state === "in-record" || offer.state === "nothing-new") {
    return (
      <span
        key={key}
        className={cn("inline-flex items-center gap-1.5 text-xs text-muted-foreground", fade)}
        title={offer.state === "nothing-new" ? "Everything in it is already in your career record" : undefined}
      >
        <CircleCheck className="size-3.5 text-green-600 dark:text-green-400" aria-hidden />
        In career record
      </span>
    );
  }
  return (
    <Button key={key} className={fade} variant="outline" size="sm" loading={busy === "add"} disabled={busy !== null} onClick={() => add(true)}>
      <BookmarkPlus aria-hidden />
      Add to career record
    </Button>
  );
}
