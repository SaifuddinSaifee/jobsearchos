"use client";
"use no memo";

import { useQueryClient } from "@tanstack/react-query";
import { useTable, type RowSelectionState, type SortingState, type Updater, type ColumnVisibilityState } from "@tanstack/react-table";
import Link from "next/link";
import {
  parseAsArrayOf,
  parseAsInteger,
  parseAsString,
  parseAsStringLiteral,
  useQueryState,
} from "nuqs";
import {
  useEffect,
  useMemo,
  useOptimistic,
  useRef,
  useState,
  useTransition,
} from "react";
import { toast } from "sonner";
import {
  bulkChangeStatusAction,
  changeStatusAction,
  revertStatusAction,
  setAppliedAtAction,
} from "@/app/(app)/jobs/actions";
import { Button } from "@/components/ui/button";
import { Collapse } from "@/components/ui/collapse";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { dateToStored, localToday } from "@/lib/jobs/format";
import {
  TAB_VALUES,
  statusInfo,
  tabCounts,
  tabStatuses,
  type ApplicationStatus,
  type TabValue,
  TABS,
} from "@/lib/jobs/status";
import type { JobRow, PreviousState } from "@/lib/jobs/types";
import { JobSheet } from "../job-sheet";
import { useNow } from "../use-now";
import { BulkBar } from "./bulk-bar";
import { COLUMN_LABELS, DEFAULT_HIDDEN, columns } from "./columns";
import { JobsActionsProvider } from "./context";
import { features } from "./features";
import { PAGE_SIZES, Pagination } from "./pagination";
import { keyInfoFrom, resolveShortcut } from "./shortcuts";
import { REMOTE_FILTERS, Toolbar, type RemoteFilter } from "./toolbar";

const SORTABLE = ["company", "title", "salary", "status", "applied", "saved", "posted"];
const COLUMNS_KEY = "jobs.columns.v1";

type Patch =
  | { type: "status"; ids: string[]; to: ApplicationStatus; appliedDate?: string }
  | { type: "revert"; previous: PreviousState[] }
  | { type: "appliedAt"; applicationId: string; date: string };

function reduce(rows: JobRow[], p: Patch): JobRow[] {
  const nowIso = new Date().toISOString();
  switch (p.type) {
    case "status": {
      const ids = new Set(p.ids);
      return rows.map((r) =>
        ids.has(r.applicationId)
          ? {
              ...r,
              status: p.to,
              lastChangeAt: nowIso,
              appliedAt:
                p.to === "applied" && !r.appliedAt
                  ? p.appliedDate
                    ? dateToStored(p.appliedDate).toISOString()
                    : nowIso
                  : r.appliedAt,
            }
          : r,
      );
    }
    case "revert": {
      const by = new Map(p.previous.map((x) => [x.applicationId, x]));
      return rows.map((r) => {
        const x = by.get(r.applicationId);
        return x ? { ...r, status: x.status, appliedAt: x.appliedAt } : r;
      });
    }
    case "appliedAt":
      return rows.map((r) =>
        r.applicationId === p.applicationId ? { ...r, appliedAt: dateToStored(p.date).toISOString() } : r,
      );
  }
}

function parseSort(param: string): SortingState | null {
  const [id, dir] = param.split(".");
  if (!SORTABLE.includes(id) || (dir !== "asc" && dir !== "desc")) return null;
  return [{ id, desc: dir === "desc" }];
}

function defaultSort(tab: TabValue): SortingState {
  return [{ id: tab === "applied" ? "applied" : "saved", desc: true }];
}

function haystack(r: JobRow) {
  return `${r.company} ${r.title} ${r.location} ${r.technologies.join(" ")}`.toLowerCase();
}

export function JobsTable({ rows }: { rows: JobRow[] }) {
  const [tab, setTab] = useQueryState("tab", parseAsStringLiteral(TAB_VALUES).withDefault("active"));
  const [qUrl, setQUrl] = useQueryState("q", parseAsString.withDefault(""));
  const [sortParam, setSortParam] = useQueryState("sort", parseAsString.withDefault(""));
  const [remote, setRemote] = useQueryState("remote", parseAsStringLiteral(REMOTE_FILTERS).withDefault("all"));
  const [sourceSel, setSourceSel] = useQueryState("source", parseAsArrayOf(parseAsString).withDefault([]));
  const [sizeParam, setSizeParam] = useQueryState("size", parseAsInteger.withDefault(25));
  const [jobId, setJobId] = useQueryState("job", parseAsString.withOptions({ history: "push" }));

  const pageSize = (PAGE_SIZES as readonly number[]).includes(sizeParam) ? sizeParam : 25;
  const sorting = parseSort(sortParam) ?? defaultSort(tab);

  const [search, setSearch] = useState(qUrl);
  const [pageIndex, setPageIndex] = useState(0);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [columnVisibility, setColumnVisibility] = useState<ColumnVisibilityState>({ ...DEFAULT_HIDDEN });
  const [activeId, setActiveId] = useState<string | null>(null);
  const [focusDate, setFocusDate] = useState(false);
  const [exporting, setExporting] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const notesDirty = useRef(false);

  const [, startTransition] = useTransition();
  const [optimisticRows, applyOptimistic] = useOptimistic(rows, reduce);
  const queryClient = useQueryClient();
  const now = useNow();

  // Keep the URL's q in sync with the search box, debounced.
  useEffect(() => {
    const id = setTimeout(() => void setQUrl(search || null), 200);
    return () => clearTimeout(id);
  }, [search, setQUrl]);

  // Column visibility is a per-viewer convenience: restore it after mount, ignore storage errors.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(COLUMNS_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- restoring from localStorage can only happen after mount
      if (raw) setColumnVisibility({ ...DEFAULT_HIDDEN, ...(JSON.parse(raw) as ColumnVisibilityState) });
    } catch {}
  }, []);

  // ---- rows pipeline: tab, then filters/search, then (table) sort, then paginate -----------------------
  const counts = tabCounts(optimisticRows);
  const sources = useMemo(() => [...new Set(optimisticRows.map((r) => r.source))].sort(), [optimisticRows]);

  const filtered = useMemo(() => {
    const inTab = new Set<string>(tabStatuses(tab));
    const terms = search.toLowerCase().split(/\s+/).filter(Boolean);
    return optimisticRows.filter(
      (r) =>
        inTab.has(r.status) &&
        (remote === "all" || r.remoteType === remote) &&
        (sourceSel.length === 0 || sourceSel.includes(r.source)) &&
        terms.every((t) => haystack(r).includes(t)),
    );
  }, [optimisticRows, tab, search, remote, sourceSel]);

  const pageCount = Math.max(Math.ceil(filtered.length / pageSize), 1);
  const safePage = Math.min(pageIndex, pageCount - 1);

  function setSorting(updater: Updater<SortingState>) {
    const next = typeof updater === "function" ? updater(sorting) : updater;
    const first = next[0];
    const param = first ? `${first.id}.${first.desc ? "desc" : "asc"}` : "";
    const isDefault = first && first.id === defaultSort(tab)[0].id && first.desc;
    void setSortParam(param && !isDefault ? param : null);
    setPageIndex(0);
  }

  const table = useTable({
    features,
    data: filtered,
    columns,
    getRowId: (r) => r.applicationId,
    autoResetPageIndex: false,
    state: {
      sorting,
      pagination: { pageIndex: safePage, pageSize },
      rowSelection,
      columnVisibility,
    },
    onSortingChange: setSorting,
    onPaginationChange: () => {},
    onRowSelectionChange: setRowSelection,
    onColumnVisibilityChange: (updater) => {
      setColumnVisibility((prev) => {
        const next = typeof updater === "function" ? updater(prev) : updater;
        try {
          localStorage.setItem(COLUMNS_KEY, JSON.stringify(next));
        } catch {}
        return next;
      });
    },
  });

  const ordered = table.getPrePaginatedRowModel().rows.map((r) => r.original);
  const selectedIds = ordered.filter((r) => rowSelection[r.applicationId]).map((r) => r.applicationId);
  const filtersActive = search !== "" || remote !== "all" || sourceSel.length > 0;

  // ---- mutations: optimistic, with Undo ------------------------------------------------------
  function invalidateJobs() {
    void queryClient.invalidateQueries({ queryKey: ["job"] });
  }

  function undo(previous: PreviousState[]) {
    startTransition(async () => {
      applyOptimistic({ type: "revert", previous });
      const res = await revertStatusAction(previous);
      if (!res.ok) return void toast.error(res.error);
      invalidateJobs();
      if (res.skipped.length) {
        toast.warning(`${res.skipped.length} job${res.skipped.length === 1 ? " was" : "s were"} changed again and left as is`);
      } else {
        toast.success("Undone");
      }
    });
  }

  function changeStatus(applicationIds: string[], to: ApplicationStatus) {
    const ids = new Set(applicationIds);
    const changing = optimisticRows.filter((r) => ids.has(r.applicationId) && r.status !== to);
    const label = statusInfo(to).label;
    if (changing.length === 0) {
      toast.message(`Already ${label}`);
      return;
    }
    const target = changing.map((r) => r.applicationId);
    const appliedDate = to === "applied" ? localToday() : undefined;
    startTransition(async () => {
      applyOptimistic({ type: "status", ids: target, to, appliedDate });
      const res =
        target.length === 1
          ? await changeStatusAction(target[0], to, appliedDate)
          : await bulkChangeStatusAction(target, to, appliedDate);
      if (!res.ok) return void toast.error(res.error);
      invalidateJobs();
      if (res.previous.length === 0) return;
      const single = changing.length === 1 ? changing[0] : null;
      const title = single && single.title.length > 40 ? `${single.title.slice(0, 40)}…` : single?.title;
      toast(single ? `Moved “${title}” to ${label}` : `Moved ${changing.length} jobs to ${label}`, {
        duration: 8000,
        action: { label: "Undo", onClick: () => undo(res.previous) },
        cancel:
          single && to === "applied"
            ? { label: "Change date", onClick: () => openJob(single.jobId, true) }
            : undefined,
      });
    });
  }

  function setAppliedDate(applicationId: string, date: string) {
    startTransition(async () => {
      applyOptimistic({ type: "appliedAt", applicationId, date });
      const res = await setAppliedAtAction(applicationId, date);
      if (!res.ok) return void toast.error(res.error);
      invalidateJobs();
      toast.success("Applied date saved");
    });
  }

  // ---- navigation (panel + keyboard share these) -------------------------------------------
  function confirmDiscard(): boolean {
    return !notesDirty.current || window.confirm("You have unsaved notes. Discard them?");
  }

  function revealRow(row: JobRow) {
    setActiveId(row.applicationId);
    const idx = ordered.findIndex((r) => r.applicationId === row.applicationId);
    if (idx >= 0) setPageIndex(Math.floor(idx / pageSize));
  }

  function openJob(id: string, withDateFocus = false) {
    if (id !== jobId && !confirmDiscard()) return;
    notesDirty.current = false;
    const row = optimisticRows.find((r) => r.jobId === id);
    if (row) revealRow(row);
    setFocusDate(withDateFocus);
    void setJobId(id);
  }

  function closeJob() {
    if (!confirmDiscard()) return;
    notesDirty.current = false;
    setFocusDate(false);
    void setJobId(null);
  }

  function move(delta: 1 | -1) {
    if (ordered.length === 0) return;
    const current = ordered.findIndex((r) => r.applicationId === activeId);
    const idx = current === -1 ? (delta === 1 ? 0 : ordered.length - 1) : Math.min(Math.max(current + delta, 0), ordered.length - 1);
    const row = ordered[idx];
    if (jobId) openJob(row.jobId);
    else revealRow(row);
  }

  const jobIdx = jobId ? ordered.findIndex((r) => r.jobId === jobId) : -1;
  const neighbors = {
    prev: jobIdx > 0 ? ordered[jobIdx - 1].jobId : null,
    next: jobIdx >= 0 && jobIdx < ordered.length - 1 ? ordered[jobIdx + 1].jobId : null,
    position: jobIdx >= 0 ? `${jobIdx + 1} of ${ordered.length}` : null,
  };

  // ---- keyboard shortcuts --------------------------------------------------------------------
  const latest = useRef<() => (e: KeyboardEvent) => void>(() => () => {});
  latest.current = () => (e) => {
    const action = resolveShortcut(keyInfoFrom(e));
    if (!action) return;
    switch (action) {
      case "focus-search":
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
        break;
      case "next":
      case "prev":
        e.preventDefault();
        move(action === "next" ? 1 : -1);
        break;
      case "open": {
        const row = optimisticRows.find((r) => r.applicationId === activeId);
        if (row) {
          e.preventDefault();
          openJob(row.jobId);
        }
        break;
      }
      case "toggle-select":
        if (activeId) {
          e.preventDefault();
          setRowSelection((s) => {
            const next = { ...s };
            if (next[activeId]) delete next[activeId];
            else next[activeId] = true;
            return next;
          });
        }
        break;
      case "mark-applied": {
        const ids = selectedIds.length ? selectedIds : activeId ? [activeId] : [];
        if (ids.length) {
          e.preventDefault();
          changeStatus(ids, "applied");
        }
        break;
      }
      case "escape":
        // The open panel closes itself on Escape.
        if (jobId) break;
        if (document.activeElement === searchRef.current) searchRef.current?.blur();
        else if (selectedIds.length) setRowSelection({});
        break;
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => latest.current()(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!activeId) return;
    document.querySelector(`[data-row-id="${CSS.escape(activeId)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [activeId, safePage]);

  // ---- export --------------------------------------------------------------------------------
  async function exportCsv(onlySelected: boolean) {
    const ids = onlySelected && selectedIds.length ? selectedIds : ordered.map((r) => r.applicationId);
    if (ids.length === 0) return void toast.message("Nothing to export");
    setExporting(true);
    try {
      const res = await fetch("/api/jobs/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) throw new Error("Export failed");
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `jobs-${localToday()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`Exported ${ids.length} job${ids.length === 1 ? "" : "s"}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }

  function clearFilters() {
    setSearch("");
    void setQUrl(null);
    void setRemote(null);
    void setSourceSel(null);
    setPageIndex(0);
  }

  const [lastSelected, setLastSelected] = useState(selectedIds.length);
  if (selectedIds.length > 0 && selectedIds.length !== lastSelected) setLastSelected(selectedIds.length);

  if (optimisticRows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
        No jobs yet.{" "}
        <Link href="/new" className="font-medium text-foreground underline underline-offset-4">
          Add your first application
        </Link>
        .
      </div>
    );
  }

  const hideable = table
    .getAllLeafColumns()
    .filter((c) => c.getCanHide())
    .map((c) => ({ id: c.id, label: COLUMN_LABELS[c.id] ?? c.id, visible: c.getIsVisible() }));

  return (
    <JobsActionsProvider value={{ now, openJob, changeStatus }}>
      <div className="space-y-3">
        <Tabs
          value={tab}
          onValueChange={(v) => {
            void setTab(v as TabValue);
            void setSortParam(null);
            setPageIndex(0);
          }}
        >
          <TabsList className="h-auto flex-wrap">
            {TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>
                {t.label}
                <span className="ml-1.5 text-xs text-muted-foreground tabular-nums">{counts[t.value]}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <Toolbar
          searchRef={searchRef}
          search={search}
          onSearch={(v) => {
            setSearch(v);
            setPageIndex(0);
          }}
          remote={remote as RemoteFilter}
          onRemote={(v) => {
            void setRemote(v === "all" ? null : v);
            setPageIndex(0);
          }}
          sources={sources}
          selectedSources={sourceSel}
          onSources={(v) => {
            void setSourceSel(v.length ? v : null);
            setPageIndex(0);
          }}
          columns={hideable}
          onToggleColumn={(id, visible) => table.getColumn(id)?.toggleVisibility(visible)}
          onExport={() => void exportCsv(false)}
          exporting={exporting}
          exportLabel={`Export CSV${filtersActive || tab !== "active" ? " (filtered)" : ""}`}
          filtersActive={filtersActive}
          onClearFilters={clearFilters}
        />

        {/* Slides open when rows are selected and folds away when cleared (keeping its last count meanwhile). */}
        <Collapse open={selectedIds.length > 0} className="-my-1.5">
          <div className="py-1.5">
            <BulkBar
              count={lastSelected}
              onChangeStatus={(to) => changeStatus(selectedIds, to)}
              onExport={() => void exportCsv(true)}
              onClear={() => setRowSelection({})}
            />
          </div>
        </Collapse>

        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((hg) => (
                <TableRow key={hg.id}>
                  {hg.headers.map((h) => (
                    <TableHead key={h.id}>{h.isPlaceholder ? null : <table.FlexRender header={h} />}</TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows.length ? (
                table.getRowModel().rows.map((row) => (
                  <TableRow
                    key={row.id}
                    data-row-id={row.id}
                    data-active={row.id === activeId}
                    data-state={row.getIsSelected() ? "selected" : undefined}
                    aria-current={row.id === activeId ? "true" : undefined}
                    className="data-[active=true]:bg-muted/60 data-[active=true]:shadow-[inset_2px_0_0_var(--color-primary)]"
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id}>
                        <table.FlexRender cell={cell} />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={table.getVisibleLeafColumns().length} className="h-24 text-center text-muted-foreground">
                    {filtersActive ? (
                      <>
                        No matches.{" "}
                        <Button variant="link" size="sm" onClick={clearFilters}>
                          Clear filters
                        </Button>
                      </>
                    ) : (
                      "Nothing in this tab."
                    )}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        <Pagination
          pageIndex={safePage}
          pageCount={pageCount}
          pageSize={pageSize}
          total={filtered.length}
          selected={selectedIds.length}
          onPage={(i) => setPageIndex(Math.min(Math.max(i, 0), pageCount - 1))}
          onPageSize={(s) => {
            void setSizeParam(s === 25 ? null : s);
            setPageIndex(0);
          }}
        />
      </div>

      <JobSheet
        jobId={jobId}
        row={optimisticRows.find((r) => r.jobId === jobId) ?? null}
        neighbors={neighbors}
        focusDate={focusDate}
        onClose={closeJob}
        onNavigate={(id) => openJob(id)}
        onChangeStatus={(applicationId, to) => changeStatus([applicationId], to)}
        onSetAppliedAt={setAppliedDate}
        onNotesDirty={(dirty) => {
          notesDirty.current = dirty;
        }}
        onNotesSaved={invalidateJobs}
      />
    </JobsActionsProvider>
  );
}
