# Stage 2b: Background job queue

## Why

Extraction used to run inside one browser request. Changing pages dropped the result, closing the tab abandoned the work (and wasted the AI call), and only one job could be processed at a time. Adding jobs is now a saved background task.

## How it works

- **`application_queue` table:** one row per job URL or pasted posting, with a status (`queued`, `running`, `saved`, `needs_review`, `duplicate`, `failed`), per-step progress, and the draft while a person is needed. A saved item points at its job
- **Worker inside the app server** (`src/lib/queue/worker.ts`, started from `src/instrumentation.ts`, and also woken by `GET /api/queue` and by adding items). It claims up to `QUEUE_CONCURRENCY` items (default 2) with `UPDATE ... FOR UPDATE SKIP LOCKED`, oldest first, so a batch runs in pasted order and two server processes can share the database safely. When an item finishes, the freed slot is refilled immediately
- **Pipeline** (`src/lib/jobs/pipeline.ts`): the same steps as before (duplicate check by URL, fetch, structure, duplicate check by company/title/location, company research, draft), as a function with injectable dependencies. A job already saved is detected before any AI call
- **Outcomes:** a clean result is saved automatically; an incomplete one waits as `needs_review` with its draft; an existing job becomes `duplicate`; an error becomes `failed` with a readable message (a blocked page suggests pasting the text)
- **Clean means:** a company, a title, and responsibilities or required qualifications were extracted. Saved jobs cannot be edited yet, so anything doubtful is reviewed instead of saved
- **Recovery:** a running item sends a heartbeat every 20 s. One silent for 90 s (the server died) is requeued, and failed after 3 interruptions. A single item has a 4 minute limit
- **Enqueueing:** up to 50 URLs per batch (one per line); invalid URLs, sites that block fetching (LinkedIn, Indeed), jobs already saved and URLs already queued are reported and skipped, so nothing is processed twice. Active queue size is capped at 200

## UI

- **New Application:** paste many URLs (or one pasted posting); a live queue shows each item's step and progress, with Review, View job, Retry and Remove; Clear finished
- **Sidebar tracker (bottom):** appears only when something is running, waiting, ready to review or failed; shows a batch progress bar, and links to the queue
- **Toasts** on other pages when items finish (summarized when several finish together); quiet on the queue page itself
- **Review:** `/new?review=<id>` opens the existing review form for that item; saving resolves the queue item
- **Motion:** rows ease in, fold away when removed, progress bars and status icons change in place, the tracker slides open and closed. All CSS (no animation library), and disabled for users who prefer reduced motion

## Setup notes

- Run `npm run db:setup` (migration 0005). Restart the app server once so `instrumentation.ts` is picked up; until then the worker starts the first time you add an item or open a page that polls the queue
- `QUEUE_CONCURRENCY` (1 to 5) in `.env` changes how many run at once; searches and AI calls scale with it
- The worker lives in the app server: if the server is stopped, items wait and resume when it starts
