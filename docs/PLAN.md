# Build Plan — AI Job Search OS

Stage-wise implementation plan, based on the PRD and the workflow walkthrough below.

---

## Core workflows

### 1. Apply to a new opportunity

1. Open **New Application** and paste the job posting URL.
2. The app fetches the page and the **Claude (Sonnet 5.5)** converts it into a structured job record in Postgres.
3. Review the extracted fields and **Save**. The job appears as a row in the **Jobs dashboard**.
4. The row's **Actions** column offers:
   - Generate resume / View & edit resume
   - Generate cover letter / View & edit
   - Generate cold email / View & edit
   - Find contact, Send cold email
   - Update status
5. Generated content is reviewed and edited in the app, then **copied manually into the user's own resume template** (the template is tightly formatted, so the app does not render PDFs). The final PDF can optionally be uploaded back and attached to the application.

### 2. Learning from past resumes

Every generated resume is stored and indexed. When generating a new one, the app:

1. Extracts keywords from the JD (e.g. "automation", "n8n", "Zapier").
2. Asks the LLM to **expand** them with related keywords not in the JD (e.g. "workflow orchestration", "Make.com", "webhooks").
3. Searches **past jobs and past resumes** with hybrid search (vector similarity + full-text on those keywords), then has Claude rerank the best candidates.
4. Feeds the most relevant past resume bullets/sections into generation as reference material.

### 3. Job discovery

A **Discover** page in the sidebar lists openings from configured sources, starting with **Fortune 500 companies and Y Combinator startups**. Prefer official/public APIs and ATS endpoints over scraping. Each opening is normalized by Claude into a Postgres row. **Save** moves it into the Jobs dashboard, where the apply workflow takes over.

### 4. Contact discovery and cold email

For each saved job, the app suggests **the best person to contact** (hiring manager > team lead > recruiter) and **sends the cold email from the user's own Gmail** directly from the dashboard. Sending is always a manual, explicit click.

---

## Stack

| Concern          | Choice                                                                                                                                                            | Why                                                                                                                    |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| App              | **Next.js (App Router) + TypeScript**                                                                                                                             | UI and API in one codebase                                                                                             |
| DB               | **PostgreSQL + Drizzle ORM**                                                                                                                                      | Structured rows, full-text search (`tsvector`) and vector search (pgvector) for past-resume retrieval                  |
| LLM (everything) | **Anthropic API** (`@anthropic-ai/sdk`): **Claude Opus 5.5** writes, **Claude Sonnet 5.5** extracts, scores and classifies, **Claude Haiku 4.5** does bulk triage | One provider; structured outputs (`output_config.format` + Zod) guarantee schema-valid JSON for every non-writing task |
| Embeddings       | **`qwen3-embedding:4b`** via Ollama (local, the only local model)                                                                                                 | Vectors for past-resume retrieval, stored in pgvector; everything else uses Claude                                     |
| Fetching         | `fetch` → ATS APIs / JSON-LD → Playwright fallback for JS-rendered pages → Readability                                                                            | Cheapest and most reliable method first                                                                                |
| Background jobs  | **pg-boss** (queue on Postgres)                                                                                                                                   | Extraction, embedding, discovery runs; no Redis                                                                        |
| Email            | **Gmail API** (OAuth, `gmail.send` scope)                                                                                                                         | Sends from the user's own address; thread IDs stored for follow-ups                                                    |
| Contact finding  | Hunter.io / Apollo.io API (pluggable `ContactFinder`) + JD parsing                                                                                                | Finds names, titles, verified emails                                                                                   |
| Files            | Local disk, content-addressed (`storage/<sha256>`)                                                                                                                | Uploaded resumes and final PDFs are write-once                                                                         |
| UI               | **shadcn/ui** (Radix primitives + Tailwind CSS v4), full frontend stack below                                                                                     | Components are copied into the repo, so there is no component-library runtime and only what is used ships              |
| Dev              | Docker Compose (Postgres), npm, Vitest, Playwright e2e                                                                                                            | —                                                                                                                      |

---

## Frontend

Goal: a UI that feels instant, even with thousands of jobs in the tables.

| Concern                  | Choice                                                                           | Why                                                                                                                                      |
| ------------------------ | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Components               | **shadcn/ui** on Radix primitives                                                | Accessible, unstyled primitives with code owned in the repo; no library runtime, nothing unused in the bundle, full control over styling |
| Styling                  | **Tailwind CSS v4**                                                              | Compile-time CSS, tiny output, no CSS-in-JS runtime cost                                                                                 |
| Rendering                | **React Server Components** by default; client components only where interactive | Less JavaScript shipped; pages stream from the server with `Suspense`                                                                    |
| Compiler / bundler       | **React Compiler** + **Turbopack**                                               | Automatic memoization without hand-written `useMemo`; fast dev builds                                                                    |
| Tables                   | **TanStack Table** + **TanStack Virtual**                                        | Headless sorting, filtering and column control; virtualized rows keep the Jobs and Discover tables smooth at 10k+ rows                   |
| Server state             | **TanStack Query**                                                               | Caching, background refetch, optimistic updates (status changes and Save/Ignore feel instant)                                            |
| URL state                | **nuqs**                                                                         | Filters, tabs and sort live in the URL: shareable, back-button friendly, no extra store                                                  |
| Forms                    | **React Hook Form** + **Zod**                                                    | Uncontrolled inputs (few re-renders); the same Zod schemas validate the API and the LLM's JSON output                                    |
| Document editor          | **Tiptap** (headless, ProseMirror)                                               | Section-based editing for resume, cover letter and cold email; loaded lazily only on the editor page                                     |
| Command palette / search | **cmdk** (shadcn `Command`)                                                      | `Ctrl+K` global search and quick actions                                                                                                 |
| Live progress            | Server-Sent Events                                                               | Streams fetch → extract → generate steps and Claude's output token by token                                                              |
| Toasts / icons           | **Sonner**, **lucide-react** (tree-shaken per icon)                              | Light and consistent with shadcn                                                                                                         |
| Charts                   | **shadcn charts** (Recharts), lazily loaded                                      | Only on the Analytics page                                                                                                               |

**Performance rules**

- Server Components fetch data directly from Postgres; no client-side waterfalls for first paint
- Lazy-load heavy client pieces (editor, charts) with `next/dynamic`
- Paginate or virtualize every list; never render a full table to the DOM
- Optimistic updates for every row action, rolled back on error
- Debounce search input (about 200 ms) and run searches on the server
- Budget: under about 150 KB of first-load JS on the Jobs page; check it with the bundle analyzer in CI

---

## Model routing

Every LLM task goes through the Anthropic API. The one exception is embeddings (Stage 5), which use the local `qwen3-embedding:4b` model through Ollama (`EMBEDDING_MODEL`, `OLLAMA_BASE_URL`).

| Task                                                            | Model                                   | Notes                                                                     |
| --------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------- |
| Resume, cover letter, cold email (incl. follow-ups)             | Claude Opus 5.5 (`claude-opus-5-5`)     | Prompt caching on profile + instructions                                  |
| Resume → profile, job page → structured row                     | Claude Sonnet 5.5 (`claude-sonnet-5-5`) | Structured outputs, `effort: low`                                         |
| Keyword extraction/~~expansion~~, query rewriting, retrieval rerank | Claude Sonnet 5.5                       |                                                                           |
| Match scoring, classification, summarization                    | Claude Sonnet 5.5                       |                                                                           |
| Contact ranking, accuracy check on generated documents          | Claude Sonnet 5.5                       |                                                                           |
| Discovery prefilter (many jobs per day)                         | Claude Haiku 4.5 (`claude-haiku-4-5`)   | Cheap triage before full analysis; Batch API (50% off) for scheduled runs |

Model names live in `.env` (`WRITER_MODEL`, `EXTRACTION_MODEL`, `FAST_MODEL`). Opus 5.5 and Sonnet 5.5 can decline requests via safety classifiers (`stop_reason: "refusal"`); the structured-output helper raises a clear error in that case.

---

## Data model

```text
profile_versions   (id, data jsonb, base_resume_file_id, created_at)        -- immutable

jobs               (id, canonical_url, company, title, location, remote_type,
                    employment_type, salary_min/max/currency, posted_at,
                    responsibilities jsonb, requirements jsonb, technologies text[],
                    source_id, origin[manual|discovery], dedup_key,
                    status[discovered|saved|ignored], search_vector,
                    embedding vector)
job_snapshots      (id, job_id, raw_html_file_id, raw_text, normalized jsonb,
                    model, fetched_at)                                       -- immutable
job_keywords       (job_id, keyword, kind[extracted|expanded])

applications       (id, job_id, status, applied_at, application_url, notes)
status_events      (id, application_id, from, to, at, note)                 -- timeline

documents          (id, job_id, kind[resume|cover_letter|cold_email],
                    version, content jsonb/markdown, profile_version_id,
                    generator, model, prompt_hash, reference_doc_ids[],
                    locked_at, created_at)          -- every edit = new version; locked on "applied"
document_chunks    (id, document_id, section, text, search_vector,
                    embedding vector, embedding_model)                      -- for retrieval
attachments        (id, application_id, kind[final_resume_pdf|other], file_id)
files              (id, sha256, mime, size, path)

contacts           (id, company, job_id, name, title, email, linkedin_url,
                    source[jd|hunter|apollo|manual], confidence, verified, rank_reason)
outreach_emails    (id, job_id, contact_id, document_id, gmail_message_id,
                    gmail_thread_id, subject, body, sent_at, status)

sources            (id, kind[greenhouse|lever|ashby|workday|yc|...], config jsonb,
                    schedule, enabled)
source_runs        (id, source_id, started_at, finished_at, found, new, errors)
```

**Immutability:** documents are never updated in place; every save creates a new version. Marking an application as _Applied_ locks the current versions (enforced by a DB trigger as well as app code). If the base profile changes later, past applications keep exactly what was used.

---

## Stage 0: Foundations (about 1 week)

**Goal:** project skeleton, schema, and the LLM plumbing.

- Repo setup, Docker Compose (Postgres), Drizzle migrations, `.env` config, lint, tests
- Core schema above (applications/contacts/outreach tables can be stubs)
- **`chatStructured()`** (Claude Sonnet 5.5): one call constrained to a Zod schema via structured outputs; handles refusals and truncation
- **`GenerationProvider`** interface with an `AnthropicProvider` (Claude Opus 5.5, prompt caching, token/cost logging)
- `StorageProvider`: `put(bytes) → sha256`, `get(sha256)`
- App shell: sidebar with **Dashboard, Jobs, New Application, Discover, Profile, Settings**

**Done when:** the app boots, migrations run, and a test round-trips a structured-output call and a generation call through the Anthropic API.

---

## Stage 1: Profile and resume library (about 1 week)

**Goal:** a single source of truth for personalization, plus a seeded corpus for retrieval.

- Upload base resume (PDF/DOCX) → text → Claude converts it to a **structured profile** (experience, skills, projects, education, certifications, achievements) → review/edit form
- Preferences: target roles, locations, remote/hybrid/on-site, minimum salary, countries, visa sponsorship, preferred technologies, excluded roles/companies
- Generation instructions: style rules, section limits (the template is cramped, so per-section character/bullet limits matter), tone
- **Import past resumes** (and their JDs, if available) to seed the retrieval corpus from day one
- Every profile save creates a new `profile_version`

**Done when:** profile is parsed and editable, preferences saved, and past resumes imported.

---

## Stage 2: New Application → structured job (about 1–1.5 weeks)

**Goal:** paste a URL, get a clean job row in Postgres.

- **New Application page:** URL input → live progress (fetch → extract → structure)
- **Fetch pipeline**, tried in order:
  1. Detect the ATS from the URL → public JSON API (**Greenhouse, Lever, Ashby, Workday, SmartRecruiters, Workable**)
  2. schema.org `JobPosting` JSON-LD in the page
  3. HTML fetch → Playwright if JS-rendered → Readability → main text
- **Claude structuring** with a JSON schema: company, title, location, remote type, employment type, salary, posted date, responsibilities, requirements, technologies, application URL
- Keyword extraction runs in the same step and is saved to `job_keywords`
- Review screen with editable fields → **Save**
- Fallback: "paste JD text" for sites that block fetching (LinkedIn, Indeed)
- Dedup: canonical URL + hash of normalized `company + title + location`
- Store raw HTML/text as an immutable `job_snapshot`

**Done when:** about 90% of URLs from common ATSs and career pages extract correctly. A fixture set of 20–30 saved pages runs as regression tests to catch prompt or model changes.

---

## Stage 3: Jobs dashboard and application tracker (about 1 week)

**Goal:** the central table where everything happens.

- **Jobs table** (TanStack Table): company, title, location, status, match score (once Stage 6 lands), date saved, documents present
- **Actions column** per row: Generate/View resume, Generate/View cover letter, Generate/View cold email, Find contact, Send email, Change status
- Job detail page: JD snapshot, extracted fields, documents (with version history), status timeline, notes, contacts, outreach history
- Statuses: Saved, Preparing, Applied, Recruiter Screen, Interview, Technical Interview, Final Interview, Offer, Rejected, Withdrawn, Ghosted, with `status_events` recording the timeline
- Tabs: All, Saved, Preparing, Applied, Interviews, Offers, Rejected

**Done when:** a saved job can be moved through statuses and its timeline is recorded.

---

## Stage 4: Resume, cover letter and cold email generation (about 1.5–2 weeks)

**Goal:** tailored, accurate content that is quick to copy into the user's template.

- Written by **Claude Opus 5.5**. Generation input: profile version + job + generation instructions (+ retrieved references once Stage 5 lands)
- **Resume output is structured by section** (summary, skills, each role's bullets, projects) with per-section length limits, so it fits the cramped template
- **Editor** per document with version history; every save is a new version
- **Copy helpers:** "copy section" and "copy all" buttons, with plain-text formatting that pastes cleanly into the template
- **Cover letter** and **cold email** (short subject + 80–150 word body) generated from the same inputs
- **Accuracy check:** a second pass with Claude Sonnet 5.5 verifies each bullet against the profile and flags anything it can't trace back. Nothing is invented.
- Optional upload of the final PDF made in the template → stored as an attachment
- Generate resume, cover letter and cold email in parallel (Anthropic API calls, so local hardware is not the bottleneck)

**Done when:** all three documents can be generated, edited, versioned and copied, and the accuracy check flags fabricated claims in test cases.

---

## Stage 5: Retrieval from past resumes (about 1 week)

**Goal:** new resumes reuse what worked for similar jobs before.

- On save, **index** jobs (JD text) and resumes (chunked by section/bullet): `tsvector` for full-text and an embedding from **`qwen3-embedding:4b`** (local, via Ollama) stored in pgvector, with the model name saved next to each vector
- **Keyword expansion:** Claude proposes related terms not in the JD (stored as `expanded` in `job_keywords`)
- **Retrieval:** two candidate lists, merged with reciprocal-rank fusion: (1) vector similarity of the JD + expanded keywords against chunk embeddings, (2) Postgres full-text (`websearch_to_tsquery`) on the keywords. Take the top ~20, then Claude Sonnet 5.5 reranks them against the JD and keeps the best few
- Top-k past resume chunks (and the jobs they were written for) are injected into the generation prompt as **reference examples**, clearly marked as style/phrasing references, not facts
- Show "References used" on each generated document (`reference_doc_ids`) so the user can see what the model drew on

**Done when:** generating a resume for an automation job surfaces past resumes written for n8n/Zapier/automation roles, and the user can see which ones were used.

**MVP complete after Stages 0–5:** URL → structured job → saved row → generated, editable resume, cover letter and cold email informed by past resumes, in under about 2 minutes plus review time.

---

## Stage 6: Match analysis (about 1 week)

**Goal:** an explainable fit score, for information only.

- Deterministic flags: location/country mismatch, sponsorship, salary below minimum, excluded company/role
- Claude structured scoring: Skills, Experience, Responsibilities, Location, Preferences; overall is a weighted sum computed in code
- Strengths, missing requirements, concerns, and "why this is relevant"
- Score column in the Jobs table and on Discover; analysis panel on the job page
- Cached per `(job_snapshot, profile_version)`

**Done when:** scores are stable across reruns (±5 points) and gap analysis matches a manual read of the JD.

---

## Stage 7: Contact discovery and cold email sending (about 1.5 weeks)

**Goal:** find the right person and email them from the dashboard.

- **Contact finding**, behind a pluggable `ContactFinder` interface:
  1. Parse the JD/page for a named recruiter or hiring manager
  2. Look up people at the company domain via **Hunter.io** or **Apollo.io** API (names, titles, emails)
  3. Email pattern inference + verification (Hunter verifier) when only a name is known
  4. Claude **ranks candidates** by relevance to the role (hiring manager for that team > team lead > technical recruiter > general recruiter) and explains why
  5. Manual add/edit always available
- **Gmail integration:** OAuth with `gmail.send` scope; tokens stored locally, encrypted
- **Send flow:** pick contact → choose cold-email version → edit → preview → **Send** (explicit click, never automatic)
- Store message and thread IDs in `outreach_emails`; show sent history on the job
- Later: read replies on the thread (needs `gmail.readonly`) to flag responses

**Done when:** for a saved job, the app suggests a ranked contact with a verified email, and a cold email can be sent from the user's Gmail and appears in the job's outreach history.

---

## Stage 8: Job discovery (about 2 weeks; details to be discussed separately)

**Goal:** a Discover page of relevant openings from Fortune 500 companies and YC startups, using APIs rather than scraping wherever possible.

- **Source adapters** behind one `SourceAdapter.fetchJobs()` interface. Candidates to evaluate:
  - **Fortune 500:** most use **Workday**, whose career sites expose a JSON endpoint (`/wday/cxs/{tenant}/{site}/jobs`); others use Greenhouse, Lever, SmartRecruiters, iCIMS, Oracle/Taleo or SuccessFactors. Build a mapping of company → ATS → endpoint.
  - **Y Combinator:** the public YC company directory (e.g. the community `yc-oss` JSON dataset) to get companies, then their **Ashby/Greenhouse/Lever** board APIs for openings; the HN "Who is Hiring" thread via the official HN/Algolia API
  - **Aggregators (optional, paid):** Adzuna API, JSearch (Google for Jobs), TheirStack
  - **LinkedIn:** deferred; no permitted API for this use. The browser extension or pasting covers it.
- **Pipeline:** scheduled fetch (pg-boss cron) → dedup → prefilter on preferences (roles, locations, exclusions) → Claude structuring → match score (Stage 6) → rank
- **Discover page:** filters (company, role, location, remote, score, source, date), Save / Ignore actions; saved jobs move to the Jobs dashboard
- Respect robots.txt, rate limits and each site's terms

**Done when:** Fortune 500 and YC sources refresh daily, duplicates stay under 2%, and saving a discovered job drops it into the apply workflow.

---

## Stage 9: Should-haves (about 2 weeks)

- **Global search** across jobs, applications, companies, contacts, documents and notes (full-text + vector), e.g. `backend Germany PostgreSQL`
- Filters on the Jobs dashboard: company, role, location, score, source, status, date, salary
- **Follow-up reminders:** no response after N days → reminder plus a generated follow-up email on the same Gmail thread
- **Browser extension** (Chrome, Manifest V3): "Save job" sends the current page's URL and DOM to the app; covers LinkedIn and Indeed

---

## Stage 10: Analytics (about 1 week)

- Applications sent; response, interview and offer rates from `status_events`
- Cold email reply rate (from Gmail threads)
- Breakdowns by role, company, source; average match score; score vs. response rate
- Groundwork for insights like "Automation roles have a 2.3× higher response rate than Full Stack roles"

---

## Stage 11: Later

Interview prep and tracking, reply detection and status auto-updates from Gmail, salary intelligence, AI recommendations. Automatic submission last, only with human confirmation.

---

## Cross-cutting concerns

- **LLM reliability:** every structured call uses Anthropic structured outputs, so JSON is schema-valid by construction; still handle `refusal` and `max_tokens` stop reasons. Pin model IDs in `.env`; run the fixture eval suite whenever a model or prompt changes. Optionally enable the server-side refusal `fallbacks` parameter for Sonnet 5.5 / Opus 5.5 calls.
- **Cost:** log tokens and cost for every Claude call; prompt caching on profile + instructions keeps repeated generations cheap.
- **LLM quality:** fixture suite of real JDs with expected extractions, run as an eval script whenever the model or prompts change
- **Immutability:** versioned documents and profiles, DB triggers on locked rows, content-addressed files
- **Privacy:** your data lives in local Postgres and disk, but every LLM step sends content to the Anthropic API: your resume and profile (Stage 1 parsing), job pages, and retrieved past resumes. Gmail and the contact-finder API also receive data. Review Anthropic's data-retention terms for your account; OAuth tokens and API keys stay in `.env`/encrypted storage
- **Email safety:** no automatic sending; daily send cap; every sent email logged
- **Legal:** prefer official and public APIs; respect robots.txt and site terms

## Timeline (solo, part-time pace)

| Milestone                                   | Stages | Cumulative   |
| ------------------------------------------- | ------ | ------------ |
| Foundations and profile                     | 0–1    | ~2 wks       |
| URL → saved job in dashboard                | 2–3    | ~4.5 wks     |
| **MVP: generation + past-resume retrieval** | 4–5    | **~7.5 wks** |
| Match analysis                              | 6      | ~8.5 wks     |
| Contacts and cold email sending             | 7      | ~10 wks      |
| Discovery                                   | 8      | ~12 wks      |
| Should-haves and analytics                  | 9–10   | ~15 wks      |

## Open questions

1. **Resume template:** which sections and length limits does the template have? This decides the structured output format and copy helpers.
2. **Past resumes:** how many exist, in what format, and are the original JDs available? This decides how to seed retrieval.
3. **Contact finder:** OK to use a paid API (Hunter.io / Apollo.io free tiers first)?
4. **Discovery:** confirm the first set of sources (which Fortune 500 companies, YC filters) in the dedicated discussion.
