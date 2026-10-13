"use client";

import { ChevronDown, ExternalLink, FileText, History, LibraryBig, Paperclip, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useNow } from "@/components/jobs/use-now";
import { formatBytes, type SentDTO } from "@/lib/outreach/types";
import { cn } from "@/lib/utils";
import { EmailBodyView } from "./email-body-view";

export function SentHistory({ sent, busyId, onReuse }: { sent: SentDTO[]; busyId: string | null; onReuse: (id: string) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const now = useNow();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <History className="size-4" aria-hidden /> Sent for this job
          {sent.length > 0 && <span className="text-sm font-normal text-muted-foreground">{sent.length}</span>}
        </CardTitle>
        <CardDescription>Every email sent from here, with the Gmail thread it belongs to.</CardDescription>
      </CardHeader>
      <CardContent>
        {sent.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing sent yet.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {sent.map((s) => {
              const expanded = open === s.id;
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    aria-expanded={expanded}
                    onClick={() => setOpen(expanded ? null : s.id)}
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                  >
                    <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform duration-200", expanded && "rotate-180")} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 font-medium">
                        <span className="truncate">{s.subject || "No subject"}</span>
                        {s.attachments.length > 0 && (
                          <>
                            <Paperclip className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                            {s.attachments.length > 1 && <span className="shrink-0 text-xs font-normal text-muted-foreground" aria-hidden>{s.attachments.length}</span>}
                            <span className="sr-only">
                              {s.attachments.length === 1 ? "Has an attachment" : `Has ${s.attachments.length} attachments`}: {s.attachments.map((a) => a.name).join(", ")}
                            </span>
                          </>
                        )}
                      </span>
                      <span className="block truncate text-muted-foreground">
                        To {s.contactName}, {s.toEmail}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">{now ? new Date(s.sentAt).toLocaleString() : ""}</span>
                  </button>
                  {expanded && (
                    <div className="space-y-3 border-t bg-muted/30 px-4 py-3 animate-in fade-in slide-in-from-top-1 duration-200 motion-reduce:animate-none">
                      <EmailBodyView doc={s.bodyDoc} text={s.body} className="text-sm leading-relaxed" />
                      {s.attachments.length > 0 && (
                        <ul aria-label="Attachments that were sent" className="space-y-1.5">
                          {s.attachments.map((a) => (
                            <li key={a.fileId} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                              <a
                                href={`/api/files/${a.fileId}`}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex max-w-full items-center gap-2 rounded-lg border bg-background py-1.5 pr-2.5 pl-2 text-sm outline-none transition-[background-color,scale] hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98]"
                              >
                                <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                                <span className="truncate font-medium">{a.name}</span>
                                <span className="shrink-0 text-xs text-muted-foreground">{formatBytes(a.size)}</span>
                                <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                                <span className="sr-only">Open the file that was sent</span>
                              </a>
                              {a.documentId && a.versionId && (
                                <Link
                                  href={`/library/${a.documentId}?version=${a.versionId}`}
                                  className="inline-flex items-center gap-1 rounded-sm text-sm text-muted-foreground underline-offset-4 outline-none transition-colors hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                                >
                                  <LibraryBig className="size-3.5" aria-hidden />
                                  {a.version ? `Version ${a.version} in your library` : "In your library"}
                                </Link>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                      <Button size="sm" variant="outline" loading={busyId === s.id} onClick={() => onReuse(s.id)}>
                        <RotateCcw /> Use as a new draft
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
