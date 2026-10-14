<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Every LLM call must be logged in Postgres and in Phoenix

Any code that uses an LLM must be tracked in **both** places, with no exceptions for "small" or "temporary" calls:

1. **Our database:** one `llm_calls` row per call (numbers only: step, action, model, tokens, cost, time, outcome, linked ids), shown on the AI usage page (`/usage`).
2. **Arize Phoenix:** a trace per action with the full prompt and reply (on when `PHOENIX_COLLECTOR_ENDPOINT` is set).

Both happen automatically if, and only if, the call goes through the logging layer in `src/lib/llm/`. So:

- **Never call a model directly.** Do not use the `openai` or `together-ai` SDK, `fetch`, or any other client to reach a model from app code. Use `chatStructured` (`structured.ts`) for structured output, or `chatCompletion` (`chat.ts`) for plain text. Both record the row and the trace.
- **Always pass a `step`.** It is a required option. A new kind of call needs an entry in `LLM_STEPS` (`names.ts`) and `STEP_LABELS` (`src/lib/usage/labels.ts`); the compiler asks for the label.
- **Always run the call inside `withLlmContext(action, ids, fn)`** (`context.ts`) so the call is tied to what the user did and to the job, company or document it was for. A new user action needs an entry in `LLM_ACTIONS` and `ACTION_LABELS`. A call outside any context is recorded as action `unknown`; check with `select * from llm_calls where action = 'unknown'`.
- **Command-line scripts** that call a model must run through `runLlmScript` (`script.ts`), which flushes records and traces and closes the database before the script exits.
- **A new model** needs a price in `src/lib/llm/prices.ts`, or its calls are counted as unpriced.
- **Never store prompt or reply text in our database.** The `llm_calls` table is numbers and ids only; the text lives in Phoenix.
- **Tests** must not reach a real model or the dev database: mock `@/lib/llm/openai` (`chatClient`), and `@/lib/llm/usage` when asserting on what is recorded. The recorder writes nothing under Vitest unless given a test `db`.
- **Known gap:** embeddings (`src/lib/resume/embed.ts`, local Ollama) are not logged yet. Do not add any other uncovered model call. If a different provider or kind of model call is needed, extend the logging layer so it records both, instead of bypassing it.

Update `docs/LLM-LOGGING.md` when this layer changes, and see it for how it works.
