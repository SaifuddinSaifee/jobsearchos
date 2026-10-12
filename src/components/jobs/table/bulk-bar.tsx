"use client";

import { Download, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ApplicationStatus } from "@/lib/jobs/status";
import { StatusItems } from "./status-menu";

export function BulkBar({
  count,
  onChangeStatus,
  onDelete,
  onExport,
  onClear,
}: {
  count: number;
  onChangeStatus: (to: ApplicationStatus) => void;
  onDelete: () => void;
  onExport: () => void;
  onClear: () => void;
}) {
  return (
    <div
      role="region"
      aria-label="Bulk actions"
      className="flex items-center gap-2 rounded-lg border bg-muted/50 px-3 py-2 text-sm"
    >
      <span className="font-medium">
        <span key={count} className="inline-block tabular-nums animate-in fade-in slide-in-from-bottom-1 duration-150 motion-reduce:animate-none">
          {count}
        </span>{" "}
        job{count === 1 ? "" : "s"} selected
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>Change status</DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48">
          <StatusItems onSelect={onChangeStatus} />
        </DropdownMenuContent>
      </DropdownMenu>
      <Button variant="outline" size="sm" onClick={onExport}>
        <Download /> Export selected
      </Button>
      <Button variant="destructive" size="sm" onClick={onDelete}>
        <Trash2 /> Delete
      </Button>
      <Button variant="ghost" size="sm" className="ml-auto" onClick={onClear}>
        <X /> Clear
      </Button>
    </div>
  );
}
