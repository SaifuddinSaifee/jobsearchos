# Plan: Stage 2: New Application → structured job

## Context

Stages 0–1 are built: the app shell, Postgres/Drizzle, `chatStructured()` (GLM-5.3 Flash + Zod), content-addressed `putFile()`, and the profile/past-resume flows. `/new` is still a `ComingSoon` placeholder. Stage 2 (docs/PLAN.md) turns a pasted job URL, or pasted JD text, into a clean, deduplicated job row with an immutable snapshot and keywords. The user reviews the extracted fields and saves them.

Decisions confirmed with the user:
- **Playwright fallback** for JS-rendered pages.
- **Save creates job + application** (`applications` + `status_events` arrive now, with initial status `saved`).
- **Fixtures come from both** the user's own URLs and a public set that I pick to cover every ATS.

Following the Stage 1 convention, tables are created in the stage that uses them. `jobs.embedding` comes in Stage 5 and `jobs.source_id` in Stage 8.

---

## 1. Dependencies and config

- `npm i playwright @mozilla/readability jsdom` and `-D @types/jsdom`. Add the script `"browsers:install": "playwright install chromium"` and document it in the README.
- `next.config.ts`: `serverExternalPackages: ["playwright", "jsdom"]`.

## 2. Schema: migration `drizzle/0002_jobs.sql` (generated, plus custom SQL)

In `src/lib/db/schema.ts`:
- **enums:** `job_status[discovered|saved|ignored]`, `job_origin[manual|discovery]`, `remote_type[remote|hybrid|onsite|unknown]`, `fetch_method[greenhouse|lever|ashby|workday|smartrecruiters|workable|jsonld|html|playwright|paste]`, and `application_status` with the full Stage 3 list (Saved … Ghosted).
- **`jobs`:**
  - Columns: id, canonical_url (unique, nullable for paste-only jobs), application_url, ats, ats_job_id, company, title, location, remote_type, employment_type, salary_min/max (int), salary_currency, salary_period, posted_at (date), responsibilities jsonb `string[]`, requirements jsonb `{required[], preferred[]}`, technologies text[], origin, status, dedup_key (unique), created_at, updated_at.
  - `search_vector`: a generated `tsvector` column (title A, company B, technologies/requirements C) with a GIN index.
- **`job_snapshots`:** id, job_id, source_url, fetch_method, raw_file_id → files, raw_text, normalized jsonb (the LLM output before user edits), model, fetched_at. Made **immutable** by a generic `reject_mutation()` trigger function, following the pattern in `drizzle/0001_immutable_profile_versions.sql`.
- **`job_keywords`:** (job_id, keyword, kind[extracted|expanded]) with a composite primary key.
- **`applications`:** id, job_id (unique FK), status default `saved`, applied_at, application_url, notes, timestamps.
- **`status_events`:** id, application_id, from_status (nullable), to_status, at, note.
- Update `tests/helpers.ts` `resetDb` to truncate the new tables.

## 3. Fetch pipeline: `src/lib/jobs/fetch/`

Every step takes an injectable `fetcher` (default: `fetch` with UA, 15 s timeout, 5 MB cap) so fixtures can replay recorded responses.

| File | Responsibility |
|---|---|
| `url.ts` | `canonicalizeUrl()` (https, lowercase host, drop `utm_*`/`gclid`/`ref`/fragment); `detectSource(url)` → `{ats, ids}`; http(s) only; LinkedIn/Indeed hosts → `blocked` straight away |
| `ats/greenhouse.ts` | `boards-api.greenhouse.io/v1/boards/{board}/jobs/{id}?pay_transparency=true` (from `boards.`/`job-boards.greenhouse.io` URLs) |
| `ats/lever.ts` | `api.lever.co/v0/postings/{co}/{id}` (also `api.eu.lever.co`) |
| `ats/ashby.ts` | `api.ashbyhq.com/posting-api/job-board/{org}?includeCompensation=true`, then select the posting by id |
| `ats/workday.ts` | `{tenant}.wdN.myworkdayjobs.com/[locale/]{site}/job/...` → `GET /wday/cxs/{tenant}/{site}/job/{path}` |
| `ats/smartrecruiters.ts` | `api.smartrecruiters.com/v1/companies/{co}/postings/{id}` |
| `ats/workable.ts` | `apply.workable.com/api/v2/accounts/{acct}/jobs/{shortcode}` |
| `jsonld.ts` | Find `JobPosting` in `ld+json` scripts (arrays and `@graph`); map it to hints |
| `html.ts` | Fetch HTML → JSON-LD → Readability (jsdom) → text. If text is under ~800 chars or the page looks like an SPA shell → `browser.ts` |
| `browser.ts` | Lazily launched singleton headless Chromium; `goto` + wait for network idle (20 s cap) → `page.content()` → JSON-LD + Readability again |
| `index.ts` | `fetchJob(url, onStep)` orchestrator: ATS API → JSON-LD → HTML → Playwright |

Every adapter returns `FetchedPosting { method, sourceUrl, applicationUrl, raw: {body, mime}, text, hints }`. `hints` holds fields the API gives reliably (title, company, location, postedAt, salary), and these override the LLM's values. 403/429/captcha pages and near-empty text raise `FetchError{code:"blocked"|"empty"|"not_found"}`, which the UI turns into a "paste the JD text" prompt. HTML descriptions from the APIs go through the same HTML→text helper.

## 4. Structuring, dedup and service: `src/lib/jobs/`

- `schema.ts`: `JobExtractionSchema` (no `.default()`; nullable fields, the same convention as `ProfileSchema`), including `keywords: string[]`, plus `JobDraftSchema` = the extraction plus url/method/snapshot references, which the save action validates.
- `extract.ts`: `extractJob(text, hints)` → `chatStructured(JobExtractionSchema, …)`.
  - Prompt rules: use only what is written; salary as numbers with currency and period; ISO dates or null; split required from preferred; technologies as a flat list; 10–25 JD keywords.
  - The text is capped at about 60k characters, and hints are merged over the model's output.
- `dedup.ts`: `normalize()` (lowercase, strip punctuation and company suffixes like inc/llc/gmbh, collapse whitespace) → `dedupKey = sha256(company|title|location)`.
- `service.ts`:
  - `findDuplicate({canonicalUrl, dedupKey})`.
  - `saveJob(draft)` runs one transaction: insert job (`status=saved, origin=manual`) → snapshot → keywords (`extracted`) → application (`saved`) → status_event (`null→saved`). A unique-constraint conflict returns `{duplicate: existingId}`.

## 5. API and UI

- **`POST /api/jobs/extract`** (route handler, `runtime="nodejs"`, `maxDuration=120`; same pattern as `src/app/api/resume/parse/route.ts`):
  - Body: `{url}` or `{text, url?}`.
  - Returns an SSE-formatted `ReadableStream` with events `step` (detect / fetch / render / structure, each with a status), `duplicate`, `result` (draft, rawFileId, rawText, method) and `error` (code, message).
  - Raw HTML/JSON is stored with `putFile()` during extraction (write-once, so this is harmless if never saved).
  - Small helper `src/lib/sse.ts`: server `encodeEvent()` plus a client `readEvents(response)`. It uses POST with `fetch` streaming, since `EventSource` only supports GET.
- **`src/app/(app)/new/page.tsx`** → client `src/components/jobs/new-application.tsx`:
  - URL / Paste-text tabs (nuqs).
  - Live step list.
  - On `blocked`, it switches to the Paste tab with the URL kept.
  - A duplicate shows a banner linking to the existing job.
- **Review form** `src/components/jobs/job-review-form.tsx`:
  - React Hook Form + `JobDraftSchema`.
  - Reuses `LinesField` / `TagsField` from `src/components/profile/fields.tsx` for responsibilities, requirements, technologies and keywords.
  - Raw-text side panel, mirroring the profile editor.
  - **Save** → server action `src/app/(app)/new/actions.ts` `saveJobAction` → toast → redirect to `/jobs`.
- **`/jobs`**: a minimal server-rendered list (company, title, status, saved date), so saved jobs are visible until the Stage 3 TanStack table replaces it.

## 6. Fixtures and evals

- `scripts/snapshot-job.ts <url…>` runs `fetchJob` with a recording fetcher and writes `tests/fixtures/jobs/<slug>/` (recorded responses + `meta.json`). Then `--draft` runs the real model and writes `expected.json` for the user to review and correct.
- Fixture set (25–30):
  - the user's URLs;
  - my public picks, at least 2 each for Greenhouse, Lever, Ashby, Workday, SmartRecruiters and Workable;
  - JSON-LD career pages, at least 2 SPA/Playwright pages, and 2 paste-text cases.
- **Vitest (deterministic, no LLM):**
  - URL canonicalization and ATS detection table;
  - each adapter parsing its recorded response;
  - JSON-LD extraction;
  - Readability text;
  - dedup normalization;
  - `extractJob` with a mocked client (hint merging);
  - integration against `jobtracker_test`: `saveJob` writes all five tables, a duplicate is detected, and the snapshot trigger rejects UPDATE/DELETE.
- **`npm run eval:jobs`:** replays the fixtures through the real model and scores each field (exact for title and company; normalized for location, remote type and salary; set overlap ≥0.8 for technologies and keywords). It prints a scorecard and the overall pass rate; the target is ≥90%.

## 7. Docs

Update `docs/PLAN.md` Stage 2/3: `applications` and `status_events` move into Stage 2, and `embedding`/`source_id` are deferred. Add `docs/STAGE-2-PLAN.md`, a copy of this plan.

---

## Verification

1. `npm install`, `npm run browsers:install`, `npm run db:migrate`, `npm run dev`.
2. `/new`: paste a Greenhouse URL. Steps stream live, the draft shows API-sourced title/company/salary, then Save → the job appears on `/jobs`. In psql, one row each in jobs/application/status_event, plus a snapshot and keywords.
3. Repeat with Lever, Ashby, Workday, SmartRecruiters, Workable, a JSON-LD career page and a JS-rendered page (method = `playwright`).
4. A LinkedIn URL → a "paste the text" prompt → paste → extract → save.
5. Paste the same URL again → duplicate banner. Same job via a different URL → caught by `dedup_key`.
6. `npm test` all green; `npm run eval:jobs` ≥90%; `npm run typecheck`, `npm run lint` and `npm run build` pass.
