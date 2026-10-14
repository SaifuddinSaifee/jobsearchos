"use client";

import { AlertTriangle, FileText, ImageIcon, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { SendWarning } from "@/lib/outreach/checks";
import { formatBytes, type ContactDTO, type DraftAttachmentDTO } from "@/lib/outreach/types";
import type { EmailDoc } from "@/lib/outreach/body";
import { EmailStatusBadge } from "./badges";
import { EmailBodyView } from "./email-body-view";

/** The last look before an email goes out: exactly who gets what, from which address, and anything worth a second thought. */
export function SendDialog({
  open,
  contact,
  from,
  subject,
  body,
  bodyDoc,
  attachments,
  preparing,
  warnings,
  sentToday,
  dailyCap,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  open: boolean;
  contact: ContactDTO | null;
  from: string;
  subject: string;
  body: string;
  bodyDoc: EmailDoc;
  /** In the order they go out. */
  attachments: DraftAttachmentDTO[];
  /** The PDFs are being made. */
  preparing: boolean;
  warnings: SendWarning[];
  sentToday: number;
  dailyCap: number;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Send this email?</DialogTitle>
          <DialogDescription>It goes out immediately from your Gmail and cannot be recalled.</DialogDescription>
        </DialogHeader>

        <dl className="grid grid-cols-[4rem_1fr] gap-x-3 gap-y-2 text-sm">
          <dt className="text-muted-foreground">From</dt>
          <dd className="break-all font-medium">{from}</dd>
          <dt className="text-muted-foreground">To</dt>
          <dd className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{contact?.name}</span>
            <span className="break-all">{contact?.email}</span>
            {contact && <EmailStatusBadge status={contact.emailStatus} />}
          </dd>
          <dt className="text-muted-foreground">Subject</dt>
          <dd className="font-medium">{subject}</dd>
          <dt className="text-muted-foreground">Attached</dt>
          <dd className="min-w-0">
            {preparing ? (
              <span className="inline-flex items-center gap-2 text-muted-foreground" aria-live="polite">
                <Loader2 className="size-4 animate-spin" aria-hidden /> Getting the {attachments.length === 1 ? "attachment" : "attachments"} ready...
              </span>
            ) : attachments.length > 0 ? (
              <ul className="space-y-1 animate-in fade-in duration-200 motion-reduce:animate-none">
                {attachments.map((a) => {
                  const Icon = a.mime.startsWith("image/") ? ImageIcon : FileText;
                  return (
                    <li key={a.documentId ?? a.fileId} className="flex min-w-0 items-center gap-2">
                      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="truncate font-medium">{a.name}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {[a.source === "pdf" && a.size !== null ? `made from your ${a.docKind === "cover_letter" ? "cover letter" : "resume"}` : null, formatBytes(a.size), a.pages ? `${a.pages} ${a.pages === 1 ? "page" : "pages"}` : null]
                          .filter(Boolean)
                          .join(", ")}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <span className="text-muted-foreground">Nothing attached</span>
            )}
          </dd>
        </dl>

        <EmailBodyView doc={bodyDoc} text={body} className="max-h-64 overflow-y-auto rounded-lg border bg-muted/40 p-3 text-sm leading-relaxed" />

        {warnings.length > 0 && (
          <ul className="space-y-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm" aria-label="Warnings">
            {warnings.map((w) => (
              <li key={w.code} className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
                {w.message}
              </li>
            ))}
          </ul>
        )}

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <DialogFooter className="items-center sm:justify-between">
          <span className="text-xs text-muted-foreground">
            {sentToday} of {dailyCap} sent today
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={busy}>
              Back to editing
            </Button>
            <Button onClick={onConfirm} loading={busy} disabled={preparing}>
              <Send /> {warnings.length > 0 ? "Send anyway" : "Send email"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
