"use client";

import { ChevronDown } from "lucide-react";
import { Fragment } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { STATUSES, statusInfo, type ApplicationStatus } from "@/lib/jobs/status";
import { cn } from "@/lib/utils";

/** Status badge that is also a menu to change the status. */
export function StatusMenu({
  status,
  onChange,
  disabled,
}: {
  status: ApplicationStatus;
  onChange: (to: ApplicationStatus) => void;
  disabled?: boolean;
}) {
  const info = statusInfo(status);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        aria-label={`Status: ${info.label}. Change status`}
        className={cn(
          "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap outline-none transition-[opacity,box-shadow] hover:opacity-80 active:scale-95 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
          info.tone,
        )}
      >
        {info.label}
        <ChevronDown className="size-3 opacity-60 transition-transform duration-200 in-aria-expanded:rotate-180" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        <DropdownMenuRadioGroup value={status} onValueChange={(v) => onChange(v as ApplicationStatus)}>
          {STATUSES.map((s, i) => (
            <Fragment key={s.value}>
              {i > 0 && STATUSES[i - 1].group !== s.group && <DropdownMenuSeparator />}
              <DropdownMenuRadioItem value={s.value}>{s.label}</DropdownMenuRadioItem>
            </Fragment>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Plain menu items for "move to…" lists (row actions, bulk bar). */
export function StatusItems({ onSelect }: { onSelect: (to: ApplicationStatus) => void }) {
  return (
    <>
      {STATUSES.map((s, i) => (
        <Fragment key={s.value}>
          {i > 0 && STATUSES[i - 1].group !== s.group && <DropdownMenuSeparator />}
          <DropdownMenuItem onClick={() => onSelect(s.value)}>{s.label}</DropdownMenuItem>
        </Fragment>
      ))}
    </>
  );
}
