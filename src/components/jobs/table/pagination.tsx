"use client";

import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";

export const PAGE_SIZES = [25, 50, 100] as const;

export function Pagination({
  pageIndex,
  pageCount,
  pageSize,
  total,
  selected,
  onPage,
  onPageSize,
}: {
  pageIndex: number;
  pageCount: number;
  pageSize: number;
  total: number;
  selected: number;
  onPage: (index: number) => void;
  onPageSize: (size: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
      <span>
        {selected} of {total} row{total === 1 ? "" : "s"} selected
      </span>
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2">
          Rows per page
          <NativeSelect
            size="sm"
            className="w-auto"
            value={pageSize}
            onChange={(e) => onPageSize(Number(e.target.value))}
          >
            {PAGE_SIZES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </NativeSelect>
        </label>
        <span>
          Page {Math.min(pageIndex + 1, Math.max(pageCount, 1))} of {Math.max(pageCount, 1)}
        </span>
        <div className="flex gap-1">
          <Button variant="outline" size="sm" onClick={() => onPage(pageIndex - 1)} disabled={pageIndex <= 0}>
            Previous
          </Button>
          <Button variant="outline" size="sm" onClick={() => onPage(pageIndex + 1)} disabled={pageIndex + 1 >= pageCount}>
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
