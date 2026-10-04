# Plan: Build Stage 1 (Profile & Resume Library), plus the Stage 0 foundations it needs

## Context

[docs/PLAN.md](PLAN.md) defines Stage 1 as: upload base resume → the extraction model (GLM-5.3 Flash) parses it into a structured profile → user reviews/edits; preferences; generation instructions; import past resumes; every save creates an immutable `profile_version`.

The repo currently contains only `docs/PLAN.md`, so Stage 1 can't run without the Stage 0 skeleton (Next.js app, Postgres, LLM client, storage, app shell). This plan builds the **minimal Stage 0 needed + all of Stage 1**.

Environment checked: Node 20.10 ✓ (Next.js needs ≥20.9), Docker 27 + Compose ✓ (Docker Desktop must be running), git ✓. **Package manager: npm.** pnpm crashes under Node 20.10 on this machine (V8 fatal error), so the project uses npm. **LLM: Together AI only.** Embeddings (Stage 5 only) will come from the local `qwen3-embedding:4b` via Ollama, since Together offers no serverless embedding models; nothing in Stage 1 needs it.

> **Provider change:** Stage 1 was first built on the Anthropic API (Claude models). The project has since moved to Together AI (MiniMax M3 for writing, GLM-5.3 Flash for extraction and triage). This document describes the current setup.

One deliberate deviation from PLAN.md: tables are created **in the stage that uses them** (not all stubs up front), keeping migrations small and meaningful. I'll note this in PLAN.md's Stage 0.

---

## 1. Scaffold (Stage 0, minimal)

- `create-next-app` (with `--use-pnpm` it crashed; install was redone with npm) in the repo root (TypeScript, App Router, Tailwind v4, ESLint, `src/`, Turbopack; `docs/` is an allowed existing folder). Enable React Compiler in `next.config.ts`.
- `shadcn init`, then add: `sidebar, button, input, textarea, label, card, tabs, form, select, switch, checkbox, badge, dialog, table, separator, skeleton, tooltip, sonner, command, scroll-area, dropdown-menu`.
- Deps: `drizzle-orm postgres zod react-hook-form @hookform/resolvers @tanstack/react-query nuqs next-themes lucide-react unpdf mammoth together-ai clsx tailwind-merge`; dev: `drizzle-kit vitest @vitest/coverage-v8 tsx dotenv`. The shadcn style is `base-nova` (Base UI primitives): components use a `render` prop instead of `asChild`, and there is no `form` component (use React Hook Form directly). `src/lib/utils.ts` defines `cn` locally with clsx + tailwind-merge.
- `docker-compose.yml`: `pgvector/pgvector:pg17`, port 5432, named volume; plus a `jobtracker_test` DB created by an init script.
- `.env.example` / `.env`: `DATABASE_URL`, `TEST_DATABASE_URL`, `TOGETHER_AI_API_KEY`, `WRITER_MODEL=MiniMaxAI/MiniMax-M3`, `EXTRACTION_MODEL=zai-org/GLM-5.3-Flash`, `FAST_MODEL=zai-org/GLM-5.3-Flash`, `STORAGE_DIR=./storage`. `storage/` and `.env` gitignored.
- Scripts: `dev`, `build`, `db:up`, `db:generate`, `db:migrate`, `test`, `eval:resume`.

## 2. Core libraries (`src/lib/`)

| File | Purpose |
|---|---|
| `env.ts` | Zod-validated env, fails fast on boot |
| `db/index.ts` | postgres-js + Drizzle client (singleton for dev HMR) |
| `db/schema.ts` | Tables below |
| `storage/local.ts` | `put(buf, mime, name) → {fileId, sha256}`: hash, write `storage/ab/cd/<sha256>` with `wx` flag (write-once), insert `files` `ON CONFLICT (sha256) DO NOTHING`; `get(sha256)` |
| `llm/client.ts` | Shared Together AI client; reads `TOGETHER_AI_API_KEY` and fails with a clear error when it is missing |
| `llm/structured.ts` | `chatStructured(zodSchema, {system, user}, opts)`: `chat.completions.create` with `response_format: json_schema` (from `z.toJSONSchema`), schema text also in the system prompt, GLM-5.3 Flash by default; validates with Zod; throws clear errors on truncation (`finish_reason: "length"`), non-JSON output and schema mismatch |
| `llm/generation.ts` | `GenerationProvider` interface + `TogetherProvider` (MiniMax M3); real use in Stage 4 |
| `resume/extract.ts` | PDF → `unpdf` `extractText`; DOCX → `mammoth.extractRawText`; normalize whitespace; reject other types / >10 MB |
| `resume/parse.ts` | Prompt + `chatStructured(ProfileSchema)` (GLM-5.3 Flash): "extract only what is written; never infer or invent; keep bullets verbatim" |
| `profile/schema.ts` | Zod: `ProfileSchema` (contact, summary, experience[{company,title,location,start,end,current,bullets[]}], skills[{category,items[]}], technologies, projects, education, certifications, achievements), `PreferencesSchema` (target roles, locations, remote modes, min salary+currency, countries, visa sponsorship, preferred tech, excluded roles/companies), `GenerationInstructionsSchema` (style rules, tone, per-section limits `{section, maxBullets, maxChars}`) |
| `profile/service.ts` | `getLatest()`, `listVersions()`, `saveVersion(partial)`: in a transaction, read latest, merge the changed part, insert version N+1. `restore(versionId)` = save as new version |

## 3. Schema & migrations (`drizzle/`)

- `0000`: `CREATE EXTENSION IF NOT EXISTS vector;` (for later stages)
- `files` (id uuid, sha256 unique, mime, size, original_name, path, created_at)
- `profile_versions` (id uuid, version int unique, profile jsonb, preferences jsonb, generation_instructions jsonb, base_resume_file_id → files, change_note, created_at)
- `past_resumes` (id, file_id → files, title, company, role, jd_text, jd_url, applied_at, extracted_text, created_at): stored now; chunked/embedded in Stage 5
- **Immutability trigger** on `profile_versions`: `BEFORE UPDATE OR DELETE → RAISE EXCEPTION` (custom SQL migration)

## 4. UI (`src/app/`)

- **Shell** `(app)/layout.tsx`: shadcn `Sidebar` with Dashboard, Jobs, New Application, Discover, Profile, Settings; theme toggle (next-themes); `QueryClientProvider` + `NuqsAdapter`; Sonner toaster. Unbuilt pages render a "Coming in Stage N" placeholder.
- **`/profile`**, a Server Component that loads the latest version, with tabs (tab in URL via nuqs):
  1. **Profile:** empty state = dropzone. Upload → `POST /api/resume/parse` (route handler, not server action, to avoid the 1 MB body limit) → stores file, extracts text, runs the LLM → returns a draft (not saved). Step indicator: Uploading → Extracting text → Structuring. Draft opens in a React Hook Form editor (`useFieldArray` for experience, bullets, projects, etc.), side panel showing the extracted raw text for comparison. **Save** → server action → new version. "Re-import from resume" button.
  2. **Preferences:** tag inputs (roles, locations, countries, tech, exclusions), remote-mode checkboxes, salary + currency, visa switch.
  3. **Generation instructions:** style rules textarea, tone select, section-limits table (important for the cramped template).
  4. **Past resumes:** table + upload dialog (multi-file; optional title/company/role/JD text/URL/date). Stores file + extracted text.
  5. **History:** version list (N, date, change note); read-only view; "Restore as new version".
  - Header shows "Version N · saved <time>"; each tab's Save writes a full snapshot via `saveVersion`.

## 5. Tests & eval

- **Vitest unit:** storage write-once/dedup (temp dir); `chatStructured` truncation, invalid-JSON and schema-mismatch handling with a mocked client; `saveVersion` merge logic; `extract` on small PDF/DOCX fixtures in `tests/fixtures/`.
- **Vitest integration** (against `jobtracker_test`): migrations apply; `UPDATE`/`DELETE` on `profile_versions` is rejected by the trigger; versions increment.
- **`npm run eval:resume <file>`**: runs extract + parse against the real extraction model and prints JSON and timing. Used to check parse quality on the user's real resume.

## 6. Docs

- Update PLAN.md Stage 0/1 notes: tables created per stage; past resumes stored in Stage 1 and embedded in Stage 5.

---

## Verification

1. `npm install`, `npm run db:up`, `npm run db:migrate`, `npm run dev`.
2. `/settings`: DB ✓, Together AI credentials ✓ and configured model IDs found, model IDs shown.
3. `/profile` → upload the real base resume (PDF and DOCX) → draft appears within ~60 s → compare with raw text panel → fix anything → Save → header shows Version 1.
4. Edit Preferences → Save → Version 2; History shows both; Version 1 view unchanged; Restore v1 → Version 3.
5. Upload 2–3 past resumes → listed with extracted text.
6. `npm run test` all green (incl. trigger test); `npm run eval:resume <resume.pdf>` output reviewed; `npm run build` succeeds with no type errors.
