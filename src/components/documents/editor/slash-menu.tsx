"use client";

import { cn } from "@/lib/utils";
import type { SlashItem } from "./commands";

export type SlashListProps = {
  items: SlashItem[];
  selected: number;
  onPick: (item: SlashItem) => void;
  onHover: (index: number) => void;
};

/** The list of blocks that opens when you type a slash. Picking with the mouse must not take focus from the page. */
export function SlashList({ items, selected, onPick, onHover }: SlashListProps) {
  return (
    <div
      role="listbox"
      aria-label="Insert a block"
      className="max-h-80 w-64 origin-top-left overflow-y-auto rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 animate-in fade-in zoom-in-95 duration-150 motion-reduce:animate-none"
    >
      {items.length === 0 ? (
        <p className="px-2 py-1.5 text-sm text-muted-foreground">Nothing matches</p>
      ) : (
        items.map((item, i) => (
          <button
            key={item.id}
            type="button"
            role="option"
            aria-selected={i === selected}
            ref={(el) => {
              if (el && i === selected) el.scrollIntoView({ block: "nearest" });
            }}
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(item);
            }}
            onMouseEnter={() => onHover(i)}
            className={cn("flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm outline-none transition-colors duration-100", i === selected && "bg-muted")}
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-background text-muted-foreground">
              <item.icon className="size-4" aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="block font-medium">{item.label}</span>
              <span className="block truncate text-xs text-muted-foreground">{item.hint}</span>
            </span>
          </button>
        ))
      )}
    </div>
  );
}
