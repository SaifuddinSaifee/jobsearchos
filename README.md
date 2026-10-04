# Job Search OS

A personal job-search workspace. Paste a job URL, get a structured job record, generate a tailored resume, cover letter and cold email, and track every application.

[Together AI](https://www.together.ai) does all the LLM work: **MiniMax M3** writes, **GLM-5.3 Flash** extracts, scores and triages. The only local model is the embedding model used for past-resume retrieval (Stage 5).

## Status

| Stage | What | State |
| --- | --- | --- |
| 0 | Foundations: Next.js app, Postgres, LLM client, file storage, app shell | Done |
| 1 | Profile: resume upload and parsing, preferences, generation instructions, past resumes, versioned history | Done |
| **2** | **New Application: paste a URL, fetch the page, structure it with the LLM** | **Next** |
| 3–10 | Jobs dashboard, generation, retrieval, scoring, contacts and email, discovery, analytics | See [docs/PLAN.md](docs/PLAN.md) |

Nothing has been parsed with a real resume yet: the Stage 1 parsing path was built and unit-tested, but it needs a Together AI API key to run end to end (see setup step 3).

## Set up on Linux (Pop!_OS / Ubuntu)

### 1. Prerequisites

```bash
# Git and build basics
sudo apt update && sudo apt install -y git curl build-essential

# Node.js 22 via nvm (the repo pins it in .nvmrc)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
# open a new terminal, then:
nvm install 22

# Docker Engine + Compose plugin (skip if already installed)
sudo apt install -y docker.io docker-compose-v2
sudo usermod -aG docker "$USER"     # then log out and back in
```

You also need a **Together AI API key** ([api.together.ai/settings/api-keys](https://api.together.ai/settings/api-keys)).

Optional, only needed from Stage 5 (past-resume retrieval):

```bash
curl -fsSL https://ollama.com/install.sh | sh
ollama pull qwen3-embedding:4b
```

### 2. Get the code

```bash
git clone <your-github-url> job-tracker
cd job-tracker
nvm use          # picks Node 22 from .nvmrc
npm ci           # installs exact versions from package-lock.json
```

### 3. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and set `TOGETHER_AI_API_KEY`. The database URLs already match `docker-compose.yml`, so leave them alone. `.env` is gitignored.

### 4. Start the database

```bash
npm run db:setup
```

This starts Postgres (with pgvector) in Docker, creates the `jobtracker` and `jobtracker_test` databases, and applies all migrations. It is safe to re-run.

### 5. Install the browser (for JS-rendered job pages)

```bash
npm run browsers:install
```

Downloads headless Chromium (~115 MB) for Playwright. It is only used when a career page renders its content with JavaScript; ATS pages (Greenhouse, Lever, Ashby, Workday, SmartRecruiters, Workable) use their public APIs and never need it.

### 6. Run the app

```bash
npm run dev
```

Open <http://localhost:3000/settings>. Both health cards should be green (Postgres connected, Together AI credentials working and all three model IDs found). Then open **Profile** and upload your resume to try the Stage 1 flow end to end.

### 7. Check everything works

```bash
npm test            # unit + database integration tests (needs the database from step 4)
npm run typecheck
npm run lint
```

To try resume parsing from the terminal: `npm run eval:resume path/to/resume.pdf`.

## Adding a job (Stage 2)

Open **New Application** and paste a job URL. The fetch order is: public ATS API (Greenhouse, Lever, Ashby, Workday, SmartRecruiters, Workable; Greenhouse boards embedded on a company domain via `?gh_jid=` are detected too) → schema.org JSON-LD → page text → headless Chromium for JS-rendered pages. LinkedIn and Indeed block automated fetching, so use the **Paste JD text** tab for them. Saving writes the job, an immutable snapshot of the source, its keywords, and an application row with its first status event.

Code lives in [src/lib/jobs/](src/lib/jobs/) (`fetch/` is the pipeline, `extract.ts` the LLM step, `service.ts` the save). Regression fixtures are recorded with `npm run snapshot:job` and scored with `npm run eval:jobs`; see [docs/STAGE-2-PLAN.md](docs/STAGE-2-PLAN.md).

If you use Claude Code, open it in the repo root. [AGENTS.md](AGENTS.md) and [CLAUDE.md](CLAUDE.md) tell it to read the bundled Next.js docs in `node_modules/next/dist/docs/` first, because this Next.js version has breaking changes.

## Tracking jobs (Stage 3)

**Jobs** is the working table: tabs (Active, Saved, Preparing, Applied, Interviews, Offers, Closed), search, filters, inline status changes with Undo, bulk actions, CSV export, and a slide-over panel with notes and the status timeline. The **Dashboard** shows the funnel, what needs attention, and recent activity.

Keyboard shortcuts on the Jobs page (when you are not typing in a field): `/` search, `j`/`k` or arrows move, `Enter` opens details, `x` selects, `Shift+A` marks Applied, `Esc` closes. Code: [src/lib/jobs/tracker.ts](src/lib/jobs/tracker.ts) (data and mutations), [src/components/jobs/](src/components/jobs/) (UI).

## Companies

**Companies** is a directory with one profile per employer, shared by every job there: what they do, mission/values/principles, culture, and your own notes. Jobs link to it automatically (aliases and Merge handle "YouTube" vs "Google"). Paste things like a company's principles yourself; research never overwrites what you edited. The profile is included when you copy a job as Markdown.

Research uses the cheapest source first: the job posting, then the company's own About pages (free), and only then **one** web search through [Tavily](https://tavily.com) (`TAVILY_API_KEY` in `.env`, free tier available). Without a key everything else works and you can fill profiles by hand. See [docs/STAGE-3B-COMPANIES.md](docs/STAGE-3B-COMPANIES.md).

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server on port 3000 |
| `npm run build` / `npm start` | Production build and server |
| `npm run db:setup` | Start Postgres, create databases, migrate both |
| `npm run db:up` / `db:down` | Start or stop the Postgres container |
| `npm run db:generate` | Generate a migration after editing `src/lib/db/schema.ts` |
| `npm run db:migrate [url]` | Apply migrations (dev database by default) |
| `npm test` | Vitest (unit and database integration tests) |
| `npm run typecheck` / `npm run lint` | TypeScript and ESLint |
| `npm run browsers:install` | Download Chromium for Playwright (JS-rendered career pages) |
| `npm run snapshot:job -- <url...> [--draft]` | Record job pages as regression fixtures in `tests/fixtures/jobs/` (`--draft` also writes `expected.json` with the model, to review by hand) |
| `npm run eval:jobs [-- <slug>]` | Replay fixtures through the real extraction model and print a scorecard (target 90%) |
| `npm run eval:resume <file>` | Parse a resume PDF or DOCX with the extraction model and print the result |

## Project layout

```text
src/app/(app)/        Pages: dashboard, jobs, new, discover, profile, settings
src/app/api/          Route handlers (resume parsing, past-resume upload)
src/components/       UI (shadcn/ui in components/ui, profile screens in components/profile)
src/lib/db/           Drizzle schema, client, migration runner
src/lib/llm/          Together AI client, structured-output helper, generation provider
src/lib/profile/      Profile, preferences and instructions schemas; versioned save/restore
src/lib/resume/       PDF/DOCX text extraction and LLM parsing
src/lib/storage/      Content-addressed file storage
drizzle/              SQL migrations (includes the immutability trigger on profile versions)
docs/                 PLAN.md (full roadmap), STAGE-1-PLAN.md
tests/                Vitest tests
```

## Design notes

- **Immutable history:** `profile_versions` rows can never be updated or deleted (a database trigger enforces it). Every save is a new version; restoring copies an old one forward.
- **Files** are stored under `storage/` by SHA-256 and never overwritten. `storage/` is gitignored.
- **Models** are Together model IDs in `.env`: `WRITER_MODEL` (MiniMax M3) writes; `EXTRACTION_MODEL` and `FAST_MODEL` (both GLM-5.3 Flash) extract, score and triage. See "Model routing" in [docs/PLAN.md](docs/PLAN.md).
- **Privacy:** your data lives in local Postgres and on disk, but every LLM call sends its input (resume text, job pages) to the Together AI API.
- `npm run dev` and `npm run build` use webpack (`--webpack`) because Turbopack crashed on the Windows machine this was started on. On Linux you can try plain `next dev` (Turbopack) and switch the scripts if it works.

## Moving data from the Windows machine (only if you saved anything there)

The Windows database was empty when this was written, so normally there is nothing to move. If you saved a profile or uploaded resumes there first:

```bash
# On Windows (Docker running): dump the database and copy storage/
docker exec jobtracker-postgres pg_dump -U jobtracker jobtracker > jobtracker.sql

# On Linux, after `npm run db:setup`:
docker compose exec -T postgres psql -U jobtracker -d jobtracker < jobtracker.sql
# and copy the old storage/ folder into the repo's storage/
```

## Troubleshooting

- **`permission denied` talking to Docker:** you are not in the `docker` group yet. Run `sudo usermod -aG docker "$USER"` and log out and back in.
- **Port 5432 already in use:** another Postgres is running. Stop it, or change the host port in `docker-compose.yml` and both URLs in `.env`.
- **Settings shows "TOGETHER_AI_API_KEY is not set":** set it in `.env` and restart `npm run dev`.
- **Settings shows "model IDs were not found":** Together renamed or retired a model. Pick a current ID from the [model list](https://docs.together.ai/docs/serverless-models) and update `.env`.
- **Tests fail to connect:** run `npm run db:setup` first (tests use the `jobtracker_test` database).
