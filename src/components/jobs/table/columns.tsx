"use client";
"use no memo"; // header/cell fns read mutable table state through stable objects; the compiler would cache them

import { createColumnHelper, type Column } from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown, StickyNote } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { annualSalary, formatDate, formatSalary, relativeDays } from "@/lib/jobs/format";
import { sourceLabel } from "@/lib/jobs/links";
import { statusRank } from "@/lib/jobs/status";
import type { JobRow } from "@/lib/jobs/types";
import { useJobsActions } from "./context";
import type { JobsTableFeatures } from "./features";
import { JobLinks } from "./job-links";
import { RowActions } from "./row-actions";
import { StatusMenu } from "./status-menu";

const col = createColumnHelper<JobsTableFeatures, JobRow>();

const REMOTE_LABEL: Record<string, string> = { remote: "Remote", hybrid: "Hybrid", onsite: "On-site" };

function SortHeader<V>({ column, title }: { column: Column<JobsTableFeatures, JobRow, V>; title: string }) {
  const sorted = column.getIsSorted();
  const Icon = sorted === "asc" ? ArrowUp : sorted === "desc" ? ArrowDown : ArrowUpDown;
  return (
    <button
      type="button"
      // Two states (asc/desc), starting in the column's natural direction; no "unsorted" step.
      onClick={() => column.toggleSorting(sorted ? sorted === "asc" : Boolean(column.columnDef.sortDescFirst))}
      className="group/sort -ml-2 inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={`Sort by ${title}`}
    >
      {title}
      <Icon className={sorted ? "size-3.5" : "size-3.5 opacity-40 transition-opacity group-hover/sort:opacity-80"} />
    </button>
  );
}

function TitleCell({ job }: { job: JobRow }) {
  const { openJob } = useJobsActions();
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            onClick={() => openJob(job.jobId)}
            className="block max-w-[13rem] truncate text-left font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          />
        }
      >
        {job.title}
      </TooltipTrigger>
      <TooltipContent>{job.title}</TooltipContent>
    </Tooltip>
  );
}

function StatusCell({ job }: { job: JobRow }) {
  const { changeStatus } = useJobsActions();
  return <StatusMenu status={job.status} onChange={(to) => changeStatus([job.applicationId], to)} />;
}

function AppliedCell({ job }: { job: JobRow }) {
  const { now } = useJobsActions();
  if (!job.appliedAt) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="leading-tight whitespace-nowrap">
      {formatDate(job.appliedAt)}
      {now && <div className="text-xs text-muted-foreground">{relativeDays(job.appliedAt, now)}</div>}
    </div>
  );
}

export const columns = col.columns([
  col.display({
    id: "select",
    header: ({ table }) => (
      <Checkbox
        checked={table.getIsAllPageRowsSelected()}
        indeterminate={table.getIsSomePageRowsSelected() && !table.getIsAllPageRowsSelected()}
        onCheckedChange={(v) => table.toggleAllPageRowsSelected(!!v)}
        aria-label="Select all rows on this page"
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        checked={row.getIsSelected()}
        onCheckedChange={(v) => row.toggleSelected(!!v)}
        aria-label={`Select ${row.original.title}`}
      />
    ),
    enableSorting: false,
    enableHiding: false,
  }),
  col.accessor("company", {
    header: ({ column }) => <SortHeader column={column} title="Company" />,
    cell: ({ row }) => (
      <div className="leading-tight whitespace-nowrap">
        {row.original.company}
        <div className="text-xs text-muted-foreground">{sourceLabel(row.original.source)}</div>
      </div>
    ),
    sortFn: "text",
    meta: { label: "Company" },
  }),
  col.accessor("title", {
    header: ({ column }) => <SortHeader column={column} title="Title" />,
    cell: ({ row }) => <TitleCell job={row.original} />,
    sortFn: "text",
    enableHiding: false,
  }),
  col.accessor("location", {
    header: "Location",
    cell: ({ row }) => {
      const r = row.original;
      return (
        <div className="leading-tight">
          <div className="max-w-[9rem] truncate" title={r.location}>
            {r.location || "—"}
          </div>
          {REMOTE_LABEL[r.remoteType] && <div className="text-xs text-muted-foreground">{REMOTE_LABEL[r.remoteType]}</div>}
        </div>
      );
    },
    enableSorting: false,
  }),
  col.accessor((r) => annualSalary(r.salaryMin, r.salaryMax, r.salaryPeriod) ?? undefined, {
    id: "salary",
    header: ({ column }) => <SortHeader column={column} title="Salary" />,
    cell: ({ row }) => {
      const r = row.original;
      const text = formatSalary(r.salaryMin, r.salaryMax, r.salaryCurrency, r.salaryPeriod);
      return text ? <span className="whitespace-nowrap">{text}</span> : <span className="text-muted-foreground">—</span>;
    },
    sortFn: (a, b) => (a.getValue<number>("salary") ?? 0) - (b.getValue<number>("salary") ?? 0),
    sortUndefined: "last",
    sortDescFirst: true,
  }),
  col.accessor((r) => statusRank(r.status), {
    id: "status",
    header: ({ column }) => <SortHeader column={column} title="Status" />,
    cell: ({ row }) => <StatusCell job={row.original} />,
    sortFn: (a, b) => a.getValue<number>("status") - b.getValue<number>("status"),
    meta: { label: "Status" },
  }),
  col.accessor((r) => r.appliedAt ?? undefined, {
    id: "applied",
    header: ({ column }) => <SortHeader column={column} title="Applied" />,
    cell: ({ row }) => <AppliedCell job={row.original} />,
    sortFn: "datetime",
    sortUndefined: "last",
    sortDescFirst: true,
  }),
  col.accessor("source", {
    header: "Source",
    cell: ({ row }) => <span className="text-muted-foreground">{sourceLabel(row.original.source)}</span>,
    enableSorting: false,
  }),
  col.display({
    id: "links",
    header: "Links",
    cell: ({ row }) => <JobLinks job={row.original} />,
    enableSorting: false,
    enableHiding: false,
  }),
  col.accessor("createdAt", {
    id: "saved",
    header: ({ column }) => <SortHeader column={column} title="Saved" />,
    cell: ({ row }) => <span className="whitespace-nowrap">{formatDate(row.original.createdAt)}</span>,
    sortFn: "datetime",
    sortDescFirst: true,
    meta: { label: "Saved" },
  }),
  col.accessor((r) => r.postedAt ?? undefined, {
    id: "posted",
    header: ({ column }) => <SortHeader column={column} title="Posted" />,
    cell: ({ row }) => <span className="whitespace-nowrap">{formatDate(row.original.postedAt) || "—"}</span>,
    sortFn: "datetime",
    sortUndefined: "last",
    sortDescFirst: true,
    meta: { label: "Posted" },
  }),
  col.accessor((r) => r.employmentType ?? "", {
    id: "employment",
    header: "Type",
    cell: ({ row }) => row.original.employmentType || <span className="text-muted-foreground">—</span>,
    enableSorting: false,
    meta: { label: "Employment type" },
  }),
  col.accessor((r) => r.technologies.join(", "), {
    id: "technologies",
    header: "Technologies",
    cell: ({ row }) => {
      const t = row.original.technologies;
      if (!t.length) return <span className="text-muted-foreground">—</span>;
      return (
        <div className="flex max-w-[18rem] flex-wrap gap-1">
          {t.slice(0, 4).map((x) => (
            <Badge key={x} variant="outline">
              {x}
            </Badge>
          ))}
          {t.length > 4 && <span className="text-xs text-muted-foreground">+{t.length - 4}</span>}
        </div>
      );
    },
    enableSorting: false,
    meta: { label: "Technologies" },
  }),
  col.accessor("hasNotes", {
    id: "notes",
    header: "Notes",
    cell: ({ row }) =>
      row.original.hasNotes ? (
        <StickyNote className="size-4 text-muted-foreground" aria-label="Has notes" />
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
    enableSorting: false,
    meta: { label: "Notes" },
  }),
  col.display({
    id: "actions",
    cell: ({ row }) => <RowActions job={row.original} />,
    enableSorting: false,
    enableHiding: false,
  }),
]);

/** Columns that start hidden; the Columns menu can turn them on. */
export const DEFAULT_HIDDEN = { source: false, posted: false, employment: false, technologies: false, notes: false } as const;

export const COLUMN_LABELS: Record<string, string> = {
  company: "Company",
  location: "Location",
  salary: "Salary",
  status: "Status",
  applied: "Applied",
  source: "Source (own column)",
  saved: "Saved",
  posted: "Posted",
  employment: "Employment type",
  technologies: "Technologies",
  notes: "Notes",
};
