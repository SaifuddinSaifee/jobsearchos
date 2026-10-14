# Stage 4a Phase 3: Career record (plan)

## Context

Job Search OS can store, edit and export resumes, cover letters and emails in the Library, but it has no single record of everything the user has done. Generation (Stage 4) and the fit score (Phase 4) both need one: a fact bank merged from every resume, cover letter, the Profile and a LinkedIn print. With it the writer can pick the right angle (PM or engineering) without inventing anything. This plan builds that record, with a review step so nothing merges silently, immutable versions so any merge can be undone, and a side panel in the editor. Generation and scoring do not start until the record is trusted.

Note: the handoff said nothing is committed on `stage-4a`, but the Phase 1 and 2 work is committed (`ad51e32`) and the tree is clean.

## Decisions (confirmed with the user)

1. **Framings:** the same employer with overlapping dates and a different title is **one role with several framings**. The role's dates and location are merged automatically, and a date conflict becomes a note, never a blocker. Each framing keeps its own title, angle (e.g. Product, Engineering), the target roles of its sources, and its wordings. Facts are shared, so one fact can hold a PM wording and an engineering wording. The review proposes the framing and never applies it without review.
2. **Cover letters are included now.** Paragraphs are classified as a story about a role (attached as a long-form wording of a fact), a reason for applying to a company, a general reason, or boilerplate (skipped). The model only classifies and groups. It never writes text.
3. **Placement:** a fourth Library tab, **Career record** (`/library?tab=record`), with the review screen at `/library/record/review`.
4. **Sources:** Library resumes and cover letters, the Profile, and a LinkedIn profile printed to PDF (Cmd+P) that the user uploads. No source takes precedence. LinkedIn files are not kept, only their cleaned text.
5. **Your edits win**, using the company provenance pattern (`updateCompany` and `applyResearch` in `src/lib/companies/service.ts`).
6. The Profile itself is unchanged.

## Data model

**The record is one versioned jsonb snapshot** (like `profile_versions`), checked by a Zod schema in `src/lib/career/schema.ts`. With one snapshot, restore is trivial, merge and edit are pure functions `(record, input) => record`, and the size stays small (a few hundred KB). Lookups by role load the latest version and filter in memory.

Record shape (ids from `newId()` in `src/lib/documents/build.ts`; every item has `sources: {sourceId, blockId|null}[]` and `provenance: {origin: "merge"|"user", user: string[]}`):

| Item | Fields |
| --- | --- |
| Employer | `name`, `companyId` (linked by `findCompanyByName` only, never created), `names[]`, `roles` |
| Role | `start`, `end`, `current`, `location`, `dateNotes[]`, `framings`, `facts` |
| Framing | `title`, `angle`, `targetRoles[]` |
| Fact | `wordings` |
| Wording | `text`, `framingId`, `form: bullet \| paragraph` (paragraph is a cover letter story) |
| Other items | Skill, Project (with its own wordings), Education, Certification, Achievement |
| Motivation | `text`, `scope: company \| general`, `companyId`, `companyName` (from the document, never from the model) |
| `removed[]` | Tombstones of user deletes, so a later merge proposes "leave out" with the label "You removed this before" |

**Migration `drizzle/0017_career_record.sql`** (`drizzle-kit generate --name career_record`, then hand-append the custom SQL):

- **`career_record_versions`**:
  - Columns: `version` (unique), `record` jsonb, `record_schema`, `reason` (merge, edit, restore), `change_note`, `proposal_id`, `restored_from_version_id`, `created_at`.
  - Made immutable by a trigger that reuses `reject_mutation()` from `drizzle/0002_jobs.sql`.
- **`career_sources`** (what was ingested):
  - Columns: `kind` (resume, cover_letter, profile, linkedin), `document_id`, `document_version_id`, `profile_version_id`, `text` (LinkedIn only), `content_sha256`, `label`, `target_role`, `company_id`, `company_name`, `written_on`.
  - CHECKs tie the kind to its key column.
  - Content that is already applied is skipped by sha.
- **`career_proposals`** (both the work queue and the review state, following the `resume_indexes` pattern):
  - Columns: `status` (queued, running, ready, applied, dismissed, superseded, failed, undone), `priority`, `base_version`, `proposal` jsonb, `decisions` jsonb (autosaved during review), `applied_version_id`, `attempts`, `note`, `error`, timestamps.
  - A partial unique index allows **only one proposal running or ready at a time**, so each proposal is computed against the newest record.
- Add the three tables to the TRUNCATE list in `tests/helpers.ts`.

**Service `src/lib/career/service.ts`** (mirrors `src/lib/profile/service.ts`):

- `getLatestRecord`, `listRecordVersions`, `getRecordVersion`.
- `saveRecordVersion({record, reason, note, proposalId, expectedVersion})` takes an advisory lock and raises `RecordConflict` if `expectedVersion` is stale.
- `restoreRecordVersion` saves the old record as a new version and marks later applied proposals `undone`, offering "Review again".

## Merge pipeline (`src/lib/career/`, pure where possible)

- **`extract.ts`:**
  - `extractFromDoc(doc)` follows `docToProfile` (`src/lib/documents/convert/doc-to-profile.ts`) but **keeps the role and bullet block ids**. It reuses `children`, `textOf` and `plainText` from `src/lib/documents/read.ts` and `parseDates`.
  - `extractFromProfile(profile)` gives the same shape with null ids.
  - `paragraphsOf(doc)` returns cover letter paragraphs, keyed `p{index}:{sha8}`.
- **`dates.ts`:**
  - `toMonths` handles "Jan 2022", "January 2022", "01/2022", "2022-01", "2022" (fuzzy), "Summer/Q3 2021" (fuzzy) and Present, and strips LinkedIn duration tails.
  - Also `overlapMonths`, and `mergeRange` (widest range plus a conflict flag).
  - A fuzzy range never creates a conflict note.
- **`match.ts`:**
  - **Employer:** matched by `companyId`, then by `normalizeCompanyName` (`src/lib/companies/service.ts`) against `names`.
  - **Role, same:** the same normalized title, or title similarity of 0.8 or more.
  - **Role, framing:** overlap of at least 50% of the shorter span, or 4 or more months, with a different title. A promotion with a 1-month overlap counts as a new role.
  - `guessAngle(title)` uses keyword rules.
- **`dedupe.ts`** (deterministic, no model):
  - **Exact text:** the bullet is `known`, so only the source is added.
  - **Lineage:** the same bullet block id as an existing wording (copies keep ids) with similar text means "same bullet, edited".
  - Near-identical text is the same fact.
  - Skills, education, certifications, achievements and projects are matched by normalized keys.
  - Tombstones are flagged.
- **`group.ts` (model, step 5):**
  - One `chatStructured` call per role, sent only the bullets that are still unmatched.
  - The output schema is built per call from **enums only**: bullet aliases, fact aliases or `new`, and a `sameAsBullet` alias. The model therefore cannot return text.
  - Aliases that do not exist are dropped, and missing bullets become `new`.
  - Roles with more than 60 facts get a top-15 token-overlap prefilter.
  - A failed call is retried once, then the proposal is marked `failed` with a Retry button.
- **`cover.ts` (model, step 6):** enum-only classification of each paragraph into story, motivation_company, motivation_general or boilerplate, plus a role alias. Stories then go through `groupBullets`.
- **`linkedin.ts` (step 7):**
  - `cleanLinkedInText` strips the print noise: "Page N of M", "Show all", endorsements, followers, Connect, duration fragments.
  - Then `parseResume` (`src/lib/resume/parse.ts`), then `extractFromProfile`.
- **`proposal.ts`:**
  - `buildProposal` assembles items with stable keys and suggestions (same, framing or new role; known, fact or new for bullets).
  - **Guard:** every wording text must equal a source string byte for byte, or it throws.
- **`apply.ts`:**
  - `resolveDecisions` is shared by the review UI and apply. Changing a role to "new" sends its bullets to new facts.
  - `applyProposal`:
    - **Never changes existing text.** It only adds sources and items, and fills empty fields.
    - Dates widen unless the user edited them, in which case only a note is added.
    - It checks exact text again so nothing is duplicated.
  - `checkRefs` checks a stale base.
  - `applyEdit(record, op)` handles manual edits. It sets `provenance.user`, and a delete adds a tombstone.
- **`ingest.ts`** follows the queue pattern in `src/lib/resume/indexing.ts`: `enqueueDocumentSource`, `enqueueProfileSource`, `addLinkedInSource`, `startBuild`, `claimNextProposal`, `touchProposal`, `sweepStaleProposals`, and `processProposal(id, deps)` with the model injected. It gets a career slot in `tick()` in `src/lib/queue/worker.ts` (concurrency 1, 5-minute timeout).

**Applying a reviewed proposal:**

1. Load the latest record.
2. If its version differs from the proposal's base, run `checkRefs`. If the refs are valid, apply on top of the latest record. If not, return "stale": the proposal is requeued and its decisions are kept by key.
3. `saveRecordVersion(reason merge)`.
4. Mark the proposal applied and `kickWorker()` to prepare the next one.

**Initial build:**

- **One proposal per source, reviewed one at a time against the newest record.** A later proposal mostly finds bullets already in the record, so they collapse.
- Order: base resume, then other resumes from newest to oldest, then the Profile, then LinkedIn, then cover letters last (so stories have roles to attach to).
- Each applied source is its own version, so it can be undone on its own.

## UX

- **Record tab** (`library-tabs.tsx` adds `"record"`; `src/components/career/record-view.tsx`):
  - **Header:**
    - "Build from library" (shown before the first version).
    - "Review N waiting".
    - A "Preparing X (3 of 27)" status that polls `GET /api/career/status` through a React Query hook, styled like `use-resume-indexes.ts`.
    - "Add LinkedIn PDF".
    - "Include Profile".
    - A Versions `Sheet` with View and Restore.
  - **Body:**
    - Search.
    - Employers, each in a `Collapse`.
    - Role cards with dates, an amber date note, and framing chips with a framing filter (Tabs).
    - Facts, then wordings, each with a framing badge, "Edited by you" (the provenance tones from `company-editor.tsx`), and source chips linking to `/library/[id]?version=`.
  - **Edit menus** (`DropdownMenu`):
    - Edit text, Move to fact, Make it its own fact, Delete.
    - Split framing into separate role, Merge roles.
    - Add fact, Add wording.
  - Each edit goes through `editRecordAction(op, expectedVersion)` in `src/app/(app)/library/record/actions.ts` and saves one version.
- **Review screen** (`src/app/(app)/library/record/review/page.tsx`, `src/components/career/proposal-review.tsx`):
  - **Layout:** `lg:grid-cols-[1fr_24rem]` with a sticky source-text aside, like the profile import review in `profile-tab.tsx`.
  - **Header:** "Source 3 of 27", Leave this source out, Accept all, Save to record (Button `loading`).
  - **Employer:** matches or new, with a change Select.
  - **Role:** a suggestion chip and a segmented choice of same framing, new framing (with an angle input), separate role, or another role. "Compare bullets with this role" re-runs grouping.
  - **Bullets:** "N already in your record" collapsed. "Same fact as" shows the wordings side by side, with Make it a new fact and Move to another fact (a Command picker). Accept (Check) and leave out (X) toggles. Previously removed items start left out.
  - Chip lists for skills, education, certifications, achievements and projects.
  - Cover letter paragraphs get a kind Select, plus role and fact pickers for stories.
  - Decisions autosave (debounced, `saveDecisionsAction`).
- **`/library/record`** redirects to `/library?tab=record`. The static segment takes precedence over `[id]`; check this in `node_modules/next/dist/docs/`.
- **Editor side panel:**
  - A "Record" toggle in the toolbar of `document-editor.tsx` (resumes only) opens an aside, `xl:grid-cols-[1fr_20rem]`, which slides in.
  - `record-panel.tsx` finds the role under the cursor through a `useEditorState` selector over `selection.$from`.
  - It fetches `GET /api/career/wordings`. The match is by source block id first, then by employer and role text.
  - It lists facts and wordings, with "On the page" badges or an Insert button.
  - `insertBullet(editor, rolePos, text)` in `commands.ts` uses `apply()`, which checks the document.
- **Motion:** Button `loading`, `Collapse`, `Tabs`, and `animate-in fade-in slide-in-from-bottom-1 duration-300 motion-reduce:animate-none` on items as they appear. Hover backgrounds on rows. No symbol characters: lucide icons and words only.

## Build steps

Each step has vitest tests, `npm run typecheck`, `npm run lint`, and a real-browser check (`npm run dev`; kill it by port).

1. **Foundation.**
   - Schema, migration 0017, `tests/helpers.ts`, `career/schema.ts`, `career/service.ts`.
   - The Record tab with an empty state, the Versions sheet, and the `/library/record` redirect.
   - Delete the stray `docs/STAGE-4a-PLAN.md`.
   - Tests (`tests/career-service.test.ts`): versions increment, the trigger blocks UPDATE and DELETE, restore, `expectedVersion` conflict, Zod rejects a bad record.
2. **Deterministic merge core** (pure): `extract`, `dates`, `match`, `dedupe`, `proposal`, `apply`.
   - Tests:
     - Block ids are kept.
     - A table of about 30 date formats.
     - Same role, framing, promotion with a 1-month overlap, "Google LLC" vs "Google".
     - User-edited dates are kept and get a note.
     - Exact-text idempotence.
     - A new role sends its bullets to new facts.
     - Tombstones.
     - The byte-for-byte guard.
3. **Queue, build and review** (resumes and Profile; unmatched bullets become "new fact").
   - `ingest.ts`, worker slot, status route and hook, review page, actions (`startBuild`, `saveDecisions`, `applyProposal`, `dismiss`).
   - Tests (`tests/career-ingest.test.ts`): order, sha skip, one open proposal, apply moves the queue on, a stale base with valid and invalid refs.
   - Browser: build over the real library, review, change a role to separate, save, the next source prepares, restore.
4. **Browse and manual edits.**
   - The full record view, `applyEdit` ops, provenance badges, tombstones, `undone` with "Review again".
   - Tests: every op; a later merge never overwrites an edit; a deleted item comes back flagged.
5. **Model fact grouping:** `group.ts`, `regroupRoleAction`, and the side-by-side "Same fact as" UI.
   - Tests: unknown ids are dropped, missing bullets become new, the schema has only enum fields, the prefilter caps prompt size, a failure can be retried.
   - Check on real data with two reworded resumes.
6. **Cover letters:** `cover.ts`, paragraph cards, a Motivations section in the record, stories as paragraph wordings.
   - Tests: the company comes from the document, boilerplate is skipped, text is kept exactly.
7. **LinkedIn and Profile sources:**
   - `linkedin.ts`.
   - `src/app/api/career/linkedin/route.ts`: multipart, `extractResumeText` from `src/lib/resume/extract.ts`, text only, 409 on the same sha.
   - The "Include Profile" action, plus a hook after the profile is saved in `src/app/(app)/profile/actions.ts`.
   - Tests: a synthetic noisy LinkedIn fixture; the profile sha skip.
   - Browser: upload a real Cmd+P print (the user provides it).
8. **Editor feed and side panel:**
   - `enqueueAfterCreate` (`src/lib/documents/queue.ts`) also queues a record source for resumes and cover letters once a record exists. Drop the `kind === "resume"` gates at `src/app/(app)/library/actions.ts:71,100`; indexing filters by kind itself.
   - A newer version supersedes an older pending proposal of the same document.
   - A resume source waits for its index or structuring; without structure it falls back to `parseResume`.
   - `record-panel.tsx`, the wordings route, and `insertBullet`.
   - Tests: supersede, waiting for the index, role lookup, and `insertBullet` with and without a bullet list.
   - Browser: save a version, see "1 waiting", insert a wording from the panel, undo it.

After each step, update `docs/STAGE-4A-CAREER-LIBRARY.md` ("Phase 3 as built", and record the answered open questions 2 and 4) and `docs/PRODUCT.md` (Library section, status, roadmap).

## Risks to watch

- **Odd date formats and year-only dates.** A role whose dates cannot be read is never framed automatically; it shows "Dates could not be read".
- **LinkedIn print noise, and several titles under one company.** The review is the safety net.
- **Invented text from the model.** Output schemas are enum-only, and the proposal guard checks text byte for byte.
- **Stale proposals after edits or a restore.** `checkRefs`, the advisory lock and `expectedVersion` handle these.
- **An ignored ready proposal blocks the queue.** This is intended, and a banner in the tab shows it.
- **`duplicateDocument` reuses block ids.** Lineage only ever suggests a match, and low-similarity text goes to the model.

## Verification

- `npm test` (all 607 existing tests plus the new career tests), `npm run typecheck`, `npm run lint`, and `npm run db:setup` (or `db:migrate`) for 0017 on the dev and test databases.
- A real-browser pass at each step: build the record from the actual Library, review and save several sources, check framings on a PM resume against an engineering resume, edit and re-ingest to confirm the edit wins, restore a version, upload a LinkedIn PDF, and insert a wording from the editor panel. Check the hover, press, loading and transition states and the reduced-motion behaviour.
