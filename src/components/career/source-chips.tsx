"use client";

import { FileText, Globe, UserRound } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { SourceRef } from "@/lib/career/schema";
import type { SourceInfo } from "@/lib/career/service";

const MAX_SHOWN = 3;

function Icon({ kind }: { kind: SourceInfo["kind"] }) {
  const cls = "size-3";
  if (kind === "linkedin") return <Globe className={cls} aria-hidden />;
  if (kind === "profile") return <UserRound className={cls} aria-hidden />;
  return <FileText className={cls} aria-hidden />;
}

/** Where a thing in the record came from: the documents (and the Profile or LinkedIn) that said it. */
export function SourceChips({ sources, info }: { sources: SourceRef[]; info: Record<string, SourceInfo> }) {
  const seen = [...new Set(sources.map((s) => s.sourceId))].map((id) => info[id]).filter(Boolean);
  if (seen.length === 0) return <span className="text-xs text-muted-foreground">Added by you</span>;
  return (
    <span className="flex flex-wrap items-center gap-1">
      {seen.slice(0, MAX_SHOWN).map((s) => {
        const chip = (
          <Badge variant="outline" className="max-w-48 font-normal">
            <Icon kind={s.kind} />
            <span className="truncate">{s.label}</span>
            {s.deleted && <span className="text-muted-foreground">(deleted)</span>}
          </Badge>
        );
        return s.href ? (
          <Link key={s.label + s.href} href={s.href} className="rounded-4xl transition-opacity hover:opacity-70 focus-visible:ring-2 focus-visible:ring-ring">
            {chip}
          </Link>
        ) : (
          <span key={s.label + s.kind}>{chip}</span>
        );
      })}
      {seen.length > MAX_SHOWN && <span className="text-xs text-muted-foreground">+{seen.length - MAX_SHOWN} more</span>}
    </span>
  );
}
