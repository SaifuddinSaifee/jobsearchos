"use client";

import { Columns3, Download, Filter, Keyboard, Search, X } from "lucide-react";
import type { Ref } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { sourceLabel } from "@/lib/jobs/links";
import { SHORTCUT_HELP } from "./shortcuts";

export const REMOTE_FILTERS = ["all", "remote", "hybrid", "onsite"] as const;
export type RemoteFilter = (typeof REMOTE_FILTERS)[number];
const REMOTE_LABEL: Record<RemoteFilter, string> = {
  all: "Any location type",
  remote: "Remote",
  hybrid: "Hybrid",
  onsite: "On-site",
};

export function Toolbar({
  searchRef,
  search,
  onSearch,
  remote,
  onRemote,
  sources,
  selectedSources,
  onSources,
  columns,
  onToggleColumn,
  onExport,
  exporting,
  exportLabel,
  filtersActive,
  onClearFilters,
}: {
  searchRef: Ref<HTMLInputElement>;
  search: string;
  onSearch: (v: string) => void;
  remote: RemoteFilter;
  onRemote: (v: RemoteFilter) => void;
  sources: string[];
  selectedSources: string[];
  onSources: (v: string[]) => void;
  columns: { id: string; label: string; visible: boolean }[];
  onToggleColumn: (id: string, visible: boolean) => void;
  onExport: () => void;
  exporting: boolean;
  exportLabel: string;
  filtersActive: boolean;
  onClearFilters: () => void;
}) {
  const filterCount = (remote !== "all" ? 1 : 0) + (selectedSources.length ? 1 : 0);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative w-full max-w-xs">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={searchRef}
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search company, title, location, tech…  ( / )"
          aria-label="Search jobs"
          className="pl-8"
        />
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
          <Filter /> Filters{filterCount ? ` (${filterCount})` : ""}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Location type</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={remote} onValueChange={(v) => onRemote(v as RemoteFilter)}>
              {REMOTE_FILTERS.map((r) => (
                <DropdownMenuRadioItem key={r} value={r}>
                  {REMOTE_LABEL[r]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
          {sources.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>Source</DropdownMenuLabel>
                {sources.map((s) => (
                  <DropdownMenuCheckboxItem
                    key={s}
                    checked={selectedSources.includes(s)}
                    onCheckedChange={(on) =>
                      onSources(on ? [...selectedSources, s] : selectedSources.filter((x) => x !== s))
                    }
                  >
                    {sourceLabel(s)}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuGroup>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {filtersActive && (
        <Button variant="ghost" size="sm" onClick={onClearFilters}>
          <X /> Clear
        </Button>
      )}

      <div className="ml-auto flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
            <Columns3 /> Columns
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Show columns</DropdownMenuLabel>
              {columns.map((c) => (
                <DropdownMenuCheckboxItem
                  key={c.id}
                  checked={c.visible}
                  onCheckedChange={(on) => onToggleColumn(c.id, !!on)}
                >
                  {c.label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button variant="outline" size="sm" onClick={onExport} disabled={exporting}>
          <Download /> {exportLabel}
        </Button>

        <Dialog>
          <DialogTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Keyboard shortcuts" />}>
            <Keyboard />
          </DialogTrigger>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Keyboard shortcuts</DialogTitle>
              <DialogDescription>Active when you are not typing in a field.</DialogDescription>
            </DialogHeader>
            <dl className="space-y-2 text-sm">
              {SHORTCUT_HELP.map((s) => (
                <div key={s.keys} className="flex items-center justify-between gap-4">
                  <dt>{s.action}</dt>
                  <dd>
                    <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-xs">{s.keys}</kbd>
                  </dd>
                </div>
              ))}
            </dl>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
