"use client";

import { ChevronDown } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapse } from "@/components/ui/collapse";
import type { ResolvedSimple } from "@/lib/career/apply";
import type { SimpleSuggestion } from "@/lib/career/proposal-schema";
import { cn } from "@/lib/utils";
import { IncludeToggle } from "./include-toggle";
import type { Decide } from "./review-employer";

type Flagged = { key: string; removedBefore: boolean; suggestion: SimpleSuggestion };

/** Skills, projects, education, certifications or achievements of a proposal: new ones first, known ones folded away. */
export function SimpleGroup<T extends Flagged>({
  title,
  items,
  decide,
  label,
  detail,
}: {
  title: string;
  items: ResolvedSimple<T>[];
  decide: Decide;
  label: (item: T) => string;
  detail?: (item: T) => ReactNode;
}) {
  const [showKnown, setShowKnown] = useState(false);
  if (items.length === 0) return null;
  const known = items.filter((i) => i.target.to === "existing");
  const fresh = items.filter((i) => i.target.to !== "existing");

  const row = (r: ResolvedSimple<T>) => (
    <li
      key={r.item.key}
      className={cn(
        "flex items-start gap-2 rounded-md px-2 py-1.5 text-sm transition-[background-color,opacity] duration-100 hover:bg-muted/60",
        !r.included && "opacity-50",
      )}
    >
      <IncludeToggle included={r.included} onChange={(v) => decide(r.item.key, { include: v })} label={label(r.item)} />
      <div className={cn("min-w-0 flex-1", !r.included && "line-through")}>
        <p>{label(r.item)}</p>
        {detail?.(r.item)}
        {r.item.removedBefore && <p className="text-xs text-muted-foreground">You removed this before, so it starts out left out.</p>}
      </div>
      {r.target.to === "existing" ? <Badge variant="secondary">Already in your record</Badge> : <Badge>New</Badge>}
    </li>
  );

  return (
    <section className="space-y-2 rounded-lg border p-4 animate-in fade-in slide-in-from-bottom-1 duration-300 motion-reduce:animate-none">
      <h3 className="text-sm font-semibold">
        {title} <span className="font-normal text-muted-foreground tabular-nums">{items.length}</span>
      </h3>
      <ul className="space-y-1">{fresh.map(row)}</ul>
      {known.length > 0 && (
        <div>
          <Button type="button" size="xs" variant="ghost" aria-expanded={showKnown} onClick={() => setShowKnown((v) => !v)}>
            <ChevronDown className={cn("transition-transform duration-200", showKnown && "rotate-180")} aria-hidden />
            {known.length} already in your record
          </Button>
          <Collapse open={showKnown}>
            <ul className="space-y-1 pt-1">{known.map(row)}</ul>
          </Collapse>
        </div>
      )}
    </section>
  );
}
