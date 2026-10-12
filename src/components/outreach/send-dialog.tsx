"use client";

import { AlertTriangle, FileText, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { SendWarning } from "@/lib/outreach/checks";
import { formatBytes, type AttachmentDTO, type ContactDTO } from "@/lib/outreach/types";
import { EmailStatusBadge } from "./badges";

/** The last look before an email goes out: exactly who gets what, from which address, and anything worth a second thought. */
export function SendDialog({
  open,
  contact,
  from,
  subject,
  body,
  attachment,
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
  attachment: AttachmentDTO | null;
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
          <dd className="flex min-w-0 items-center gap-2">
            {attachment ? (
              <>
                <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="truncate font-medium">{attachment.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{formatBytes(attachment.size)}</span>
              </>
            ) : (
              <span className="text-muted-foreground">Nothing attached</span>
            )}
          </dd>
        </dl>

        <div className="max-h-64 overflow-y-auto rounded-lg border bg-muted/40 p-3 text-sm leading-relaxed whitespace-pre-wrap">{body}</div>

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
            <Button onClick={onConfirm} loading={busy}>
              <Send /> {warnings.length > 0 ? "Send anyway" : "Send email"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
