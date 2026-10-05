"use client";

import { ChevronDown, History, RotateCcw } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useNow } from "@/components/jobs/use-now";
import type { SentDTO } from "@/lib/outreach/types";
import { cn } from "@/lib/utils";

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
                      <span className="block truncate font-medium">{s.subject || "No subject"}</span>
                      <span className="block truncate text-muted-foreground">
                        To {s.contactName}, {s.toEmail}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">{now ? new Date(s.sentAt).toLocaleString() : ""}</span>
                  </button>
                  {expanded && (
                    <div className="space-y-3 border-t bg-muted/30 px-4 py-3 animate-in fade-in slide-in-from-top-1 duration-200 motion-reduce:animate-none">
                      <p className="text-sm leading-relaxed whitespace-pre-wrap">{s.body}</p>
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
