"use client";

import { BadgeCheck, ExternalLink, Mail, MailSearch, MoreHorizontal, Pencil, ShieldCheck, ShieldOff, Sparkles, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { safeHref } from "@/lib/jobs/links";
import { KIND_LABEL, type ContactDTO } from "@/lib/outreach/types";
import { cn } from "@/lib/utils";
import { EmailStatusBadge, SourceLabel, initials } from "./badges";

export type ContactAction = "edit" | "reveal" | "mark-verified" | "do-not-contact" | "allow-contact" | "remove";

export function ContactCard({
  contact,
  selected,
  busy,
  hasDomain,
  onSelect,
  onAction,
}: {
  contact: ContactDTO;
  selected: boolean;
  /** An action on this contact is running. */
  busy: boolean;
  hasDomain: boolean;
  onSelect: () => void;
  onAction: (action: ContactAction) => void;
}) {
  const blocked = contact.doNotContact;
  const linkedin = safeHref(contact.linkedinUrl);

  return (
    <div
      role="radio"
      aria-checked={selected}
      aria-disabled={blocked}
      tabIndex={blocked ? -1 : 0}
      onClick={() => !blocked && onSelect()}
      onKeyDown={(e) => {
        if (blocked || e.target !== e.currentTarget) return;
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        "group/contact relative space-y-2 rounded-xl border bg-card p-3 text-sm outline-none transition-[border-color,box-shadow,background-color,opacity,scale] duration-150",
        "focus-visible:ring-3 focus-visible:ring-ring/50",
        blocked ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:border-foreground/25 active:scale-[0.995]",
        selected && "border-primary bg-primary/5 ring-1 ring-primary",
        busy && "pointer-events-none opacity-70",
      )}
    >
      <div className="flex items-start gap-3">
        <div
          aria-hidden
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold transition-colors",
            selected && "bg-primary text-primary-foreground",
          )}
        >
          {initials(contact.name)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className={cn("font-medium", blocked && "line-through")}>{contact.name}</span>
            {contact.rank === 1 && !blocked && (
              <Badge variant="secondary" className="gap-1">
                <Sparkles className="size-3" aria-hidden /> Best match
              </Badge>
            )}
            <Badge variant="outline">{KIND_LABEL[contact.kind]}</Badge>
            {blocked && <Badge variant="destructive">Do not contact</Badge>}
          </div>
          {contact.title && <p className="text-muted-foreground">{contact.title}</p>}
          {contact.about && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground/90">{contact.about}</p>}
        </div>
        <div className="flex shrink-0 items-center" onClick={(e) => e.stopPropagation()}>
          {linkedin && (
            <a
              href={linkedin}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Open ${contact.name} on LinkedIn`}
              className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring active:scale-95"
            >
              <ExternalLink className="size-4" aria-hidden />
            </a>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={`Actions for ${contact.name}`}
              className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground outline-none transition-[background-color,color,scale] hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring active:scale-95"
            >
              <MoreHorizontal className="size-4" aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onClick={() => onAction("edit")}>
                <Pencil /> Edit details
              </DropdownMenuItem>
              {contact.email && contact.emailStatus !== "verified" && (
                <DropdownMenuItem onClick={() => onAction("mark-verified")}>
                  <BadgeCheck /> Mark as verified
                </DropdownMenuItem>
              )}
              {!contact.email && (contact.hasLookupId || Boolean(contact.linkedinUrl) || hasDomain) && (
                <DropdownMenuItem onClick={() => onAction("reveal")}>
                  <MailSearch /> Find email
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              {blocked ? (
                <DropdownMenuItem onClick={() => onAction("allow-contact")}>
                  <ShieldCheck /> Allow contact again
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onClick={() => onAction("do-not-contact")}>
                  <ShieldOff /> Do not contact
                </DropdownMenuItem>
              )}
              <DropdownMenuItem variant="destructive" onClick={() => onAction("remove")}>
                <Trash2 /> Remove
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pl-12">
        <Mail className="size-3.5 text-muted-foreground" aria-hidden />
        {contact.email ? <span className="break-all">{contact.email}</span> : <span className="text-muted-foreground">No email address yet</span>}
        <EmailStatusBadge status={contact.emailStatus} />
        {contact.confidence != null && <span className="text-xs text-muted-foreground">{contact.confidence}% confidence</span>}
        {contact.email && contact.emailSource && <span className="text-xs text-muted-foreground">{contact.emailSource}</span>}
      </div>

      {contact.reason && <p className="pl-12 text-muted-foreground">{contact.reason}</p>}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-12 text-xs text-muted-foreground">
        <SourceLabel source={contact.source} />
        {contact.sentCount > 0 && (
          <span className="font-medium text-foreground">
            Emailed {contact.sentCount} {contact.sentCount === 1 ? "time" : "times"}
          </span>
        )}
      </div>
    </div>
  );
}

export function ContactCardSkeleton() {
  return (
    <div className="space-y-2 rounded-xl border bg-card p-3" aria-hidden>
      <div className="flex gap-3">
        <div className="size-9 animate-pulse rounded-full bg-muted" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
          <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
        </div>
      </div>
      <div className="h-3 w-3/4 animate-pulse rounded bg-muted" />
    </div>
  );
}
