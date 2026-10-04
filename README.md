# Job Search OS

A personal job-search workspace. Paste a job URL, get a structured job record, generate a tailored resume, cover letter and cold email, and track every application.

Claude (Anthropic API) does all the LLM work. The only local model is the embedding model used for past-resume retrieval (Stage 5).

## Status

| Stage | What | State |
| --- | --- | --- |
| 0 | Foundations: Next.js app, Postgres, Claude client, file storage, app shell | Done |
| 1 | Profile: resume upload and parsing, preferences, generation instructions, past resumes, versioned history | Done |
| **2** | **New Application: paste a URL, fetch the page, structure it with Claude** | **Next** |
| 3–10 | Jobs dashboard, generation, retrieval, scoring, contacts and email, discovery, analytics | See [docs/PLAN.md](docs/PLAN.md) |

Nothing has been parsed with a real resume yet: the Stage 1 parsing path was built and unit-tested, but it needs an Anthropic API key to run end to end (see setup step 4).

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

You also need an **Anthropic API key** ([console.anthropic.com](https://console.anthropic.com)).

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

Edit `.env` and set `ANTHROPIC_API_KEY`. The database URLs already match `docker-compose.yml`, so leave them alone. `.env` is gitignored.

### 4. Start the database

```bash
npm run db:setup
```

This starts Postgres (with pgvector) in Docker, creates the `jobtracker` and `jobtracker_test` databases, and applies all migrations. It is safe to re-run.

### 5. Run the app

```bash
npm run dev
```

Open <http://localhost:3000/settings>. Both health cards should be green (Postgres connected, Anthropic credentials working). Then open **Profile** and upload your resume to try the Stage 1 flow end to end.

### 6. Check everything works

```bash
npm test            # 13 tests (needs the database from step 4)
npm run typecheck
npm run lint
```

To try resume parsing from the terminal: `npm run eval:resume path/to/resume.pdf`.

## Starting Stage 2

1. Read **Stage 2** in [docs/PLAN.md](docs/PLAN.md) (fetch pipeline: ATS APIs, then JSON-LD, then HTML, then Claude structuring) and the conventions in [docs/STAGE-1-PLAN.md](docs/STAGE-1-PLAN.md).
2. Stage 2 will need a headless browser for JavaScript-rendered pages. When you get there: `npm i playwright && npx playwright install --with-deps chromium`.
3. If you use Claude Code, open it in the repo root. [AGENTS.md](AGENTS.md) and [CLAUDE.md](CLAUDE.md) tell it to read the bundled Next.js docs in `node_modules/next/dist/docs/` first, because this Next.js version has breaking changes.

Existing building blocks Stage 2 should reuse:

| Need | Use |
| --- | --- |
| Structured extraction with Claude | `chatStructured(zodSchema, { system, user })` in [src/lib/llm/structured.ts](src/lib/llm/structured.ts) |
| Store raw HTML or any file | `putFile()` in [src/lib/storage/local.ts](src/lib/storage/local.ts) (content-addressed, write-once) |
| Database client and tables | [src/lib/db/](src/lib/db/) (Drizzle; add tables in `schema.ts`, then `npm run db:generate`) |
| Config and model names | [src/lib/env.ts](src/lib/env.ts) (`EXTRACTION_MODEL`, `WRITER_MODEL`, `FAST_MODEL`) |

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
| `npm run eval:resume <file>` | Parse a resume PDF or DOCX with Claude and print the result |

## Project layout

```text
src/app/(app)/        Pages: dashboard, jobs, new, discover, profile, settings
src/app/api/          Route handlers (resume parsing, past-resume upload)
src/components/       UI (shadcn/ui in components/ui, profile screens in components/profile)
src/lib/db/           Drizzle schema, client, migration runner
src/lib/llm/          Anthropic client, structured-output helper, generation provider
src/lib/profile/      Profile, preferences and instructions schemas; versioned save/restore
src/lib/resume/       PDF/DOCX text extraction and Claude parsing
src/lib/storage/      Content-addressed file storage
drizzle/              SQL migrations (includes the immutability trigger on profile versions)
docs/                 PLAN.md (full roadmap), STAGE-1-PLAN.md
tests/                Vitest tests
```

## Design notes

- **Immutable history:** `profile_versions` rows can never be updated or deleted (a database trigger enforces it). Every save is a new version; restoring copies an old one forward.
- **Files** are stored under `storage/` by SHA-256 and never overwritten. `storage/` is gitignored.
- **Models** are set in `.env`: Claude Opus 5.5 writes, Claude Sonnet 5.5 extracts and scores, Claude Haiku 4.5 does bulk triage.
- **Privacy:** your data lives in local Postgres and on disk, but every Claude call sends its input (resume text, job pages) to the Anthropic API.
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
- **Settings shows "Could not resolve authentication method":** `ANTHROPIC_API_KEY` is empty in `.env`. Set it and restart `npm run dev`.
- **Tests fail to connect:** run `npm run db:setup` first (tests use the `jobtracker_test` database).
