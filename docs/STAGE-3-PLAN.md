# Plan: Stage 3: Jobs table, application tracker and Dashboard

## Context

Stage 2 is built and verified: saving a job writes `jobs`, an immutable `job_snapshots` row, `job_keywords`, an `applications` row (status `saved`) and the first `status_events` row. `/jobs` is a bare list and `/` (Dashboard) is a placeholder. Stage 3 makes Jobs the working surface: a TanStack Table with status tracking, links, notes, a slide-over panel, keyboard use and CSV export; and gives the Dashboard a small "what needs me now" view.

**Decisions (from the user)**
- Detail view: **slide-over panel**; a full `/jobs/[id]` page comes later.
- Tracking: **basics only**: status, notes, applied date.
- Closed jobs (Rejected, Withdrawn, Ghosted) live behind a **Closed** tab; the default tab hides them.
- Setting **Applied** is instant with today's date; the toast offers "Change date"; the date is editable in the panel.
- **Only the title** opens the panel (no whole-row click).
- Every status change (single or bulk) shows a toast with **Undo**.
- Extras in scope: **keyboard shortcuts**, **CSV export**, **next/prev in the panel**.
- Table library: **TanStack Table v9** (9.2.5), following the user's shadcn guide.

**Out of scope** (with their stages): documents, outreach and match-score columns (4, 7, 6); editing a saved job's extracted fields; follow-up reminders (9). There is no hard delete (`job_snapshots` is immutable); a wrong save is set to **Withdrawn**. **No migration**: `applications.status/applied_at/notes/updated_at` and `status_events` already exist.

---

## 1. Verified facts (checked against the repo and the published v9 package)

**TanStack Table v9** (`@tanstack/react-table` re-exports `@tanstack/table-core`):
- `useTable(options, selector?)`; `<table.FlexRender header|cell />`; `table.Subscribe` for selective re-renders.
- Features: `rowSortingFeature`, `columnFilteringFeature`, `globalFilteringFeature`, `columnVisibilityFeature`, `rowPaginationFeature`, `rowSelectionFeature`.
- Row models: `createSortedRowModel()`, `createFilteredRowModel()`, `createPaginatedRowModel()`.
- Built-in fns registered on the features object: `filterFn_includesString`, `filterFn_arrIncludesSome`, `sortFn_text`, `sortFn_alphanumeric`, `sortFn_datetime`, `sortFn_basic`.
- Columns accept inline custom fns: `sortFn: (rowA, rowB, columnId) => number`, `filterFn: (row, columnId, value) => boolean`; plus `sortUndefined: 'last'`, `sortDescFirst`, `enableGlobalFilter`, `enableSorting`, `enableHiding`.
- Table options: `globalFilterFn`, `onGlobalFilterChange`, `onSortingChange`, `onPaginationChange`, `autoResetPageIndex`, `getRowId`.
- **React Compiler risk:** the app enables `reactCompiler`. If the table renders stale state, add `"use no memo"` at the top of `jobs-table.tsx` (the documented opt-out). Check this first while building.

**Repo**
- Providers already mount `QueryClientProvider`, `NuqsAdapter`, `TooltipProvider` and Sonner (`src/components/providers.tsx`). `nuqs` is used via `useQueryState` + `parseAsStringLiteral` in `src/components/profile/profile-tabs.tsx`; copy that pattern.
- shadcn **base-nova** uses the `render` prop, not `asChild` (e.g. `DropdownMenuTrigger render={<Button/>}`). Present components:
  - table, tabs, badge, checkbox, sheet, input, select, command, tooltip, skeleton;
  - dropdown-menu, including checkbox, radio and sub-menu items.
- `SheetContent` caps width at `sm:max-w-sm`, so the panel passes `data-[side=right]:sm:max-w-xl`. `Checkbox` has no indeterminate icon; add one.
- Next 16 route handlers get `params` as a Promise (`await params`), per `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md`. A page using `nuqs` must sit inside `<Suspense>` to prerender (same fix as `/new`).
- Tests use `testDb()`/`resetDb()` from `tests/helpers.ts`; that helper already truncates the Stage 2 tables.
- `jobs.applicationUrl` comes from LLM output and is **untrusted**: it is rendered only if http(s).

## 2. Setup and small fixes

- `npm i @tanstack/react-table`.
- `src/components/ui/checkbox.tsx`: render a minus icon when `indeterminate`.
- Stage 2 hardening: `saveJob` stores `applicationUrl` only if `safeHref()` accepts it, else falls back to the canonical URL (with a test).

## 3. Pure modules (no DB, unit-tested)

**`src/lib/jobs/status.ts`**, the single source of truth:
- `STATUSES` in pipeline order, each with a label, a badge tone and a group:

  | Group | Statuses |
  |---|---|
  | active | saved, preparing |
  | applied | applied |
  | interviews | recruiter_screen, interview, technical_interview, final_interview |
  | offers | offer |
  | closed | rejected, withdrawn, ghosted |

- `TABS`: `active` (default, all non-closed), `saved`, `preparing`, `applied`, `interviews`, `offers`, `closed`.
- Helpers: `tabCounts(rows)`, `statusRank()`, `isClosed()`.
- Thresholds: `STALE_APPLIED_DAYS = 7`, `STALE_PREPARING_DAYS = 3`.

**`src/lib/jobs/format.ts`**
- `formatSalary(min, max, currency, period)` gives e.g. `$150k–$180k / yr` (compact Intl).
- `annualSalary()` normalizes for sorting: hour ×2080, month ×12.
- `formatDate(iso)` uses fixed `en-US` with UTC parts, so server and client match.
- `relativeDays(iso, now)` and a `useNow()` hook: "5d ago" is computed after mount to avoid hydration mismatch.
- `localToday()` gives the user's local `YYYY-MM-DD`. Applied dates are stored as **12:00 UTC** of that day, so timezones never shift them.

**`src/lib/jobs/links.ts`**
- `safeHref(url)`: http(s) only, else `null`.
- `sourceLabel(ats, fetchMethod)`: Greenhouse, Lever, Ashby, Workday, SmartRecruiters, Workable, "Page" or "Pasted".

**`src/lib/jobs/csv.ts`**
- `toCsv(rows, columns)` follows RFC 4180: quotes, embedded commas and newlines.
- Guards against formula injection: cells starting with `= + - @ \t \r` get a leading `'`.

**`src/components/jobs/table/shortcuts.ts`**
- `resolveShortcut(event, ctx)` is a pure function mapping a key to an action, so it can be unit-tested.
- It ignores keys while focus is in an input, textarea, select, contenteditable or an open menu, and keys with modifiers.

## 4. Data layer (`src/lib/jobs/service.ts`; `listJobs` is replaced)

Every function takes an optional `db`, as the Stage 2 functions do.

**Row contract** (shared type `JobRow`, ISO strings for dates):

| Field | Type |
|---|---|
| jobId, applicationId | `string` |
| company, title, location | `string` |
| remoteType | `string` |
| salaryMin, salaryMax | `number \| null` |
| salaryCurrency, salaryPeriod | `string \| null` |
| status | `ApplicationStatus` |
| appliedAt, postedAt | `string \| null` |
| createdAt, lastChangeAt | `string` |
| employmentType | `string \| null` |
| source | `string` |
| postingUrl, applyUrl | `string \| null` |
| technologies | `string[]` |
| hasNotes | `boolean` |

**`listJobRows(db)`**: one query, `jobs ⨝ applications`, with three correlated subqueries:
- `lastChangeAt` = `max(status_events.at)`
- `source` = `coalesce(jobs.ats, latest snapshot fetch_method)`
- `hasNotes` = `length(trim(notes)) > 0`

Notes text is not sent to the table.

**`getJobDetail(jobId, db)`** returns the row fields plus:
- `notes`, `responsibilities`, `requirements`, `keywords`;
- `timeline` (newest first);
- the snapshot's `sourceUrl`, `fetchMethod`, `fetchedAt`, `rawText`.

It returns `null` if the job does not exist.

**Mutations** (each in one transaction, application rows locked with `FOR UPDATE`):
- `changeStatus(applicationId, to, { appliedDate?, note? })`
  - Same status is a no-op.
  - Otherwise it updates `status`/`updated_at` and inserts a `status_events` row (from → to).
  - It sets `applied_at` when moving to `applied` and `applied_at` is null (given date, else today), and bumps `jobs.updated_at`.
  - It returns `previous: { applicationId, status, appliedAt }` for Undo.
- `changeStatusBulk(applicationIds, to, { appliedDate? })`: dedupes ids, caps at 500, rolls back everything if any id is unknown, and returns all `previous` entries.
- `revertStatus(previous[])`: Undo.
  - It moves each application back to its previous status, writing an event with note `"Undo"` so the timeline stays honest.
  - It restores `applied_at` exactly, so undoing a first Applied clears the date.
  - It skips an application whose status was changed again since then; that row is reported back as skipped.
- `setAppliedAt(applicationId, date)` and `saveNotes(applicationId, notes ≤ 10,000 chars)` write no status events.
- `exportRows(applicationIds | null)`: rows plus notes, in the given order, for CSV.

**`dashboardData(db, now)`** returns:
- `funnel`: counts per group;
- `needsAttention`: applied with last change 7+ days ago, preparing with last change 3+ days ago. It uses `lastChangeAt`, so saving notes does not reset the clock.
- `recent`: the latest 10 events joined to job title and company.

**Server actions** (`src/app/(app)/jobs/actions.ts`, `"use server"`): `changeStatusAction`, `bulkChangeStatusAction`, `revertStatusAction`, `setAppliedAtAction`, `saveNotesAction`.
- Each validates with Zod: uuid ids, the status enum, `YYYY-MM-DD` dates, and the notes length.
- Each returns `{ ok: true, previous? } | { ok: false, error }`, matching `src/app/(app)/profile/actions.ts`.
- Each calls `revalidatePath("/jobs")` and `revalidatePath("/")`.

**Route handlers**
- `src/app/api/jobs/[id]/route.ts` `GET` returns `getJobDetail`: 400 for a non-uuid id, 404 if missing.
- `src/app/api/jobs/export/route.ts` `POST { ids: string[] | null }` returns `text/csv` with `Content-Disposition: attachment; filename="jobs-YYYY-MM-DD.csv"`.
- CSV columns: Company, Title, Location, Remote, Salary min, Salary max, Currency, Period, Status, Applied, Saved, Posted, Source, Posting URL, Apply URL, Technologies, Notes.

## 5. Jobs table: `src/components/jobs/table/`

| File | Responsibility |
|---|---|
| `features.ts` | `tableFeatures({...})` with the six features, three row models and the registered fns; exports `JobsTableFeatures` |
| `columns.tsx` | `createColumnHelper<JobsTableFeatures, JobRow>()` definitions |
| `jobs-table.tsx` | State, `useTable`, layout, optimistic updates, undo toasts, shortcuts, export, panel wiring |
| `toolbar.tsx` | Search (debounced 200 ms), Remote filter, Source filter (multi-select of values present), Columns menu, Export button |
| `status-menu.tsx` | Badge-as-dropdown (`DropdownMenuRadioGroup`, grouped by stage); shared with the panel |
| `row-actions.tsx` | Row menu: Open details, Open posting, Open application page, Copy posting link, Change status (sub-menu) |
| `bulk-bar.tsx` | Shown when rows are selected: "N selected", Change status (with Undo), Export selected, Clear |
| `pagination.tsx` | 25/50/100 rows per page, prev/next, "Page X of Y", "N of M selected" |
| `job-links.tsx` | Posting and apply icon links: `safeHref`, `target="_blank" rel="noopener noreferrer"`, tooltips, aria-labels; one icon if both URLs are the same |
| `shortcuts.ts` | Pure key → action map (above) + a `useShortcuts` hook |

**Columns**
- Visible by default:
  - select checkbox (header uses indeterminate);
  - Company;
  - **Title**, a link-style button that opens the panel, truncated with a tooltip;
  - Location with a remote badge;
  - Salary;
  - Status menu;
  - Applied (date + "5d ago");
  - Source badge;
  - Links;
  - Saved date;
  - row actions.
- Hidden by default: Technologies, Posted, Employment type, Notes indicator.

**Sorting**

| Column | Sort |
|---|---|
| Company, Title | `sortFn_text` |
| Salary | Custom on `annualSalary`, `sortUndefined: 'last'` |
| Status | Custom on `statusRank` |
| Applied, Saved | `sortFn_datetime`, nulls last |

The default is Saved descending; the Applied tab defaults to Applied descending.

**Filtering**
- The global filter is a custom fn: every whitespace-separated term must appear (case-insensitive) in company, title, location or technologies.
- Remote is an equality filter. Source uses `filterFn_arrIncludesSome`.
- Tabs filter on status before the table sees the rows, so counts stay stable and don't follow search or filters.

**State**
- URL via `nuqs` (enum parsers; defaults are omitted from the URL): `tab`, `q`, `sort` (`col.dir`, whitelisted), `remote`, `source`, `size`, `job` (the open panel).
- The page index is local and resets on tab, search or filter changes.
- Local: `rowSelection`, `activeRowId` (keyboard focus). Selection is cleared when the tab changes.
- Column visibility is kept in `localStorage`, wrapped in try/catch; the table works without it.
- `getRowId: row => row.applicationId`.

**Mutations, optimistic updates and Undo**
- Rows come from the Server Component. `useOptimistic(rows, applyPatch)` applies status and applied-date patches instantly inside `startTransition`.
- The server action runs and `revalidatePath` refreshes the rows. On failure the patch rolls back automatically and an error toast appears.
- Success toast: "Moved *Title* to Rejected · **Undo**" (bulk: "Moved 5 jobs to Rejected · Undo"). Undo calls `revertStatusAction(previous)` optimistically; skipped rows are reported in a follow-up toast.
- Marking Applied sends `localToday()`. Its toast also has **Change date**, which opens the panel with the date input focused.
- Any mutation also invalidates the TanStack Query key `["job", jobId]`, so the panel never shows stale data.

**Keyboard shortcuts** (a `?` button in the toolbar lists them):

| Key | Action |
|---|---|
| `/` | Focus search |
| `j` / `k` (↓ / ↑) | Move the active row (crosses page boundaries) |
| `Enter` / `o` | Open the panel for the active row |
| `x` | Toggle selection of the active row |
| `Esc` | Close the panel, else clear selection, else blur search |
| `Shift+A` | Mark the active row (or the selection) Applied |

The active row gets a ring and `aria-selected`.

**Empty states**
- No jobs at all: a link to `/new`.
- A tab with nothing in it: a short message.
- Filters with no results: "No matches" + **Clear filters**.

**Page** (`src/app/(app)/jobs/page.tsx`): Server Component, `force-dynamic`. It calls `listJobRows()` and renders `<Suspense><JobsTable rows /></Suspense>`. The header shows the total and a "New application" button.

## 6. Slide-over panel: `src/components/jobs/job-sheet.tsx`

**Opening and data**
- `Sheet` on the right, wide, full width on mobile. It is driven by the `job` URL param, so `/jobs?job=<id>` deep-links and closing clears it.
- Data comes from `useQuery(["job", id])` → `GET /api/jobs/[id]`, with a skeleton while loading and a "Job not found" state on 404.

**Header**
- Title, company, location + remote badge, salary, posting and apply links.
- **Prev / Next** buttons, also `j`/`k` while the panel is open. They step through the table's current filtered and sorted order, across pages, and keep the table's active row and page in sync.

**Tracking**
- `status-menu`, plus the applied-date input (`setAppliedAtAction`, disabled until a date exists or the status is Applied or later).
- **Notes** textarea with an explicit Save. Save is disabled until something changes and shows "Saved". Closing or stepping away with unsaved notes asks for confirmation.

**Details**
- Employment type, posted date, source + fetch method, saved date.
- Technologies (badges), required and preferred requirements, responsibilities, keywords. The long lists are collapsible.

**Timeline**: status events, newest first: from → to, relative time, note ("Undo" shown muted).

**Source text**: collapsible raw snapshot, with the source URL and fetched date.

No documents or outreach sections appear until Stages 4 and 7.

## 7. Dashboard: `src/app/(app)/page.tsx`

Server Component using `dashboardData()`:
- **Funnel:** cards for Active, Applied, Interviews, Offers and Closed, each with its count and linking to `/jobs?tab=…`.
- **Needs attention:** stale Applied (7+ days) and stale Preparing (3+ days), with days since the last change. Each row links to `/jobs?job=<id>`. Empty state: "Nothing needs attention".
- **Recent activity:** the latest 10 status events (job, from → to, relative time).
- A brand-new user gets an empty state pointing to `/new`.

## 8. Tests

**Unit** (`tests/jobs-status.test.ts`, `tests/jobs-format.test.ts`):
- Every status is in exactly one group; `TABS` cover all statuses; `active` excludes exactly the closed ones; `statusRank` order is correct.
- `formatSalary` / `annualSalary` handle hour, month, year and nulls; `formatDate` is timezone-stable.
- `safeHref` rejects `javascript:`, `data:`, relative and garbage values, and accepts http(s).
- `toCsv` handles quotes, commas, newlines and formula injection.
- `resolveShortcut` ignores keys typed in inputs and keys with modifiers.

**Integration** (`tests/jobs-tracker.test.ts`, against `jobtracker_test`):
- `changeStatus`:
  - writes the event and updates the row;
  - sets `applied_at` on the first Applied with the given date and keeps it through later moves;
  - treats the same status as a no-op with no event.
- `changeStatusBulk` is atomic (one bad id rolls back all) and dedupes.
- `revertStatus`:
  - restores the status;
  - restores or clears `applied_at`;
  - writes an "Undo" event;
  - skips rows changed since.
- `saveNotes` and `setAppliedAt` write no events.
- `listJobRows` returns `source`, the URLs, `hasNotes` and `lastChangeAt`.
- `getJobDetail` returns the timeline in order, and `null` for an unknown id.
- `exportRows` keeps the requested order and includes notes.
- `dashboardData` funnel counts and the 7-day and 3-day rules hold (events backdated with SQL).
- `saveJob` drops a non-http `applicationUrl`.

All Stage 2 tests keep passing.

## 9. Docs

- Replace `docs/STAGE-3-PLAN.md` with this plan.
- Update `docs/PLAN.md` Stage 3:
  - tabs: Active, Saved, Preparing, Applied, Interviews, Offers, Closed;
  - slide-over panel;
  - basics-only tracking, Undo, shortcuts, CSV;
  - no hard delete;
  - documents, outreach and score columns deferred.
- README: layout notes and the shortcut list.

---

## Build order

1. Install the package and patch the checkbox. Build a tiny table to confirm the v9 API and React Compiler behaviour (`"use no memo"` if needed).
2. Pure modules + unit tests.
3. Service, actions and route handlers + integration tests; `saveJob` URL hardening.
4. Table: read-only rendering → sorting, tabs, search and filters with URL state → status menu with optimistic updates and Undo → selection and bulk bar → pagination and Columns menu → CSV export.
5. Panel: details, notes, applied date, timeline, prev/next.
6. Keyboard shortcuts across the table and panel.
7. Dashboard.
8. Docs, then the full verification below.

## Verification

1. `npm test`, `npm run typecheck`, `npm run lint` and `npm run build` all pass.
2. `npm run dev`. Save 6+ jobs through `/new` (ATS and pasted). Set one job's `application_url` to `javascript:alert(1)` in psql and confirm no apply link renders.
3. `/jobs`: columns are correct; links open in a new tab; salary formats and sorts sensibly; no hydration warnings in the console.
4. Mark a job Applied: it updates instantly with today's date; **Change date** opens the panel at the date input; **Undo** restores the old status and clears the date; the timeline shows the moves, including "Undo".
5. Rejected, Withdrawn and Ghosted leave **Active** and appear under **Closed**; tab counts update.
6. Select rows and bulk-change status, then Undo. Stop Postgres, retry, and confirm the rollback and the error toast.
7. Search `go berlin`, sort by salary and by status, change the page size and reload: URL state is restored. Hide a column and reload: it stays hidden.
8. Keyboard: `/`, `j`/`k` across a page boundary, `Enter`, `x`, `Shift+A` and `Esc` all behave; typing in search never triggers shortcuts.
9. Panel: open it from a title and via `/jobs?job=<id>`. Step with Prev/Next. Edit notes and the date, close and reopen: both persisted. An unsaved-notes prompt appears. An unknown id shows "Job not found".
10. Export with no selection (the filtered rows) and with a selection. Open the CSV in a spreadsheet: notes and URLs are intact, and a title starting with `=` is not executed.
11. Dashboard: counts match the tabs. Backdate an Applied event 8 days in psql: it appears under Needs attention and links to the panel.

---

## As built: deviations from the plan above

- **Filtering happens before the table.** Search, the remote filter and the source filter narrow the rows array (then `useTable` sorts, paginates, selects and hides columns). Only four table features are registered (`rowSortingFeature`, `rowPaginationFeature`, `rowSelectionFeature`, `columnVisibilityFeature`); `columnFilteringFeature` and `globalFilteringFeature` were not needed.
- **React Compiler:** `jobs-table.tsx` and `columns.tsx` opt out with `"use no memo"`. Without it the sort header and checkbox cells read stale table state (found in a browser run: the second click on a sort header did nothing).
- **Source** is shown as a small line under the company; the separate Source column exists but is hidden by default so the default columns fit a 1400px screen.
- **Client-safe types:** `src/lib/jobs/types.ts` holds `JobRow`, `JobDetail`, `PreviousState` and constants so client components never import the database driver (`tracker.ts` re-exports them).
- **Font:** the app uses Google Sans through `next/font/google` (self-hosted at build time); the circular `--font-sans` token in `globals.css` was fixed.
- **Layout:** `SidebarInset` and the page wrapper got `min-w-0` so wide tables scroll inside their container instead of stretching the page; the nested `<main>` was changed to a `<div>`.
- Verified end to end in a real browser (Playwright) against a seeded test database: 18 checks covering tabs, search and URL state, sorting, inline status with Undo, Applied date, bulk changes, keyboard shortcuts, the panel (notes, deep link, unsaved prompt, not-found), column visibility, CSV export, link safety and the dashboard.
