# Stage 4a: Career library, document editor, career record and fit score (plan)

Status: **Phases 1 and 2 (Library, editor and export) built** on branch `stage-4a`. Phases 3 and 4 are planned. "Phase 1 as built" and "Phase 2 as built" below say where the build differs from the plan.

This is the groundwork for Stage 4 (writing). It replaces the "master resume" idea in
[RESUME-LIBRARY.md](RESUME-LIBRARY.md) and pulls the resume half of Stage 6 (match score) forward.

## Why

Writing a good resume, cover letter or email for a job needs things the app does not have yet:

1. **Everything you have written before, as text.** Every resume, cover letter and email, readable and searchable,
   whatever file it came from.
2. **A place to edit it, right there.** Open a resume, change a bullet, see the page, download it. No round trip
   through Word or Google Docs.
3. **Everything you have done, in one place.** People reword the same job for different targets. One resume says
   "Product Manager at XYZ", another says "Software Engineer at XYZ" for the same years. Each is true from a different
   angle. The app needs one record holding both, so the writer can pick the angle that fits the job without inventing
   anything.
4. **A way to measure fit.** How well a resume matches the posting and the company, which keywords are missing, and
   whether a missing one is something you actually have (so it can be added) or a real gap (so it must not be).

## Phases

| Phase | What | Depends on |
| --- | --- | --- |
| 1 | Library: resumes, cover letters and emails stored as content, with versions | nothing |
| 2 | Editor and export: a Notion-like page editor, and one-page PDF and DOCX from the same layout | 1 |
| 3 | Career record (the "mega resume"): every employer, role, fact and wording, merged from the library | 1 |
| 4 | Fit score: a resume against a job and its company, shown live in the editor | 1, 2 (3 makes it smarter) |
| then | Stage 4 writing uses all of the above | 1 to 4 |

Editor and export are one phase because they share one layout: what you see while editing is what the PDF and DOCX
contain.

---

## Phase 1: Library (content, not files)

### What the user gets

- A **Library** page in the sidebar with tabs **Resumes, Cover letters, Emails**.
- Add a document by uploading a PDF or DOCX, by pasting text, or by starting a blank one (or a copy of the base
  resume). Optionally link it to a job (which also links the company), and give it a title, target role and date.
- Each document opens in the editor (Phase 2). Until Phase 2 lands, it opens as read-only Markdown.
- Sent outreach emails show up in the Emails tab automatically. Older emails written elsewhere can be pasted in.
- The base resume on the Profile page is just the library resume marked **Base**.
- Versions linked to a job lock when the job is marked Applied, so you can always see exactly what you sent.

### Content is the source of truth

The app keeps the **content and structure** of what you upload, not the file. On upload:

1. Read the file in memory. DOCX: `mammoth` to HTML. PDF: `unpdf` text per page, then rules to recover headings and
   bullets (line breaks, bullet characters, all-caps lines). Scanned PDFs (no text layer) are rejected with a clear
   message.
2. For resumes, structure it with the model (`parseResume`, already built) and turn the structured resume into an
   editor document (header, sections, roles, bullets). If structuring fails, fall back to plain headings and
   paragraphs from step 1, and say so.
3. Store the editor document, plus Markdown and plain text derived from it (for search, the index and AI prompts), and
   the original name, type and SHA-256 hash (to spot duplicate uploads).
4. Queue the existing index steps (sections, embeddings in `resume_chunks`).
5. Drop the bytes. See "Decision: files" below for the one exception.

### Data

- `documents`: one row per document. `kind` (resume, cover_letter, email), `origin` (uploaded, pasted, blank, sent,
  generated), `title`, `job_id`, `company_id`, `target_role`, `is_base`, `source_name`, `source_mime`,
  `source_sha256`, `page_settings` (jsonb, Phase 2), timestamps.
- `document_drafts`: the one working copy per document that the editor autosaves into (same idea as the outreach
  draft). Overwritten freely.
- `document_versions`: immutable checkpoints. `document_id`, `version`, `content` (jsonb, the editor document),
  `markdown`, `plain_text`, `note`, `locked_at`, `created_at`. A trigger rejects updates except setting `locked_at`,
  like `profile_versions`.
- The index moves from files to versions: `resume_indexes` and `resume_chunks` gain `document_version_id` (the old
  `file_id` stays for rows made before the move).
- **Migration:** every `past_resumes` row and every base resume becomes a document. Its existing parsed data (or
  extracted text) becomes version 1. Existing files on disk are left alone; nothing is deleted.

### Decision: files

Emails today attach the stored resume file, and the sent history links to the exact file that went out. If files are
not kept, something else has to be attached. Options:

- **A. Keep files only when they leave the app (recommended).** Uploads are not kept. A file is stored only when it is
  attached to an email, whether uploaded in the composer or exported from the editor, so the history still shows
  exactly what was sent.
- **B. Never keep files.** Attachments are always exported from content when sending. Simplest storage, but the sent
  history can only show the content version, not the exact bytes.
- **C. Keep the original file too.** Content is still the source of truth; the file is a backup. Costs little disk
  space.

---

## Phase 1 as built

What shipped, and where it differs from the plan above.

- **Tables** (migrations `0015_documents`, `0016_resume_index_versions`): `documents`, `document_drafts`, `document_versions`
  (immutable by trigger; the only allowed change is locking a version once, and a lock is never undone, with a generated
  full-text column). `resume_indexes` and `resume_chunks` are now keyed by document version. Index rows made for files before
  this are kept as they were and are no longer used. `outreach_emails` gained the attachment document and version columns
  (not used until Phase 2).
- **Content format:** an editor document (Tiptap JSON): header, sections, roles, projects, education, skills lines, bullets.
  A role has four text fields (title, dates, company, location); dates are one field ("Jan 2022 - Present"), not two. Every
  section, role, project, education entry, skills line and bullet has a stable id. Content is checked in two layers: a Zod
  schema (known types, safe links, size and depth limits) and then the editor's own rules about which blocks may hold which.
- **Layout is shared:** the same node definitions and one CSS string render the read-only page now, and will render the
  editor and the PDF. Fonts (Carlito, Arimo, Tinos, SIL OFL) are bundled in `public/fonts`.
- **Reading files:** a DOCX is read through its HTML form (keeps bullets, heading styles and tables); a PDF is read as text.
  The planned PDF reading by font size and bold was not built; headings in a PDF are found by rules (known names, all caps).
- **Structuring:** an uploaded resume that is only headings and bullets is structured once by the model in the background and
  saved as a new version (reason "structured"), unless it was edited first. Custom sections are carried over.
- **Library import:** past resumes, the base resume and sent emails were moved in automatically (idempotent; runs when the
  worker starts, or `npm run backfill:documents`). `past_resumes` is kept, read only.
- **Files are still kept for resumes** (a deviation from "drop the bytes"): email attachments send the stored file, and the
  PDF export that replaces that comes in Phase 2. Cover letters keep no file. Once export exists, new uploads will stop
  keeping files (the decision in the plan: keep a file only when it leaves the app).
- **Profile:** the Past resumes tab is gone. Importing a resume file makes a new base resume document from the reviewed
  profile; editing a saved profile does not change the base document.
- **Not built yet from Phase 1:** attaching by exporting at send time, and locking a job's documents when it is marked
  Applied (both need Phase 2 or its export).

## Phase 2 as built

What shipped, and where it differs from the plan below.

- **Export** (`src/lib/documents/export/`): PDF through the shared Chromium (`src/lib/browser.ts`, idle close after five
  minutes, two renders at a time). The page is served from a private origin and every other request is blocked, so a link
  in a document can never make the server fetch anything. DOCX through the `docx` package: A4, the same fonts, sizes and
  spacing, real Word bullets, dates on a right tab. Markdown and plain text from the same document. `POST
  /api/documents/[id]/export` returns the file with the page count in a header; PDF and Word first save a version (reason
  `export`, skipped if nothing changed). Fonts (Carlito, Arimo, Tinos, SIL OFL) are bundled and used by the editor and the PDF.
- **Attachments are documents**, not files. A draft stores the chosen library resume. At send time an upload nobody has
  edited since goes out as its original file; anything else goes out as a PDF made then, stored (it left the app), and
  linked to the version it came from. That version is locked, the sent email is filed in the Library, and the sent history
  links to "Version N in your library". `outreach_emails.attachment_document_id` and `attachment_version_id` are used.
- **Files are no longer kept** on a Library upload or a Profile import (the decision in this document: a file is stored only
  when it leaves the app). Files from before, and composer uploads, are still kept and still go out as they are.
- **Locking on Applied** (`applyStatus`): a job's resume and cover letter get a version for unsaved edits, then the latest
  versions are locked, in the same transaction. Undo never unlocks.
- **Editor** (Tiptap, loaded only on the document page and only on screens of 768 px and up): autosave through
  `PUT /api/documents/[id]/draft` (a route, not a server action, and `keepalive` so a save still running when a tab closes
  survives), refused with 409 if another tab saved first. The keys, shortcuts, slash menu, selection toolbar and block
  handle are written without the drag handle package, which needs the collaboration libraries. The block menu has
  Duplicate, Move up and down, Delete; "Turn into" and dragging in the outline were left out.
- **One page is a switch** (`fitOnePage`, on by default), not a fixed limit: when it is off nothing is measured against a
  page, no marker is drawn and exports do not warn. When it is on, the editor measures a hidden copy of the exact HTML the
  PDF is made from, tightens spacing (never loosens it, never touches text), and a check against the real PDF
  (`POST /api/documents/[id]/fit`) wins over the estimate. The page-end marker is offset by the lines the editor shows that
  the PDF leaves out (empty fields).
- **Margins** are a setting of their own (Narrow half inch, the default, Normal three quarters, Wide one inch), separate from
  spacing, with an exact-millimetre override under fine tuning.
- A freshly uploaded resume is read-only for a few seconds while the AI structures it, so its result cannot land under
  an editor that is already open.
- Tests: key behaviour, the slash menu and the block actions run against a real (headless) editor in jsdom; the PDF tests
  run Chromium and check page counts, text order and that bullets are indented; export, locking and attachments run against
  the database. Browser checks covered typing, reload, drag and drop, two tabs, exports and the phone layout.

## Phase 2: Editor and export (the plan)

### The feel

Notion's ease on a real sheet of paper. You click into the page and type. No modes, no forms, no "edit" button. The
page on screen is the page that gets exported. Only the essentials are offered, so there is nothing to learn and
nothing that breaks the layout or applicant tracking systems.

### What the user gets

**The page**

- A letter or A4 sheet, centred, at true proportions, with the resume laid out on it. Zoom to fit width or 100%.
- A **page-break line** where page one ends. Content past it is tinted, and a chip says "1 line over" or "Fits on one
  page". Fitting on one page is the default goal; two pages can be allowed per document.
- Edits show immediately in the real layout, so there is never a separate preview.

**Writing**

- Type anywhere. `Enter` adds the next bullet, `Tab` and `Shift+Tab` indent and outdent, `Backspace` on an empty bullet
  removes it.
- Markdown shortcuts: `- ` starts a bullet, `## ` a section heading, `**bold**`, `_italic_`.
- **Slash menu** (`/`): section, role, bullet, skills line, project, education entry, text, divider. Typing filters
  it, the arrow keys pick, `Enter` inserts.
- **Selection toolbar** that appears over selected text: bold, italic, underline, link, and (from Stage 4) AI actions.
- **Drag handle** on hover beside every block: drag to reorder bullets, roles or whole sections. The same handle opens
  a menu with duplicate, delete, move up, move down and turn into.
- Undo and redo for everything, `Ctrl+Z` and `Ctrl+Shift+Z`.

**Resume blocks** (structured, so export and scoring understand them)

- **Header:** name, an optional headline, contact line (email, phone, location, links). New documents start without a headline; Backspace in an empty one removes it, and `/headline` adds it back. An empty headline never takes space in the PDF.
- **Role line:** "Title, Company, Location" on one line (company in italics) with the dates at the right. Markdown and Word follow the same shape.
- **Section:** a heading with blocks under it (Experience, Projects, Skills, Education, or any custom name).
- **Role:** company, title, location and dates on one line, laid out by the template (title left, dates right).
  Each part is its own field you click into; dates accept "Jan 2022", "2022" or "Present". Bullets sit under it.
- **Skills line:** a bold label and a comma list ("Languages: TypeScript, Python, Go").
- **Project** and **education entry:** like a role, with their own fields.
- **Text:** a plain paragraph (summary, cover letter body).

Cover letters and emails use the same editor with fewer blocks: text, bullet, link, and a subject field for emails.

**Page settings** (one small popover, per document, never per letter)

- Template: start with one clean layout (see open questions).
- Font: three choices that read well and parse well in applicant tracking systems.
- Size, line spacing and margins as one **Density** slider (Roomy to Tight), plus fine controls if wanted.
- Paper: Letter or A4. Accent colour: none or one muted colour.
- **Fit to one page:** steps density down within safe limits until it fits, or says which sections are too long.
  It never cuts text by itself.

**Side panel** (collapsible, so the page can have the full width)

- **Outline:** sections and roles, click to jump, drag to reorder.
- **Career record** (after Phase 3): every wording of the facts for the role you are in. Click or drag one in. This
  is how you swap the PM framing for the engineering one without retyping.
- **Fit score** (after Phase 4): live score against the linked job, missing keywords, and "in your record" items you
  can insert in one click.
- **Versions:** checkpoints, each readable and restorable (restoring makes a new version).

**Saving**

- Autosaves into the draft as you type (debounced, with a quiet "Saved" indicator). Nothing is lost when you leave.
- A **version** is made when you choose "Save version" (with an optional note), and automatically on export, on
  attaching to an email, and when the job is marked Applied. That keeps history meaningful instead of one version per
  keystroke.

**Export**

- **Download PDF** and **Download DOCX** from the editor header, named like `Name - Company - Role.pdf`.
- **Attach to email:** exports the PDF and attaches it in the job's outreach composer.

**Polish** (follows the app's shared motion system in `src/app/globals.css`)

- Menus and toolbars fade and scale in from where they open; dragged blocks lift with a shadow and the others slide
  aside; the fit chip animates between states; buttons show hover, press and loading states. All of it respects
  reduced motion.
- Desktop first. On a phone the document is readable and exportable, not editable.

### How it is built

- **Tiptap** (headless, on ProseMirror), loaded lazily on the editor page only, as already chosen in PLAN.md. Custom
  nodes for header, section, role, skills line, project and education entry; Tiptap's suggestion utility for the
  slash menu, its bubble menu for the selection toolbar, its drag handle extension for blocks. Confirm each extension's
  licence when installing (several were paid add-ons and later released as open source).
- The document is stored as Tiptap JSON, validated by a Zod schema, so the model in Stage 4 can write the same
  structure the editor reads.
- **One layout, three outputs.** The page is rendered by one React template and print CSS:
  - in the editor, as the editable page;
  - for PDF, the same HTML printed by Playwright (already a dependency) on the server;
  - for DOCX, the same structure written with the `docx` package (new dependency), using the page settings.
- The page-break line comes from measuring the rendered page against the paper height, using the same CSS as the
  PDF, so "fits on one page" in the editor means it fits in the PDF. A test exports fixtures and checks the page count.
- Text in the PDF stays real, selectable text (not an image), so applicant tracking systems can read it.

---

## Phase 3: Career record (the "mega resume")

### What the user gets

- A **Career record** page (or a tab in Library) showing everything you have done, grouped by employer, then role.
- Under each role: every fact, with all its wordings and which resumes each wording came from. Skills, projects,
  education, certifications and achievements are kept the same way.
- When a new resume comes in, the app proposes how it merges: "new role at XYZ", "same fact as before, new wording",
  "new fact". You accept or change each proposal. Nothing merges silently.
- You can edit anything by hand. Your edits win: a later merge never overwrites them (same rule as company profiles).
- No length limit. It is a directory of your career, not something you send.
- In the editor's side panel, the record offers the wordings for whatever role the cursor is in.

### Shape

```text
Employer      (name, linked to the companies directory, so aliases and merges apply)
  Role        (title, start, end, location; flagged when its dates overlap another role at the same employer)
    Fact      (one accomplishment or responsibility, with optional numbers and skills used)
      Wording (the exact text, the angle it was written for such as PM or engineering, the source document versions)
Skills, projects, education, certifications, achievements: each item with its sources
```

The example above works out as one employer, XYZ. It has either two roles (if they really were different jobs) or one
role with two **framings**, PM and engineering, for the same dates. Each framing has its own title and wordings. The
writer may use either framing, but never both titles at once.

### How the merge works

1. Structure the new resume (already done when it enters the library).
2. Match employers by name, using the companies directory's normalization (case, punctuation, Inc/LLC, aliases).
3. Match roles by date overlap and title similarity. Overlapping dates with a different title is proposed as a
   **framing** of the existing role, never decided automatically.
4. For each bullet, the extraction model judges whether it states the same fact as an existing one (add as a wording)
   or a new fact. It may only group text; it never rewrites it.
5. The proposal opens in a review screen. Saving creates a new **version** of the record (immutable, like profile
   versions), so any merge can be undone by restoring.

The first build runs this over every resume already in the library. Resumes edited in the editor feed the record when
a version is saved, through the same review.

### Relation to the Profile

The Profile keeps contact details, preferences and generation instructions. Its experience section stays as it is for
now (it is the base resume, structured). Once the career record is trusted, the profile's experience can become "the
default selection from the career record". That change is not part of this stage.

---

## Phase 4: Fit score (a resume against a job and its company)

### What the user gets

For a resume and a job (in the editor's side panel, and on the job itself):

- An **overall score** (0 to 100) and sub-scores: required skills, preferred skills, responsibilities, seniority and
  scope, company fit.
- **Keywords:** found and missing, from the posting (requirements, technologies, extracted keywords) and from the
  company (products, domain, stated values and principles from the companies directory). Found keywords can be
  highlighted on the page.
- Each missing item is labelled:
  - **In your record:** you have it (the career record or another resume says so) but this resume does not show it.
    Shows the wording that could be used, with an Insert button.
  - **Not in your record:** a real gap. Never added to anything you send.
- A short "why it fits" and "concerns" list, each point quoting the resume line or posting line behind it.

### How

- **Deterministic part:** keyword matching with normalization (case, plurals, common synonyms such as "JS" and
  "JavaScript", plus the expanded keywords from Stage 5). Same inputs, same result. Cheap enough to rerun on every
  pause in typing.
- **Model part (extraction model, structured output):** judges the requirements and responsibilities against the resume
  and returns sub-scores with evidence. The overall score is a weighted sum computed in code, not by the model. Runs
  when a version is saved or on request, not on every keystroke.
- **Company keywords** are extracted once per company profile and stored. They are refreshed when the profile changes.
- Cached per resume version, job snapshot and company profile update time, so a rerun is instant and stable.

This is the resume half of Stage 6. The job half (fit against your preferences and whole record, used by Discover)
reuses the same pieces later.

---

## Then: Stage 4 writing

Stage 4 generation takes: the job, the company profile, the career record (or the profile if there is none),
retrieved past wording (Stage 5), and your generation instructions. It writes the resume, cover letter and email as
editor documents, then runs the fit score and the accuracy check on its own output. Everything it writes lands in the
library as a `generated` document and opens in the editor.

The selection toolbar gains AI actions here: rewrite for this job, shorten, add the missing keyword. Each suggestion is
shown as a change to accept or reject, and checked against the career record so nothing is invented.

## Open questions

1. **Files:** option A, B or C above?
2. **Roles that differ across resumes:** when two resumes give the same employer and dates different titles, treat them
   as framings of one role (as above), or always ask?
3. **Template:** copy your existing resume template (send a sample), or start with one clean standard one-page
   layout? More templates can come later.
4. **Cover letters and emails in the career record:** facts that appear only in a cover letter (a story, a reason for
   applying) could go into the record too. Include them, or keep the record to resume content?
5. **Score weights:** start with required skills 35, responsibilities 25, preferred skills 15, seniority 10, company
   fit 15, and tune later?
6. **Paper size:** Letter, A4, or both with a per-document choice?
