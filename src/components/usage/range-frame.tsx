"use client";

import { parseAsStringLiteral, useQueryState } from "nuqs";
import { useTransition, type ReactNode } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { DEFAULT_RANGE, USAGE_RANGES } from "@/lib/usage/ranges";

const OPTIONS = [
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
] as const;

/**
 * The one filter for the page, with everything it scopes below it. The range lives in the URL, so a view can be
 * shared or reloaded. Until the new numbers arrive the old ones stay on screen, dimmed, rather than flashing a skeleton.
 */
export function RangeFrame({ children }: { children: ReactNode }) {
  const [pending, startTransition] = useTransition();
  const [range, setRange] = useQueryState("range", parseAsStringLiteral(USAGE_RANGES).withDefault(DEFAULT_RANGE).withOptions({ shallow: false, startTransition }));

  return (
    <>
      <Tabs value={range} onValueChange={(next) => setRange(next as (typeof USAGE_RANGES)[number])}>
        <TabsList aria-label="Date range">
          {OPTIONS.map((o) => (
            <TabsTrigger key={o.value} value={o.value}>
              {o.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <div aria-busy={pending} className={cn("space-y-6 transition-opacity duration-200", pending && "opacity-60")}>
        {/* Keyed on the range, so the content fades in again when it changes. */}
        <div key={range} className="animate-in space-y-6 fade-in duration-300 motion-reduce:animate-none">
          {children}
        </div>
      </div>
    </>
  );
}
