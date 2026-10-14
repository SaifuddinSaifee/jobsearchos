# LLM logging, tracing and the AI usage page

Status: **built.** Last updated 2026-10-14.

Every model call the app makes is recorded in two places:

1. **Our own database** (`llm_calls`): one row per call, **numbers only** (step, action, model, settings, tokens, cost, time, outcome, and which job or document it was for). Never the prompt or the reply. Kept forever. This feeds the **AI usage** page (`/usage`).
2. **Arize Phoenix** (optional, local): a trace per action with the **full prompt and reply** of every call, for debugging a bad result and, later, for evaluating prompt or model changes.

Each row carries its Phoenix trace id, so a call on the usage page can be found in Phoenix.

## Contents

- [Why](#why)
- [How a call is recorded](#how-a-call-is-recorded)
- [Actions and steps](#actions-and-steps)
- [The `llm_calls` table](#the-llm_calls-table)
- [Prices and cost](#prices-and-cost)
- [Phoenix tracing](#phoenix-tracing)
- [The AI usage page](#the-ai-usage-page)
- [Scripts](#scripts)
- [Privacy](#privacy)
- [Adding a model call](#adding-a-model-call)
- [Verification](#verification)
- [Known limitations](#known-limitations)

## Why

Before this, nothing was recorded: token counts were thrown away, so there was no way to say what the app costs, which step is slow or which calls fail. Changes such as running resume parsing at low reasoning effort (see [ai-models-for-jso.md](ai-models-for-jso.md#reasoning-effort)) could only be judged by hand.

## How a call is recorded

All chat calls go through one function, `chatCompletion` in [src/lib/llm/chat.ts](../src/lib/llm/chat.ts), reached through `chatStructured` ([structured.ts](../src/lib/llm/structured.ts)) or `TogetherProvider` ([generation.ts](../src/lib/llm/generation.ts)).

1. The call runs inside a named **step** span (`traceStep`).
2. It goes out through the `openai` SDK pointed at Together ([openai.ts](../src/lib/llm/openai.ts)), which is instrumented by OpenInference. That instrumentation makes the `OpenAI Chat Completions` span with the prompt, reply, settings and token counts. Model listing for the Settings page stays on the Together SDK, because Together returns a bare array there.
3. The reply is streamed and joined. The stream ends with a usage-only chunk (`stream_options.include_usage`), which gives prompt, completion, cached and reasoning tokens.
4. Validation happens **inside** the call (the `read` callback of `chatStructured`). A reply that cost tokens but is cut off, not JSON or off schema is therefore recorded as a failed call, with its tokens.
5. In a `finally`, `recordLlmCall` ([usage.ts](../src/lib/llm/usage.ts)) writes the row. It is fire and forget: it never throws and the model call never waits for it, so a slow or down database cannot break or stall a call. A lost record is logged as `[llm] usage record failed`.

Outcome is one of `ok`, `error`, or `stopped` (the user skipped a background job and its request was cancelled; this is not counted as a failure).

### Context

A call knows what it was for through `withLlmContext(action, ids, fn)` ([context.ts](../src/lib/llm/context.ts)):

- It stores the action, a fresh `runId` and the ids (job, company, document, ...) in an `AsyncLocalStorage`, next to the abort-signal store in [abort.ts](../src/lib/llm/abort.ts). The two nest in either order.
- It opens the trace's root span, and sets the Phoenix **session** (job, else company, proposal, document or queue item) and **metadata**.
- It always starts a **fresh trace**. `kickWorker()` can run queue work from inside a web request, which would otherwise pull the job into that request's trace.
- `addLlmIds` adds ids learned part way through (a resume's document, a career source's document).
- With tracing off it adds no spans, and usage rows still get their context.

## Actions and steps

An **action** is what the user did; a **step** is one kind of call inside it. Names are in [names.ts](../src/lib/llm/names.ts) and their labels in [labels.ts](../src/lib/usage/labels.ts) (a `Record` over the unions, so a missing label fails to compile).

| Action | Where it is opened | Steps it makes |
| --- | --- | --- |
| `add-job` | Queue: `processItem` | `extract-job`, `research-company` |
| `find-contacts` | Queue: `processSearch` | `extract-posting-people`, `find-people-web`, `rank-contacts` |
| `index-resume` | Queue: `processIndex` | `parse-resume` (only for an unstructured upload) |
| `read-career-source` | Queue: `processCareer` | `parse-resume`, `group-bullets`, `classify-cover-paragraphs` |
| `upload-resume` | `POST /api/resume/parse` | `parse-resume` |
| `fill-job-details` | Server action | `extract-additional-details` |
| `research-company` | Server action | `research-company` |
| `regroup-role` | Server action | `group-bullets` |
| `eval-resume`, `eval-jobs`, `snapshot-job` | Scripts | the step under test |

A call made outside any context still works but is filed under action `unknown`: find them with `select * from llm_calls where action = 'unknown'`.

## The `llm_calls` table

Defined in [schema.ts](../src/lib/db/schema.ts), migration `drizzle/0020_llm_calls.sql`.

| Column | Notes |
| --- | --- |
| `created_at` | When the call finished |
| `action`, `step` | See above |
| `run_id` | One per `withLlmContext` run, so the cost of "one job added" can be summed |
| `model` | The model id requested |
| `reasoning_effort` | `low`, `medium`, `high`, or null when not set |
| `status`, `error` | `ok`, `error` or `stopped`; the first 300 characters of the message |
| `finish_reason` | `stop`, `length`, ... |
| `prompt_tokens`, `cached_tokens`, `completion_tokens`, `reasoning_tokens` | Null when the provider reported no usage (rejected, stopped or broken request). Reasoning tokens are part of the completion count |
| `cost_usd` | Null when the model has no known price or no usage was reported |
| `duration_ms` | Includes the SDK's own retries |
| `trace_id` | The Phoenix trace, null when tracing is off |
| `job_id`, `company_id`, `document_id`, `document_version_id`, `proposal_id`, `search_id`, `queue_item_id` | What it was for. **Not foreign keys**: history outlives what it points at |

Indexes: `created_at`, and `(job_id, created_at)` where the job is set.

## Prices and cost

[prices.ts](../src/lib/llm/prices.ts) holds USD per million tokens (input, cached input, output) for the models we use or consider, keyed by exact Together model id. Cost is `(prompt - cached) x input + cached x cachedInput + completion x output`, **worked out when the row is written**, with the raw tokens kept so it can be recomputed if a price changes.

A model with no entry is **unpriced**: its calls are recorded with a null cost and the page counts them and says they are left out of spend. Prices come from [ai-models-for-jso.md](ai-models-for-jso.md); check them against Together's pricing page before relying on the dollar figures.

Checked with a live call: completion tokens are at least reasoning tokens (1933 vs 1177), so thinking is already billed inside completion and is not added again.

## Phoenix tracing

Off unless `PHOENIX_COLLECTOR_ENDPOINT` is set. [instrumentation.ts](../src/instrumentation.ts) registers it first, then starts the queue worker, so the first background calls are traced.

- [phoenix.ts](../src/lib/llm/phoenix.ts) registers `@arizeai/phoenix-otel` with one span processor. Spans are exported **as soon as they end**, not batched: a batch still queued when the server stops is lost. A span filter sends Phoenix only model traces, not every Next.js request. Registration is guarded against a second global provider on a dev reload.
- The span processor lives in an ESM-only entry point, so it is loaded with a dynamic `import()` (the scripts compile to CommonJS and cannot `require` it).
- `openai`, `@arizeai/phoenix-otel` and `@arizeai/openinference-instrumentation-openai` are in `serverExternalPackages` ([next.config.ts](../next.config.ts)).
- Project: `PHOENIX_PROJECT_NAME`, default `jobsearchos`. `PHOENIX_API_KEY` is sent as a bearer token when set.

A trace looks like:

```
add-job                           root: action, run id, ids (session: job)
|- extract-job                    step
|  \- OpenAI Chat Completions     prompt, reply, reasoning_effort, tokens incl. thinking
\- research-company
   \- OpenAI Chat Completions
```

Tracing adds no measurable latency: against a local fake stream, 1524 ms traced vs 1521 ms untraced, with the same time to first chunk.

## The AI usage page

`/usage` ("AI usage" in the sidebar). The range (7, 30 or 90 days) is in the URL (`?range=`). Days follow the server's time zone, which for this local app is yours.

- **Tiles:** spend (with all-time spend, and a warning when calls are unpriced), calls (actions, failed, stopped), tokens (cached, thinking), typical call time (median and slowest 1 in 20 of the calls that succeeded).
- **Spend per day:** an ECharts column chart loaded only on this page, with a hover tooltip and a Chart / Table toggle.
- **Where it went:** by action (with cost per action), step or model.
- **Failures** and **recent calls**, with links to the job, company, document or career record, and a copyable trace id.
- **Open Phoenix** button when `PHOENIX_UI_URL` (or the collector endpoint) is set.

Queries are in [src/lib/usage/metrics.ts](../src/lib/usage/metrics.ts); components in [src/components/usage/](../src/components/usage/).

## Scripts

`eval:resume`, `eval:jobs` and `snapshot:job` run through `runLlmScript` ([script.ts](../src/lib/llm/script.ts)), which turns tracing on, runs the script, and flushes the usage records and traces and closes the database before exiting (otherwise the last records are lost and the process hangs). Their calls are recorded under `eval-resume`, `eval-jobs` and `snapshot-job`, with the effort and run number as trace metadata. These are real spend, so they appear on the page.

## Privacy

- Our database holds **no prompt or reply text**, only numbers and ids.
- Phoenix holds the full text, including resumes and job postings. It runs on your machine and nothing is sent elsewhere.
- To keep text out of Phoenix and keep timings and token counts, set `OPENINFERENCE_HIDE_INPUTS=true` and `OPENINFERENCE_HIDE_OUTPUTS=true`.
- Run names and trace metadata use ids and settings only, never file names.

## Adding a model call

1. Add the step to `LLM_STEPS` in `names.ts` and its label to `STEP_LABELS` (the compiler asks for it).
2. Pass `step` in the options to `chatStructured` (it is required).
3. Make sure the code path runs inside `withLlmContext`. A new user action also needs an entry in `LLM_ACTIONS` and `ACTION_LABELS`.
4. A new model needs an entry in `prices.ts`, or its calls show as unpriced.

## Verification

Checked with real calls on 2026-10-14:

- Rows and traces for the eval script, with `reasoning_effort` in the parameters, provider `together`, thinking tokens, and metadata. Trace ids match between the table and Phoenix.
- The upload route through the running Next dev server (webpack): an `upload-resume` row and a three-span trace.
- A rejected model (404): an `error` row with no tokens or cost, and red spans in Phoenix.
- The page, in light and dark, desktop and mobile, the range switch, chart tooltip and table view, against 380 synthetic rows in the test database.
- Metrics, prices, the recorder and the context are covered by tests: `structured`, `llm-calls`, `llm-prices`, `usage-metrics`.

Not checked live: stopping a background job mid-call (covered by a test with a mocked client).

## Known limitations

- A mid-stream abort may leave the instrumentation's span open. Check in Phoenix when it matters.
- The queue's timeout does not cancel the model call, so a late row can show a duration longer than the timeout.
- An insert in flight can be lost if the dev server is killed.
- Prices are from our own notes, not yet checked on Together's site.
- Embeddings (local Ollama) are not recorded: they are not model calls on Together.
