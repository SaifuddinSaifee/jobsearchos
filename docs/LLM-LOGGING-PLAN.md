# LLM call logging (Phoenix + our own usage table) and an "AI usage" page

## Context

Today nothing records the app's model calls. Token usage is thrown away (only `scripts/eval-resume.ts` reads it through `onUsage`), and there is no way to see what the app costs, which steps are slow, or which calls fail. We just made resume parsing faster with `reasoning_effort: "low"`, and want to keep measuring changes like that.

Two outcomes:
1. **Tracing in Arize Phoenix** (local, http://localhost:6006, project `jobsearchos`): every call's prompt, reply, settings, tokens (including thinking), latency and errors, grouped by the unit of work that caused it. The setup copies the working pattern in `~/Projects/kalres/kalres` (`instrumentation.node.ts`, `lib/server/openai.ts`, `lib/server/tracing.ts`, `docs/llm-logging.md`).
2. **Our own record and dashboard**: one Postgres row per call, **numbers only** (no prompt/reply text; that stays in Phoenix), **kept forever**, shown on a new top-level **AI usage** page (`/usage`) with an **ECharts** spend-per-day chart.

Both ship together: one wrapper around every call writes the row and sits inside the Phoenix span, so each row carries its trace id.

Facts this rests on (verified): all 9 call sites go through `chatStructured` -> `chatCompletion` (`src/lib/llm/chat.ts`); `TogetherProvider` (`src/lib/llm/generation.ts`) is unused. The app is single-user (no auth). Scripts use webpack (`next dev --webpack`). Together's `/v1/models` returns a bare array, so the settings page check stays on the Together SDK. `@arizeai/openinference-instrumentation-openai` 4.4.1 traces streamed chat calls, reads the final `include_usage` chunk and records reasoning tokens. `kickWorker()` can start queue work from inside a request, so queue contexts must start a fresh trace.

## 1. Client swap: openai SDK pointed at Together

- `package.json`: pin exactly `openai` 7.30.1, `@arizeai/openinference-instrumentation-openai` 4.4.1, `@arizeai/phoenix-otel` 2.2.0, `echarts` 6.1.0. Keep `together-ai`.
- `next.config.ts`: add `"openai"`, `"@arizeai/phoenix-otel"`, `"@arizeai/openinference-instrumentation-openai"` to `serverExternalPackages` (webpack + require-in-the-middle).
- New `src/lib/llm/openai.ts`: `chatClient()` lazily creates `new OpenAI({ apiKey: env().TOGETHER_AI_API_KEY, baseURL: "https://api.together.xyz/v1" })` and calls `new OpenAIInstrumentation().manuallyInstrument(OpenAI)` in the same module (kalres rule: survives bundler splitting; no-op without a provider; has its own double-patch guard).
- `src/lib/llm/client.ts`: keep `together()` for `settings/page.tsx` only; fix its JSDoc.

## 2. Names, context and tracing

- New `src/lib/llm/names.ts` (dependency-free, client-safe): `LlmAction` union (`upload-resume`, `fill-job-details`, `research-company`, `regroup-role`, `add-job`, `find-contacts`, `index-resume`, `read-career-source`, `eval-resume`, `eval-jobs`, `snapshot-job`) and `LlmStep` union (`parse-resume`, `extract-job`, `extract-additional-details`, `research-company`, `extract-posting-people`, `find-people-web`, `rank-contacts`, `group-bullets`, `classify-cover-paragraphs`, `generate-document`).
- New `src/lib/llm/context.ts`, adapted from kalres `tracing.ts` (no `server-only`, it isn't installed):
  - `LlmContext = { action, runId (randomUUID per run), jobId?, companyId?, documentId?, documentVersionId?, proposalId?, searchId?, queueItemId? }` in an `AsyncLocalStorage`.
  - `withLlmContext(action, ids, fn, { metadata? })`: starts from `trace.deleteSpan(context.active())` (fresh root, fixes the kickWorker leak), sets Phoenix session (`jobId ?? companyId ?? proposalId ?? documentId ?? queueItemId`) and metadata, then `store.run(ctx, () => context.with(otel, () => traceStep(action, fn)))`.
  - `traceStep(name, fn)` (traceChain with no input/output content), `currentLlmContext()`, `currentTraceId()` (null when tracing is off), `addLlmIds(ids)` for ids learned mid-run.
  - Keep `src/lib/llm/abort.ts` separate; the two stores nest fine.

## 3. chatCompletion / chatStructured

- `src/lib/llm/chat.ts`: `ChatParams` from `openai/resources/chat/completions` (no casts; `stream_options`, `reasoning_effort` are typed). `Usage` gains `cachedTokens`. New signature `chatCompletion(params, { step, read? })`:
  - runs inside `traceStep(step)`, streams via `chatClient()` with `{ signal: currentAbortSignal() }`, builds `{ content, finishReason, usage }` as today;
  - applies `read(reply)` if given (a throw there is a failed call);
  - in `finally`, `void recordLlmCall({...})` with context ids, action (`"unknown"` outside a context), runId, step, model (requested id), reasoningEffort, status, error, finishReason, tokens, durationMs, traceId; rethrows on failure.
  - Status: `ok` | `error` | `stopped` (abort becomes `stopped`, so "Stop and skip" isn't counted as a failure).
- `src/lib/llm/structured.ts`: `step: LlmStep` becomes a **required** option. Length check, fence stripping, JSON parse and schema check move into the `read` callback, so a call that spent tokens and then failed validation is recorded with its tokens and `status: "error"`. `onUsage` still fires before validation.
- Call sites: add `step` to the options at `jobs/extract.ts:59,75`, `companies/research.ts:236`, `outreach/posting.ts:28`, `outreach/web.ts:59`, `outreach/rank.ts:40`, `career/group.ts:113`, `career/cover.ts:80`. In `resume/parse.ts`, `PARSE_OPTIONS`/`opts` become `Omit<StructuredOptions, "step">` and the call adds `step: "parse-resume"`. `generation.ts` passes `step: "generate-document"`.

## 4. Usage table and recorder

- `src/lib/db/schema.ts`: table `llm_calls` (JSDoc: numbers only, content in Phoenix, kept forever, ids without foreign keys so history survives deletes). Columns: `id` uuid, `created_at`, `action`, `step`, `run_id` uuid, `model`, `reasoning_effort`, `status` text (`ok|error|stopped`), `error` (first 300 chars), `finish_reason`, `prompt_tokens`, `cached_tokens`, `completion_tokens`, `reasoning_tokens` (integers, null when the provider reported none), `cost_usd` double (null when unpriced), `duration_ms`, `trace_id`, and nullable uuid `job_id`, `company_id`, `document_id`, `document_version_id`, `proposal_id`, `search_id`, `queue_item_id`. Indexes `llm_calls_created_idx (created_at)`, `llm_calls_job_idx (job_id, created_at) where job_id is not null`. Export `LlmCallRow`.
- Migration: `npx drizzle-kit generate --name llm_calls` gives `drizzle/0020_llm_calls.sql`; `npm run db:setup` migrates dev and `jobtracker_test`. Add `llm_calls` to the TRUNCATE list in `tests/helpers.ts`.
- New `src/lib/llm/prices.ts`: USD per 1M tokens `{ input, cachedInput, output }` keyed by exact Together id (case-insensitive) for GLM-5.3-Flash (0.15/0.03/0.50), MiniMax-M3 (0.30/0.06/1.20), DeepSeek-V4.1-Flash (0.30/0.006/1.20), Qwen3.8-Flash (0.15/0.15/0.47), gpt-oss-120b (0.15/0.15/0.60), from `docs/ai-models-for-jso.md`. `costUsd()` = uncached input + cached input + completion (reasoning is already inside completion tokens), rounded to 1e-8; null for unknown model or null tokens. Cost is computed at write time; raw tokens are kept so it can be backfilled.
- New `src/lib/llm/usage.ts`: `recordLlmCall(entry, { db? })` is fire-and-forget: computes cost, inserts, catches and logs every error, never throws or delays the model call. Tracks in-flight inserts; `flushLlmCalls()` awaits them. Skips the write under `process.env.VITEST` when no `db` is passed (tests load dotenv, which points at the dev DB).

## 5. Phoenix registration

- New `src/lib/llm/phoenix.ts`: `registerPhoenix()` copies kalres `instrumentation.node.ts` (project from `PHOENIX_PROJECT_NAME`, default `jobsearchos`; `OpenInferenceSimpleSpanProcessor` with `OTLPTraceExporter`, `ensureCollectorEndpoint`, optional bearer `PHOENIX_API_KEY`, `spanFilter: isOpenInferenceSpan`, `reparentOrphanedSpans: true`; simple, not batch, so spans survive restarts). Guarded by `globalThis` against double registration on dev reloads. Returns the provider or null.
- New `src/instrumentation.node.ts` calls it. `src/instrumentation.ts`: on nodejs, `await import("./instrumentation.node")` when `PHOENIX_COLLECTOR_ENDPOINT` is set, **then** start the queue worker.
- `src/lib/env.ts`: optional `PHOENIX_COLLECTOR_ENDPOINT`, `PHOENIX_PROJECT_NAME`, `PHOENIX_API_KEY`, `PHOENIX_UI_URL` (falls back to the collector endpoint). `.env.example`: commented block, including the `OPENINFERENCE_HIDE_INPUTS`/`_OUTPUTS` kill switches. Tracing is off when unset; usage rows are recorded either way.

## 6. Entry points (root spans)

| Action | Where | Ids |
|---|---|---|
| upload-resume | `src/app/api/resume/parse/route.ts:20` around `parseResume` | none |
| fill-job-details | `src/app/(app)/jobs/actions.ts:101` | jobId |
| research-company | `src/app/(app)/companies/actions.ts:72` | companyId |
| regroup-role | `src/app/(app)/library/record/actions.ts:139` | proposalId |
| add-job | `src/lib/queue/worker.ts` `processItem` around the pipeline run | queueItemId |
| find-contacts | worker `processSearch` | searchId, jobId |
| index-resume | worker `processIndex`; `addLlmIds` in `processResumeIndex` (`src/lib/resume/indexing.ts`) | documentVersionId, documentId |
| read-career-source | worker `processCareer`, inside `withAbortSignal`; `addLlmIds` in `processProposal` (`src/lib/career/queue.ts`) | proposalId, documentId |

Wrap in the worker functions, not deeper, so worker tests that inject `run` are unaffected. Rule for the docs: any new model call must run inside `withLlmContext`; misses show as action `unknown`.

## 7. Scripts

`scripts/eval-resume.ts`, `eval-jobs.ts`, `snapshot-job.ts`: call `registerPhoenix()` when the endpoint is set, wrap each run in `withLlmContext("eval-resume" | "eval-jobs" | "snapshot-job", {}, ..., { metadata: { effort, run } })` (no file names, which can be people's names), and in `finally`: `flushLlmCalls()`, `provider?.forceFlush()`, `provider?.shutdown()`, `db().$client.end()` so the process exits. They do write rows (real spend, shown as its own action).

## 8. Metrics queries

New `src/lib/usage/metrics.ts`: `getUsageMetrics(range, { db?, now?, timeZone? })`, ranges `7d|30d|90d` (default 30d, `parseRange`), days in the server's local time zone. Parallel SQL queries with `::int`/`::float8` casts:
- totals: calls, errors, stopped, cost, prompt/cached/completion/reasoning tokens, p50/p95 latency (successful calls), runs (`count(distinct run_id)`), unpriced calls, plus all-time spend;
- byDay via `generate_series` (gaps filled): cost, calls, errors;
- one rollup helper for byAction (with cost per run), byStep, byModel: calls, errors, tokens, cost, avg and p95 ms;
- latest 10 errors and latest 25 calls.
New `src/lib/usage/labels.ts` (`ACTION_LABELS`, `STEP_LABELS` typed as `Record` over the unions so a missing label fails to compile) and `src/lib/usage/format.ts` (`formatUsd`, `formatTokens`, `formatMs`).

## 9. The /usage page

- `src/components/nav.ts`: `{ href: "/usage", label: "AI usage", icon: Gauge }` before Settings.
- `src/app/(app)/usage/page.tsx`: async, `dynamic = "force-dynamic"`, awaits `searchParams`, renders; no h1 or width (layout owns them). Empty state: the dashed box used elsewhere.
- `src/app/(app)/usage/loading.tsx`: skeleton shaped like tiles, chart and table.
- `src/components/usage/`:
  - `range-tabs.tsx`: Tabs as a segmented control with nuqs (`shallow: false`, `startTransition`), as in `settings-tabs.tsx`; content dims with `aria-busy` while loading and animates in keyed on range (respecting motion-reduce).
  - `stat-tiles.tsx`: Spend (with a warning badge and lucide `TriangleAlert` when calls are unpriced, all-time spend below), Calls (errors, stopped), Tokens (cached, reasoning), Latency (p50/p95). Tile styling from `src/app/(app)/page.tsx:46-63`.
  - `daily-cost-chart.tsx`: client-only ECharts bar chart, ported from kalres `app/theadmin/metrics/daily-cost-chart.tsx` (tree-shaken `echarts/core` imports, loaded only on this page), theme colors from CSS tokens in light and dark, tooltip, Chart / Table toggle. Load the `dataviz` skill before writing it.
  - `breakdown-card.tsx`: inner Tabs (Action, Step, Model) over shadcn `Table`, with share of cost.
  - `recent-calls.tsx` and `errors-card.tsx`: local time, labels, model, tokens, cost, duration, status badge, short trace id with copy (`src/lib/clipboard.ts`), links to the job, company, document or proposal.
  - "Open Phoenix" button (`Button nativeButton={false} render={<a .../>}`, `ExternalLink` icon) when a Phoenix URL is configured.
- Motion and style: shared tokens in `src/app/globals.css`, Button press/loading, no symbol characters (ESLint enforces).

## 10. Tests and docs

- `tests/structured.test.ts`: mock `@/lib/llm/openai` (`chatClient`) and `@/lib/llm/usage`; cover a recorded success (ids, runId, tokens incl. cached, cost, effort), errors after spending tokens (invalid JSON, schema, length), API rejection (null tokens), call outside a context (`unknown`), context plus abort signal together, abort recorded as `stopped`, distinct runIds, null trace id with tracing off.
- Remove the now-dead `vi.mock("@/lib/llm/client", () => ({ together: () => ({}) }))` from the 16 other test files.
- New `tests/llm-calls.test.ts` (DB): row written with cost and nulls preserved; a failing insert does not throw.
- New `tests/llm-prices.test.ts`: worked GLM example (1000 prompt, 400 cached, 500 completion = 0.000352), unknown model and null tokens give null, case-insensitive ids.
- New `tests/usage-metrics.test.ts` (DB): seeded rows with fixed `now` and time zone; totals, percentiles, unpriced count, day gap-filling and window edges, per-action cost per run, ordering and range filtering.
- Docs: new `docs/llm-logging.md` (modeled on kalres: decisions, setup, files, step and action tables, trace tree, `llm_calls` columns, prices, the page, privacy, verification, known limitations); `docs/PRODUCT.md` (sidebar sentence, new "AI usage" section, user story, status row, privacy note about local Phoenix); `docs/ai-models-for-jso.md` (prices now live in `src/lib/llm/prices.ts`; measured cost on /usage); README optional "Phoenix tracing" setup.

## Verification

1. `npm run typecheck`, `npm run lint`, `npm test`, then `npm run build` (checks the external packages and instrumentation import).
2. With Phoenix running and `PHOENIX_COLLECTOR_ENDPOINT=http://localhost:6006` in `.env`, run the dev server and: add a job, upload a resume, research a company, find contacts.
   - Phoenix project `jobsearchos`: traces named by action, tree action > step > LLM span, with tokens including reasoning, `reasoning_effort` in the parameters, session and metadata set.
   - `psql`: `select action, step, status, prompt_tokens, cached_tokens, completion_tokens, reasoning_tokens, cost_usd, trace_id from llm_calls order by created_at desc;` trace ids match Phoenix; no `unknown` actions; confirm `completion_tokens >= reasoning_tokens` (pricing assumption).
   - Unknown model once: `status = error` row, red step span (no LLM span, known limitation). Stop and skip a career source mid-call: `status = stopped`.
3. `npm run eval:resume` on the synthetic resume: exits cleanly, `eval-resume` rows and traces appear.
4. Page check per the test-DB rule: seed ~500 synthetic rows over 90 days into `jobtracker_test` with a scratchpad script (failures, an unpriced model, every action), run the dev server with `DATABASE_URL` pointed at the test DB, check /usage in light and dark, desktop and mobile, range switch, chart tooltip and table toggle, empty state, no-Phoenix-URL case. Stop the dev server before running vitest.

## Risks noted

- A mid-stream abort may leave the instrumentor's LLM span open; check in Phoenix during verification.
- The queue timeout doesn't cancel the model call, so a late row can show a duration longer than the timeout.
- Prices come from our doc, not yet checked on Together's pricing page; rows keep raw tokens so cost can be recomputed.
- An insert in flight can be lost if the dev server is killed; accepted.
