"use client";

import { AlertTriangle, CircleAlert, CircleCheck, Eye, Loader2, Pencil, PenLine, Send } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { ColdEmailSettings } from "@/lib/email/settings-schema";
import { checkEmail, wordCount } from "@/lib/outreach/checks";
import { KIND_LABEL, type DraftAttachmentDTO, type ContactDTO, MAX_BODY, MAX_SUBJECT, type ResumeOption } from "@/lib/outreach/types";
import { cn } from "@/lib/utils";
import { AttachmentPicker } from "./attachment-picker";
import { EmailStatusBadge, initials } from "./badges";

export type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

function Row({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("grid grid-cols-[3.5rem_1fr] items-center gap-2 border-b px-4 py-2 text-sm", className)}>
      <span className="text-muted-foreground">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Why Send is unavailable, in words, or null when it is allowed. Mirrors the rules the server enforces. */
export function sendBlocker(args: {
  account: { email: string; needsReconnect: boolean } | null;
  contact: ContactDTO | null;
  errors: string[];
  sentToday: number;
  settings: ColdEmailSettings;
}): { text: string; href?: string } | null {
  const { account, contact, errors, sentToday, settings } = args;
  if (!account) return { text: "Connect Gmail to send.", href: "/settings?tab=email" };
  if (account.needsReconnect) return { text: "Gmail needs to be reconnected.", href: "/settings?tab=email" };
  if (!contact) return { text: "Choose who to send this to." };
  if (contact.doNotContact) return { text: `${contact.name} is marked do not contact.` };
  if (!contact.email) return { text: `${contact.name} has no email address yet.` };
  if (contact.emailStatus === "invalid") return { text: `${contact.email} is not a working address.` };
  if (errors.length > 0) return { text: errors[0] };
  if (sentToday >= settings.dailyCap) return { text: `Daily limit of ${settings.dailyCap} emails reached.` };
  return null;
}

export function Composer({
  jobId,
  account,
  contact,
  resumes,
  attachment,
  onAttachment,
  onResumeUploaded,
  subject,
  body,
  mode,
  saveState,
  settings,
  sentToday,
  onSubject,
  onBody,
  onPasteEmail,
  onMode,
  onSend,
}: {
  jobId: string;
  account: { email: string; needsReconnect: boolean } | null;
  contact: ContactDTO | null;
  resumes: ResumeOption[];
  /** The attached resume, or null for none. */
  attachment: DraftAttachmentDTO | null;
  onAttachment: (documentId: string | null) => void;
  onResumeUploaded: (resume: ResumeOption) => void;
  subject: string;
  body: string;
  mode: "write" | "preview";
  saveState: SaveState;
  settings: ColdEmailSettings;
  sentToday: number;
  onSubject: (v: string) => void;
  onBody: (v: string) => void;
  /** Called when a whole email with a "Subject:" line is pasted into an empty composer. */
  onPasteEmail: (subject: string, body: string) => void;
  onMode: (m: "write" | "preview") => void;
  onSend: () => void;
}) {
  const checks = useMemo(() => checkEmail({ subject, body }, settings), [subject, body, settings]);
  const errors = checks.filter((c) => c.level === "error");
  const blocker = sendBlocker({ account, contact, errors: errors.map((e) => e.message), sentToday, settings });
  const words = wordCount(body);
  const outOfRange = body.trim() !== "" && (words < settings.minWords || words > settings.maxWords);
  const empty = !subject.trim() && !body.trim();

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2">
          <PenLine className="size-4" aria-hidden /> Email
        </CardTitle>
        <div role="group" aria-label="Editor mode" className="flex rounded-lg border p-0.5">
          {(
            [
              ["write", "Write", Pencil],
              ["preview", "Preview", Eye],
            ] as const
          ).map(([value, label, Icon]) => (
            <Button key={value} type="button" size="xs" variant={mode === value ? "secondary" : "ghost"} aria-pressed={mode === value} onClick={() => onMode(value)}>
              <Icon /> {label}
            </Button>
          ))}
        </div>
      </CardHeader>

      <CardContent className="p-0">
        <div className="border-y">
          <Row label="From">
            {account && !account.needsReconnect ? (
              <span className="font-medium">{account.email}</span>
            ) : (
              <Link href="/settings?tab=email" className="text-destructive underline-offset-4 hover:underline">
                {account ? "Reconnect Gmail to send" : "Connect Gmail to send"}
              </Link>
            )}
          </Row>
          <Row label="To">
            {contact ? (
              <div key={contact.id} className="flex flex-wrap items-center gap-2 animate-in fade-in duration-200 motion-reduce:animate-none">
                <span aria-hidden className="flex size-6 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">
                  {initials(contact.name)}
                </span>
                <span className="font-medium">{contact.name}</span>
                <span className="text-muted-foreground">{KIND_LABEL[contact.kind]}</span>
                {contact.email ? <span className="break-all">{contact.email}</span> : <span className="text-destructive">no email yet</span>}
                <EmailStatusBadge status={contact.emailStatus} />
              </div>
            ) : (
              <span className="text-muted-foreground">Choose someone from the list.</span>
            )}
          </Row>
          <Row label="Attach" className="items-start">
            <AttachmentPicker jobId={jobId} resumes={resumes} selected={attachment} onSelect={onAttachment} onUploaded={onResumeUploaded} />
          </Row>
          <Row label="Subject" className="border-b-0 py-1.5">
            {mode === "write" ? (
              <Input
                value={subject}
                maxLength={MAX_SUBJECT}
                onChange={(e) => onSubject(e.target.value)}
                placeholder="A short, specific subject"
                aria-label="Subject"
                className="h-8 border-0 bg-transparent px-0 font-medium shadow-none focus-visible:ring-0 dark:bg-transparent"
              />
            ) : (
              <span className="font-medium">{subject || <span className="text-muted-foreground">No subject</span>}</span>
            )}
          </Row>
        </div>

        <div className="p-4">
          {mode === "write" ? (
            <Textarea
              value={body}
              maxLength={MAX_BODY}
              onChange={(e) => onBody(e.target.value)}
              onPaste={(e) => {
                const text = e.clipboardData.getData("text");
                const m = /^\s*subject:[ \t]*(.+)\r?\n+([\s\S]*)$/i.exec(text);
                if (m && empty) {
                  e.preventDefault();
                  onPasteEmail(m[1].trim(), m[2].trim());
                }
              }}
              placeholder={"Paste the email from your workflow here.\nA first line starting with \"Subject:\" fills the subject for you."}
              aria-label="Email body"
              className="min-h-72 resize-y text-sm leading-relaxed"
            />
          ) : (
            <div className="min-h-72 rounded-lg bg-muted/40 p-4 text-sm leading-relaxed whitespace-pre-wrap">
              {body.trim() ? body : <span className="text-muted-foreground">Nothing written yet.</span>}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t px-4 py-2 text-xs text-muted-foreground">
          <span className={cn("transition-colors", outOfRange && "font-medium text-amber-700 dark:text-amber-400")}>
            {words} {words === 1 ? "word" : "words"}
            <span className="text-muted-foreground"> (aim for {settings.minWords} to {settings.maxWords})</span>
          </span>
          <span aria-live="polite" className="ml-auto flex items-center gap-1.5">
            {saveState === "saving" && (
              <>
                <Loader2 className="size-3 animate-spin" aria-hidden /> Saving
              </>
            )}
            {saveState === "saved" && "Draft saved"}
            {saveState === "dirty" && "Unsaved changes"}
            {saveState === "error" && <span className="text-destructive">Could not save the draft</span>}
          </span>
        </div>

        {!empty && (
          <ul className="space-y-1.5 border-t px-4 py-3 text-sm" aria-label="Email checks">
            {checks.length === 0 ? (
              <li className="flex items-center gap-2 text-green-700 dark:text-green-400">
                <CircleCheck className="size-4 shrink-0" aria-hidden /> No issues found.
              </li>
            ) : (
              checks.map((c) => (
                <li key={c.code} className="flex items-start gap-2 animate-in fade-in duration-200 motion-reduce:animate-none">
                  {c.level === "error" ? (
                    <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
                  ) : (
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
                  )}
                  <span>
                    <span className="sr-only">{c.level === "error" ? "Must fix: " : "Suggestion: "}</span>
                    {c.message}
                  </span>
                </li>
              ))
            )}
          </ul>
        )}

        <div className="flex flex-wrap items-center gap-3 border-t bg-muted/30 px-4 py-3">
          <Button onClick={onSend} disabled={blocker !== null}>
            <Send /> {contact ? `Send to ${contact.name.split(" ")[0]}` : "Send"}
          </Button>
          <div className="text-sm text-muted-foreground">
            {blocker ? (
              blocker.href ? (
                <Link href={blocker.href} className="underline-offset-4 hover:underline">
                  {blocker.text}
                </Link>
              ) : (
                blocker.text
              )
            ) : (
              <>You will review it once more before it goes out.</>
            )}
          </div>
          <span className="ml-auto text-xs text-muted-foreground">
            {sentToday} of {settings.dailyCap} sent today
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
