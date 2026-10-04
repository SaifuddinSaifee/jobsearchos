"use client";

import { Download, X } from "lucide-react";
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
  onExport,
  onClear,
}: {
  count: number;
  onChangeStatus: (to: ApplicationStatus) => void;
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
        {count} job{count === 1 ? "" : "s"} selected
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
      <Button variant="ghost" size="sm" className="ml-auto" onClick={onClear}>
        <X /> Clear
      </Button>
    </div>
  );
}
