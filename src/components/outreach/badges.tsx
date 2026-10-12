import { BadgeCheck, CircleAlert, CircleDashed, CircleHelp, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { STATUS_LABEL, type ContactSource, type EmailStatus } from "@/lib/outreach/types";
import { cn } from "@/lib/utils";

const TONE: Record<EmailStatus, { icon: typeof BadgeCheck; className: string }> = {
  verified: { icon: BadgeCheck, className: "bg-green-500/10 text-green-700 dark:text-green-400" },
  risky: { icon: ShieldAlert, className: "bg-amber-500/10 text-amber-700 dark:text-amber-400" },
  unverified: { icon: CircleHelp, className: "bg-muted text-muted-foreground" },
  invalid: { icon: CircleAlert, className: "bg-destructive/10 text-destructive" },
  none: { icon: CircleDashed, className: "bg-muted text-muted-foreground" },
};

/** Whether an address can be trusted to arrive, in words and colour (never colour alone). */
export function EmailStatusBadge({ status, className }: { status: EmailStatus; className?: string }) {
  const { icon: Icon, className: tone } = TONE[status];
  return (
    <Badge variant="ghost" className={cn("gap-1 transition-colors", tone, className)}>
      <Icon className="size-3" aria-hidden />
      {STATUS_LABEL[status]}
    </Badge>
  );
}

const SOURCE_LABEL: Record<ContactSource, string> = {
  posting: "Named in the posting",
  yc: "From Y Combinator",
  web: "Found on the web",
  prospeo: "From Prospeo",
  manual: "Added by you",
};

export function SourceLabel({ source }: { source: ContactSource }) {
  return <span>{SOURCE_LABEL[source]}</span>;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}
