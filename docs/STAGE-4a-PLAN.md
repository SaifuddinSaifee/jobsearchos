# Plan: Stage 4a Phases 1 and 2 (Library, Notion-like editor, PDF/DOCX export)

## Context

The app keeps resumes as stored files (`files`, `past_resumes`, `profile_versions.base_resume_file_id`). It cannot edit them, has no place for cover letters or emails, and cannot produce a resume. The user wants:

- every resume, cover letter and email stored as **content**, not files;
- a **Notion-like editor on a real A4 page**, essentials only;
- **one-page PDF and DOCX export** from the same layout.

This is the groundwork for the career record ("mega resume"), the fit score and Stage 4 writing. Those are out of scope here, but the document format is built so they can attach to it: every block gets a stable id, and a document can be turned back into a `Profile`.

**Decisions (from the user):**

- Scope is Phases 1 and 2 of `docs/STAGE-4A-CAREER-LIBRARY.md`.
- Files: uploads are read into content and the bytes are dropped. A file is stored only when it leaves the app as an email attachment (uploaded in the composer, or exported at send time). Existing files stay.
- One clean ATS-friendly layout. **A4 only.**

**Constraints found:**

- **Rendering in route handlers.** Next aliases legacy `react-dom/server` (`renderToStaticMarkup`) to an error in some server layers. So the page layout is defined once, as Tiptap node `renderHTML` plus one CSS string, and rendered without a DOM by `@tiptap/static-renderer`. The editor DOM, the measuring copy and the PDF are then the same markup.
- **Server actions run one at a time** and accept 1 MB bodies. So autosave and uploads use route handlers, not actions.
- **`next/dynamic` with `ssr: false`** only works inside a Client Component.
- **Reuse:**
  - the Playwright singleton in `src/lib/jobs/fetch/browser.ts` (`playwright` is already in `serverExternalPackages`);
  - `putFile`/`getFileBytes` in `src/lib/storage/local.ts`;
  - `parseResume` in `src/lib/resume/parse.ts`;
  - `extractResumeText` in `src/lib/resume/extract.ts`;
  - `chunkProfile`/`chunkText` in `src/lib/resume/chunk.ts`;
  - `embedTexts` in `src/lib/resume/embed.ts`;
  - the claim, sweep and heartbeat pattern in `src/lib/resume/indexing.ts` and `src/lib/queue/worker.ts`;
  - `findCompanyByName` in `src/lib/companies/service.ts`;
  - `applyStatus` in `src/lib/jobs/tracker.ts:177`.
- **UI** follows the shared motion system (`src/app/globals.css` tokens, `Button loading`, `Collapse`, `animate-in`, motion-reduce). Pages set no width or h1 of their own. No symbol characters anywhere: the ESLint rule; the DOCX bullet is built from its code point.

## Data model: `drizzle/0015_documents.sql`

Generate with drizzle-kit, then hand-add the trigger and checks, as in 0001 and 0002.

### New tables

**`documents`** (one row per document):

- `kind`: resume, cover_letter or email.
- `origin`: uploaded, pasted, blank, copied, sent or generated.
- `title`, `job_id`, `company_id`, `company_name` (free-text fallback), `target_role`, `written_on`, `jd_text`, `jd_url`.
- `is_base`: partial unique index on true values; check that only resumes can be base.
- `source_name`, `source_mime`, `source_sha256` (used to detect duplicate uploads).
- `source_file_id`: set only for migrated rows and composer uploads.
- `page_settings` (jsonb).
- `legacy_past_resume_id` (unique) and `outreach_email_id` (unique): these make the backfill idempotent.
- `deleted_at` and timestamps.

**`document_drafts`** (the autosave target, one per document):

- `document_id` (primary key), `content`, `subject`.
- `revision`: a stale tab's save gets 409.
- `base_version_id`, `content_sha256`, `updated_at`.

**`document_versions`** (immutable):

- `document_id`, `version` (unique together), `content` (Tiptap JSON), `content_schema`, `subject`, `markdown`, `plain_text`, `content_sha256`.
- `page_settings`: a snapshot, because the PDF depends on it.
- `reason`: manual, export, attach, applied, upload, structured, restore, migrated or sent.
- `note`, `restored_from_version_id`, `locked_at`, `locked_job_id`, `created_at`.
- `search_vector`: a generated tsvector with a GIN index.
- A trigger `document_versions_guard` rejects DELETE, and every UPDATE except a one-way change that only sets `locked_at` and `locked_job_id`.

### Changes to existing tables

- **`outreach_emails`:** add `attachment_document_id` and `attachment_version_id`. `attachment_file_id` still means "the exact bytes sent".
- **`resume_indexes`:** surrogate `id` primary key; `file_id` becomes nullable; add `document_version_id`; partial unique indexes on each key; a check that exactly one key is set.
- **`resume_chunks`:** the same two keys, with per-key `(key, ordinal)` unique indexes. Legacy file-keyed rows stay frozen.

### Unchanged

- `profile_versions`: no new column. `documents.is_base` is the only source of truth for the base resume.
- `past_resumes`: kept read-only.
- Add the three new tables to the TRUNCATE list in `tests/helpers.ts`.

## Content format: `src/lib/documents/`

### Page settings

`page-settings.ts` (safe to import from the client): Zod `PageSettingsSchema`.

| Setting | Values |
| --- | --- |
| template | `classic` |
| paper | `A4` (a literal) |
| font | carlito, arimo or tinos |
| density | 0 to 8 |
| accent | none or four muted colours |
| maxPages | 1 or 2 |
| overrides | fontSizePt, lineHeight, marginMm |

`DENSITY_STEPS` maps each density step to font size, line height, margins and gaps. `styleVars()` turns settings into CSS variables.

### Nodes

`nodes/*.ts` plus `extensions.ts` hold the Tiptap node definitions. They contain no React, so the server can load them.

| Node | Contents |
| --- | --- |
| `header` | name, headline and contact fields; the contact field allows only the link mark |
| `section` | `{id, kind}`, a title, then items |
| `role` | `{id}`; title, company, location, start and end fields, then an optional bullet list |
| `project` | name, detail and date fields, then an optional bullet list |
| `education` | institution, degree, location, start and end fields, then an optional bullet list |
| `skillsLine` | label and items |
| `paragraph` | text |
| `bulletList`/`bullet` | `{id}`; nesting at most 2 levels deep |
| `divider` | a rule |

- **Marks:** bold, italic, underline and link (http, https and mailto only).
- **Fields** are single-line textblocks built by one `fieldNode()` factory, not React node views. That gives native undo, selection, spellcheck and paste. The role line layout is pure CSS grid.
- **Ids** are stable on section, role, project, education and bullet. They are the hook for the career record and fit-score highlighting later.

### Validation

`schema.ts` holds a recursive Zod `DocContentSchema` with a size cap. A test checks that it agrees with the ProseMirror schema: it accepts and rejects the same fixtures.

### Converters

All in `convert/`, pure and unit-tested:

- **`profileToDoc`**: section order is Summary, Experience, Projects, Skills plus Technologies, Education, Certifications, Achievements; empty sections are left out.
- **`docToProfile`**: the inverse. It fills `resume_indexes.parsed` without a model call.
- **`textToDoc`**: heuristics for headings and bullets, written with `\u` escapes.
- **`htmlToDoc`**: maps mammoth HTML to the document; this is the DOCX fallback.
- **`docToMarkdown`** and **`docToText`**.
- **`chunkDocument`**: `chunkProfile(docToProfile(doc))`, plus custom sections.
- **`normalize`**: fills missing fields and ids.

## Phase 1: Library (build steps 1 to 5)

1. **Content format:**
   - nodes, Zod schema, converters, page settings;
   - `render/template-css.ts` and `render/html.ts`: `renderPrintHtml(content, settings, title)`, built on the static renderer;
   - a read-only `DocumentPage` component.
2. **Migration and `src/lib/documents/service.ts`:**
   - `createDocument` (document, version 1 and draft);
   - `saveDraft(id, {content, subject, revision})`;
   - `createVersion(id, {reason, note})`, which skips the insert when the hash matches the latest version;
   - `restoreVersion`, which makes a new version;
   - `setBase`, run in a transaction;
   - `softDelete`, blocked for the base document and for locked documents;
   - `listDocuments`, `getEditorData`, and `lockForJob(tx, jobId)`.

   Resume versions are queued for indexing after commit.
3. **Indexing moves to versions** (`src/lib/resume/indexing.ts`):
   - Claim, sweep and touch work on index ids.
   - `processResumeIndex` branches. A version row is structured once if it came from an upload (`parseResume`, then `profileToDoc`, saved as version N+1 with reason `structured`). The draft is replaced only if it is still untouched (matching hash); otherwise a "structured version ready" note is kept. Then the version is chunked, embedded, and its chunks replaced. File rows keep today's path.
   - `searchResumeChunks` searches the latest version of each resume document that is not deleted, and its results gain `documentId`, `versionId` and `title`.
   - `IndexBadge` and `/api/resume-indexes` switch to version ids.
   - Only resumes are embedded.
4. **Backfill** (`src/lib/documents/backfill.ts`): idempotent, under an advisory lock, run from `startQueueWorker` before `backfillResumeIndexes`. There is also `scripts/backfill-documents.ts`.
   - **Past resumes:** each becomes a document. Its content comes from `profileToDoc(parsed)` if parsed data exists, else `textToDoc(extracted_text)`. Its company comes from the job, then `findCompanyByName`, then the free-text name.
   - **Base resume:** built from `profileToDoc(latest profile)`.
   - **Sent outreach emails:** each becomes an email document whose version is locked at the send time.
5. **Library UI:**
   - **Navigation:** add `{ href: "/library", label: "Library", icon: LibraryBig, childLabel: "Document" }` to `NAV` in `src/components/nav.ts`.
   - **List page** `src/app/(app)/library/page.tsx`, with nuqs tabs Resumes, Cover letters and Emails (`src/components/library/`).
     - Each row shows title, Base badge, job or company, role, date, origin, versions, a lock and the index state.
     - Row actions: Open, Duplicate, Set as base, Delete.
     - An Add panel offers Upload, Paste, and Blank or Copy of base, with metadata fields.
   - **Document page** `library/[id]/page.tsx`: read-only `DocumentPage` and Copy Markdown, until the editor lands.
   - **Routes and actions:**
     - `POST /api/documents`: multipart, 10 MB, Node runtime. It extracts, hashes, returns 409 `duplicateOf` unless forced, creates the document and queues it.
     - Server actions in `library/actions.ts`: create from text, blank, duplicate, metadata, set base, delete, save version, restore, page settings, retry index.
   - **Extraction:** `extractForDocument` in `extract.ts` adds mammoth HTML and PDF lines (unpdf `getTextContent`, with y position, size and bold) for better headings.
   - **Profile:**
     - Remove the "Past resumes" tab (`src/components/profile/profile-tabs.tsx`) and `deletePastResumeAction`, and add a pointer to the Library.
     - `/api/resume/parse` stops calling `putFile`.
     - `saveProfileAction` creates the base document from `profileToDoc` and calls `setBase`.
     - The base resume card links to the Library.
   - **Composer uploads** (`uploadResumeForJob`) still keep the file, because it leaves the app, and also create a document with `source_file_id`.

   Phase 1 is complete after this step.

## Phase 2: Editor and export (build steps 6 to 11)

6. **Export:**
   - **Fonts:** vendor Carlito, Arimo and Tinos woff2 files plus their OFL and Apache licences into `public/fonts/`. They are metric-compatible with Calibri, Arial and Times, so the DOCX names those fonts.
   - **Shared browser:** move it to `src/lib/browser.ts`, used by job fetching too. It closes after 5 minutes idle and allows at most 2 renders at once.
   - **PDF** (`export/pdf.ts`):
     - a new browser context per render, with every request blocked except a `print.local` route that serves the HTML and fonts;
     - wait for `document.fonts.ready`, then `page.pdf({ preferCSSPageSize, printBackground, tagged })` with a 20 s timeout;
     - count pages with unpdf.
   - **DOCX** (`export/docx.ts`, `docx` package): A4 in twips, section rules in the accent colour, dates on a right tab stop, a numbering-based bullet, hyperlinks.
   - **Route** `POST /api/documents/[id]/export {format, versionId?}`:
     - without `versionId`, it creates or reuses a version with reason `export`;
     - returns `X-Page-Count`; `maxDuration` is 60;
     - the filename is `Name - Company - Role.pdf`, using the `filename*` pattern from `src/app/api/files/[id]/route.ts`;
     - downloads are not stored.
7. **Outreach on documents** (`src/lib/outreach/service.ts`, `types.ts`, `attachment-picker.tsx`, `send-dialog.tsx`):
   - `ResumeOption` becomes a document or a kept file; the default is the base document.
   - New `prepareAttachment(jobId)`, called when the send dialog opens. It creates a version with reason `attach`, renders the PDF, stores it with `putFile`, and sets `attachment_file_id`, `attachment_version_id` and `attachment_name`, so the confirmation shows the real size and page count.
   - The send flow re-prepares if the content changed since then, then sends exactly as today. On success it locks the attached version and creates the sent-email document.
   - `isKnownResumeFile` (`src/lib/resume/files.ts`) also accepts `documents.source_file_id`.
   - Sent history links to "Version N in Library".
8. **Lock on Applied:** in `applyStatus`, when the status changes to applied, call `lockForJob(tx, jobId)` in the same transaction. It snapshots unsaved drafts (reason `applied`), then sets `locked_at`. Undo does not unlock. The editor shows a banner.
9. **Editor core** (`src/components/documents/`):
   - **Packages:** `@tiptap/react`, `/pm`, `/core`, `/starter-kit` (heading, code, blockquote, strike and ordered list off), `/extensions` (Placeholder), `/suggestion`, `/static-renderer`, `/extension-unique-id`, `/extension-drag-handle-react`. Check each licence and its peers with `npm view` when installing. If the drag handle pulls in yjs or collaboration packages, write a small custom handle instead.
   - **Loading:** `editor-loader.tsx` (a client component) calls `dynamic(..., { ssr: false })`, with `DocumentPage` as the loading state. On a phone it shows the read-only page plus export only.
   - **React Compiler:** `useEditor({ immediatelyRender: false, shouldRerenderOnTransaction: false })`. All toolbar and chip state comes from `useEditorState` selectors. Add `"use no memo"` only where needed.
   - **Keymap** (`editor/keymap.ts`):
     - Enter moves to the next field; from the last role field it goes to the first bullet.
     - Enter on an empty last bullet leaves the list.
     - Tab and Shift+Tab indent and outdent.
     - Backspace in an empty field goes to the previous field.
     - Input rules: `- ` and `## `.
   - **Autosave:** `useAutosave` debounces 800 ms, sends `PUT /api/documents/[id]/draft` with the revision, flushes with keepalive on `pagehide`, and shows a quiet Saving/Saved indicator. A 409 shows a toast.
   - **Save version** (with an optional note) and a **versions panel** (preview in a `Sheet`, Restore).
10. **Notion feel:**
    - A slash menu (`@tiptap/suggestion`, items depend on context, positioned with floating-ui) that animates in from where it opens.
    - A bubble toolbar for bold, italic, underline and link.
    - A drag handle on every block, with a menu: duplicate, delete, move up and down, turn into.
    - A collapsible outline panel.
    - Add the shadcn base-nova `popover`, `slider` and `toggle-group` components.
11. **Page fit:**
    - **Settings popover:** font, Density slider, accent, max pages, fine controls, Fit to one page.
    - **Measuring copy:** a hidden, unscaled copy of `renderPrintHtml` output, re-measured after `document.fonts.ready`.
    - **Page-break line and tint:** drawn at the A4 content height (1122.5 px minus margins).
    - **Fit chip:** "Fits on one page", "N lines over" or "2 pages".
    - **`fit.ts` (pure):** walks density steps until the page fits. Otherwise it reports which sections are too long and never cuts text.
    - **`POST /api/documents/[id]/fit`:** checks in Chromium 2.5 s after edits and on export. The server's answer wins.
12. **Docs:**
    - `docs/PRODUCT.md`: the Library, and the Profile and Outreach changes, status and roadmap.
    - `docs/STAGE-4A-CAREER-LIBRARY.md`: built status, decisions and schema; close open questions 1, 3 and 6.
    - `docs/STAGE-7B-OUTREACH.md`.
    - `docs/PLAN.md`: data model, and workflow 1 step 5 (the app now makes the PDF).
    - `README`: Chromium is needed for export; font licences.

## Risks

- **Tiptap with the React Compiler:** toolbar state can go stale. Avoid React node views and use `useEditorState`.
- **Browser and PDF measurements can differ:** the measuring copy is the export HTML, fonts use `font-display: block`, there are no print-only layout rules, and the server check is authoritative.
- **Playwright in the Next server:** handle a missing Chromium with a clear error, add timeouts and a concurrency cap, block all outside requests, and close when idle.
- **Zoomed views:** a CSS transform can throw off ProseMirror coordinates. Default to 100% zoom.
- **Drizzle snapshot:** it must include the hand-added checks and partial indexes, or the next generate will drift.

## Verification

- **Each step:** `npm run typecheck`, `npm run lint`, `npm test`.
- **New tests:**
  - `tests/documents-convert.test.ts`: round trip profile to doc to profile, text-fallback fixtures, Markdown snapshots, chunks.
  - `tests/documents-schema.test.ts`: Zod and ProseMirror agree.
  - `tests/documents-service.test.ts`: draft revision 409, version dedupe, restore; the trigger blocks update and delete and allows only the lock.
  - `tests/documents-backfill.test.ts`: past resume (parsed and text-only), base from profile, sent emails, idempotent second run.
  - Updates to `resume-indexing`, `outreach-service`, `profile` and `jobs-status` (Applied locks; undo keeps the lock).
  - `tests/documents-pdf.test.ts`, skipped without Chromium:
    - a one-page fixture gives 1 page and a long fixture gives 2;
    - in-browser measurement matches the PDF page count near the limit;
    - the PDF and DOCX text contain every bullet in order;
    - the DOCX page size is A4.
  - `tests/documents-fit.test.ts` with a fake measure.
- **End to end, by hand** (`npm run db:migrate`, `npm run dev`, Ollama running):
  1. Open `/library`: past resumes, the base resume and sent emails are listed after the backfill.
  2. Upload a DOCX and a PDF: the document appears at once with fallback content, then the structured version replaces it.
  3. Open it in the editor:
     - type, press `/` and insert a role, drag a bullet, bold some text;
     - reload, and the draft is still there;
     - save a version, then restore it.
  4. Make it run over a page: the page-break line and "N lines over" appear. Fit to one page makes the chip read "Fits on one page".
  5. Download the PDF and DOCX: both are A4 and one page (`pdfinfo`), the text is selectable, and the DOCX opens in LibreOffice.
  6. From a job's outreach:
     - the base document is attached by default;
     - the send dialog shows the real PDF size and page count;
     - after sending, the history shows the exact file and "Version N in Library", and that version is locked.
  7. Mark a job with a linked resume as Applied: its versions lock and the editor shows the banner.
