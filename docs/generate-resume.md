# Step 2: Generate a resume for a job

**Status: built** on branch `enh-career-records`. The plan below is what was agreed; "As built" at the end lists where the
build differs from it.

## Context

The app can capture a job from a link, research the company, track the application and email a contact, but it cannot
write anything. Step 1 (opt-in career record) is done, so the record is now the trusted source of what the user has
done. This step adds the writing, as an action the user asks for, never automatically:

> Paste a link: the job is saved to the tracker (as today). Later, open the job and click **Generate resume**. The app
> lines up what the job asks for against your career record, shows you that list for a moment (you can say "I have
> this" or skip), then writes a one-page tailored resume and opens it in the editor. From there you edit, download,
> attach it to an email, regenerate it, or add it to your career record.

Decisions confirmed with the user:
- Generation only on request. Saving a job never writes or spends anything.
- Requirement review before writing, skippable (a setting turns it off for good).
- **One generated resume per job.** Once it exists, the job offers **Open resume**. Regenerating is done from the
  editor and saves the result as a new version of the same document (old versions stay restorable).
- Starting a generation moves the job from Saved to Preparing (only from Saved), with Undo.
- If the career record is empty, write from the base resume directly.
- CLAUDE.md "Writing for a job" applies: assume the user is qualified; "I have this" claims are written in; no
  refusing or watering down. The record itself stays word for word (we never write generated text into it unless the
  user adds the resume via step 1's one-click add).
- Every model call goes through `chatStructured`, with a step, inside `withLlmContext` (AGENTS.md).

## The user journey (how it should feel)

**Entry points (all lead to the same place):**
1. Job drawer (`/jobs?job=<id>`, `src/components/jobs/job-sheet.tsx`) header: a primary **Generate resume** button
   next to "Email a contact". When the job has a generated resume: **Open resume**. While one is being made:
   "Writing resume..." with a spinner (click opens the progress page).
2. The toast after a pasted link is saved ("Saved: X", `queue-notifier.tsx`): **View** and **Generate resume**.
3. Jobs table row menu (`row-actions.tsx`): Generate resume / Open resume.
4. Editor of the generated resume: **Regenerate**.

**The resume page `/jobs/[id]/resume`** (same pattern as the existing `/jobs/[id]/outreach` page, so it is
deep-linkable, survives reload, and the sidebar can link to it):
1. *Matching* (about 10 to 20 seconds): steps shown live ("Reading the job", "Matching your career record").
   "You can leave this page" note, like contact search.
2. *Review* (skippable): requirements grouped **Must have**, **Nice to have**, **Keywords**, **From the company**.
   Each shows a chip (In your record / Partly / Not in your record) and the evidence (role and fact text, a skill or a
   project). A "Not in your record" or "Partly" item has an **I have this** toggle with an optional one-line note
   ("AWS certified, 2023"). Footer: **Write resume** (primary), "Don't show this step again" checkbox. The job's status
   moves to Preparing here, with an Undo toast.
3. *Writing* (about 30 to 60 seconds): "Choosing your best experience", "Writing bullets". (The one-page fitting step was removed in the third pass, below.)
   **Stop** cancels the model call. When done, the page goes straight to the editor (`/library/<docId>`); if the user
   left, a toast "Resume for Stripe is ready" with **Open** appears wherever they are, and the sidebar card says so.

**In the editor**, a generated resume shows a strip above the page: "Written for Backend Engineer at Stripe from your
career record (version 12), Oct 15. [View job] [Regenerate]". Regenerate saves any unsaved edits as a version, then
opens the resume page with the last review answers prefilled; the result becomes the next version. The existing
"Add to career record" card and button (step 1) work as they do now.

**Connected to the rest of the app:**
- The job drawer gets a **Documents** section listing every resume and cover letter linked to the job (title, origin,
  last version, locked badge, Open).
- Outreach for that job attaches the job's generated resume by default instead of the base resume.
- Marking the job Applied locks the resume, as it already does for documents linked to a job.
- The AI usage page shows the new action "Generate a resume" and its steps.

**Empty states:**
- Career record empty, base resume exists: the review step says "Your career record is empty, so this is written from
  your base resume" (with a link to the Career record tab). No fact citations.
- Neither exists: the button opens the page with "Add a resume to your Library first" and a link.

## How it works

### Data (migration `0022_resume_generations`, via `drizzle-kit generate`)

New table `resume_generations` (template: `contact_searches` in `src/lib/db/schema.ts`):
- `id`, `job_id` (FK), `document_id` (FK, null until the first write; set from the start for a regeneration)
- `status`: `queued`, `matching`, `review`, `writing_queued`, `writing`, `done`, `failed`, `stopped`
- `source`: `record` | `base_resume`; `record_version` int; `base_version_id`
- `requirements` jsonb: `{ id, text, kind: must|nice|keyword|company, weight, verdict: met|partial|missing, evidence: string[], userHas: boolean, note }[]`
- `skip_review` boolean, `steps` jsonb (step states, like `SearchSteps`), `bullet_facts` jsonb (`{ blockId: factId[] }`)
- `error`, `attempts`, `created_at`, `started_at`, `finished_at`, `updated_at` (heartbeat)
- Indexes: `(status, created_at)`, `(job_id, created_at)`, unique partial on `job_id` where status is active.

Also:
- `VersionReason` gets `generated` (CHECK constraint in the migration, `REASON_LABELS.generated = "Generated"` in
  `src/lib/documents/types.ts`). Origin `generated` already exists everywhere.
- `GenerationInstructionsSchema` (`src/lib/profile/schema.ts`) gets `reviewRequirements: boolean` (default true;
  jsonb, so no migration). Its existing `styleRules`, `tone` and `sectionLimits` feed the writer.
- Add the table to the TRUNCATE list in `tests/helpers.ts`.

### Pipeline (`src/lib/resume-writer/`, pure where possible, model injected for tests)

1. **`context.ts`, the inputs** (no model):
   - Job: `requirements.required` (must), `requirements.preferred` (nice), `technologies` plus `job_keywords`
     extracted (keyword), the company profile's `principles` and `about` (company, low weight). Deduped, ids `r1..rn`,
     capped at about 40.
   - Source record: `currentRecord()` (`src/lib/career/service.ts`). If it has no employers, build an in-memory record
     from the base resume: `extractFromDoc` then `buildProposal` against `emptyRecord()` then `applyProposal`
     (`src/lib/career/extract.ts`, `proposal.ts`, `apply.ts`); nothing is saved.
   - Aliases for the record: facts `f1..` (with their wordings), skills `s1..`, projects `p1..`, certifications `c1..`.
2. **`match.ts`, the requirement map** (step `match-requirements`, `EXTRACTION_MODEL`):
   - Free pass first: a keyword or technology that matches a record skill or appears in a wording (normalized, as in
     `src/lib/career/normalize.ts`) is `met` with that evidence, with no model.
   - One `chatStructured` call for the rest. The answer schema is built per call from enums only (copy
     `src/lib/career/group.ts`): `{ req: enum(r ids), verdict: enum, evidence: enum(f/s/p/c ids)[] }[]`. Unknown ids
     are dropped; a missing answer is `missing`. Retry once, then fail.
3. **`write.ts`, the resume** (step `write-resume`, `WRITER_MODEL`):
   - Code first picks, for each role, the framing that fits the job (`guessAngle(job.title)` against `framing.angle`,
     plus `targetRoles`, from `src/lib/career/match.ts`) and its wordings (`wordingsForFraming` in `framing.ts`).
     Facts are ordered by how much requirement weight they cover.
   - The model gets the job, company summary, the map, the record by alias, the user's "I have this" items (aliases
     `u1..`, with notes), generation instructions, and a budget (default: most recent role 5 bullets, others 3 to 4,
     about 16 bullets total, each under about 220 characters; `sectionLimits` override).
   - The answer schema: `summary`; `roles: [{ role: enum, bullets: [{ facts: enum(f and u ids)[], text }] }]`;
     `skills: [{ category, items[] }]`; `projects: [{ project: enum, bullets }]`; `education: enum[]`;
     `certifications: enum[]`. Employers, titles, dates and locations are filled in by code from the record, never by
     the model.
   - The prompt carries the CLAUDE.md stance (the user is qualified; work in the "I have this" items; reword for the
     posting) and the writing rules already in code: `BANNED_PHRASES` / `findBanned` and the no-long-dash rule from
     `src/lib/outreach/checks.ts`. If the text breaks them, one repair retry.
4. **`build.ts`, the document** (no model): header from `Profile.contact` (`getLatest()`, `src/lib/profile/service.ts`); as built, any field the Profile leaves
   empty is filled from the header of the base resume, then of the latest uploaded or written resumes (`loadContact` in
   `source.ts`, never from a generated one),
   sections built with the helpers in `src/lib/documents/build.ts` (like `profileToDoc`, but bullets get known ids so
   `bullet_facts` maps each bullet to its facts).
5. **`fit.ts`, one page** (removed in the third pass; see "As built") (no model): render with `renderPdf` (`src/lib/documents/export/pdf.ts`) and count pages.
   Over one page: drop the lowest-weight bullet (never one with a user's "I have this" item, never below 2 per role)
   and render again, at most 4 times. If the browser is unavailable, skip with a note. The editor's `fitOnePage`
   tightens spacing as it does now.
6. **Save**: first time, `createDocument` (`src/lib/documents/service.ts`) with `kind: "resume"`,
   `origin: "generated"`, `reason: "generated"`, `jobId`, `targetRole: job.title`, `jdUrl`, `writtenOn` today, title
   "Resume for {title} at {company}". On regeneration, a new service function `addGeneratedVersion(docId, content)`
   (modelled on `restoreVersion`: insert the version, replace the draft, bump the revision). `enqueueAfterCreate`
   as usual.

### Background work

- A new slot in `tick()` in `src/lib/queue/worker.ts`, modelled on the career slot: claim (`FOR UPDATE SKIP LOCKED`),
  heartbeat, sweep stale, recover at startup, timeout 4 minutes per phase, and an `AbortController` map for Stop
  (copy `stopCareerProposal` and `processCareer`). Matching runs on claim. It then stops at `review` unless review is
  off, in which case it continues. Writing runs when the user clicks Write resume (`writing_queued`).
- LLM logging: action `generate-resume` in `LLM_ACTIONS` and `ACTION_LABELS`, steps `match-requirements` and
  `write-resume` in `LLM_STEPS` and `STEP_LABELS` (`src/lib/llm/names.ts`, `src/lib/usage/labels.ts`). Ids: `jobId`,
  and `documentId` once known. Both models are already priced. The unused `generation.ts` stub is removed.

### Server actions and API

- `src/app/(app)/jobs/[id]/resume/actions.ts` (the `run()` Result pattern from `library/actions.ts`):
  - `startGenerationAction(jobId, { regenerate })`
  - `saveReviewAction(id, answers)`
  - `writeResumeAction(id, { skipReviewNextTime })`: also moves Saved to Preparing via the existing `changeStatus`;
    the client shows Undo.
  - `stopGenerationAction(id)`
- `GET /api/jobs/[id]/resume` returns the latest generation for the job, polled with react-query (1.5 s while
  active), and `GET /api/resume-generations` returns the active ones for the sidebar.
- `getJobDetail` (`src/lib/jobs/tracker.ts`) returns the job's documents and its generated resume id.
- `defaultAttachmentId` in outreach (`src/lib/outreach/attachments.ts`, `service.ts`) prefers the job's generated
  resume.

### UI files

- `src/app/(app)/jobs/[id]/resume/page.tsx` and `src/components/resume-writer/` (progress steps like
  `search-progress.tsx`, the review list, the "I have this" toggle).
- `job-sheet.tsx`: the header button and the Documents section.
- `row-actions.tsx`, `queue-notifier.tsx`: entry points.
- `document-view.tsx`: the generated strip with Regenerate.
- A sidebar tracker card like `search-tracker.tsx`.
- Follow the motion system (memory: `Button loading`, `Collapse`, `animate-in`, motion-reduce) and the page layout
  rules (no own max width or `h1`).

## Build order

1. Migration and types, settings flag, LLM names and labels, `addGeneratedVersion`.
2. `context.ts` and `match.ts` with tests (injected chat; the free pass; enum guard; the base resume fallback).
3. `write.ts`, `build.ts`, `fit.ts` with tests (fields filled by code; citations; budget; trim order; banned phrases).
4. Worker slot, actions, API, stop and recover.
5. UI: resume page, job drawer button and Documents section, editor strip and Regenerate, sidebar card and toasts,
   row menu, paste-link toast, status move with Undo, outreach default.
6. Docs: PRODUCT.md (Writing section, user stories, the step 2 description above), PLAN.md Stage 4, LLM-LOGGING.md
   action table, a short "as built" in the stage doc, and the memory file for the product direction.

Later (not in this step): the score panel with Fix with AI and keywords (step 3), using the stored `requirements`;
step 1's one-click add using `bullet_facts`, so adding a generated resume needs no grouping call; cover letters and
cold emails on the same path.

## Verification

- `npm run typecheck`, `npm run lint`, `npm test`. New DB tests run on `jobtracker_test`, and the model is always
  injected:
  - one active generation per job;
  - review then write, and skip review;
  - the base resume fallback;
  - regeneration adds a version;
  - Stop records nothing;
  - status Saved to Preparing only from Saved;
  - every call recorded with action `generate-resume` (mock `@/lib/llm/usage`).
- Browser check on the test DB (memory: browser-checks-test-db). Seed a record and a job with synthetic text, then
  click through:
  - the drawer, matching, review with "I have this", writing, and the editor opening;
  - the generated strip, Regenerate, and the Documents section;
  - Outreach attaching the generated resume by default.

  Run with the real Together key on synthetic text only; confirm the PDF is one page and
  `select action, step from llm_calls` shows `generate-resume` rows and no `unknown`. Stop the dev server before
  `npm test`.
- A small `scripts/eval-resume-writer.ts` (through `runLlmScript`) on two synthetic jobs, to compare `WRITER_MODEL`
  with DeepSeek V4.1 Flash later, as `docs/ai-models-for-jso.md` suggests.

## As built

Everything above was built as planned, in the same order, except:

- **Where the code is:** `src/lib/resume-writer/` (`types`, `context`, `match`, `source`, `write`, `keywords`, `build`,
  `service`, `process`), the page `src/app/(app)/jobs/[id]/resume/`, `src/components/resume-writer/`, the table
  `resume_generations` and migration `0022_resume_generations`.
- **Company values** count as requirements only from the short lines of the company profile's principles (list items or short
  lines, at most four); the model is not asked to find them.
- **A requirement the user has** reads in the skills line as the technology it names ("Experience with Kafka" becomes
  "Kafka"), taken from the job's technologies; a sentence that names none is only written into a bullet.
- **Page fitting** (removed in the third pass): it counted pages by printing at spacing 6 of 8 and dropped bullets.
- **Row menu and the pasted-link toast** lead to the resume page (or its Generate button) instead of starting a generation
  themselves, because they do not know each job's state. The toast's second button is "Generate resume".
- **Header of a resume written for a job** gets the same strip in the editor (View job, Regenerate with a confirmation).
- **Removed** the unused `GenerationProvider` stub and its `generate-document` step; each kind of call has its own step.
- **Verified** on the test database with the real models on synthetic text: matching took about 10 seconds and the writing
  about 7, at about $0.002 for a resume; every call was recorded under `generate-resume` and none under `unknown`.

### Writing rules taken from `SKILL.md` (second pass)

The first build wrote its prompt from CLAUDE.md alone. A second pass brought in what works in the job application skill:

- **Assume qualified.** `assumeQualified` (in `types.ts`) ticks every requirement the source does not fully show as "I have
  this", except the company's values. The review screen starts from it (and shows "Your record covers X%. With what you have:
  Y%"); with the review off, `runMatching` applies it before writing. The stored verdicts stay what the source really says.
- **Prompt:** exact wording of the job's terms, acronyms once, top terms two or three times across summary, first bullets and
  skills, the title in the summary, action and result bullets, no invented numbers, certifications or degrees, the company not
  named, responsibilities not copied, a `JOB TERMS` section (technologies and keyword requirements, at most 12).
- **In code:** `keywords.ts` checks which job terms the resume uses (`keywordCoverage`), asks the writer once more for the ones
  it left out that the candidate has, and records "Job terms worked in / not worked in" as notes; bullets of a role are ordered
  by relevance (`WrittenBullet.relevance`), skills with the job's terms first and the line with the most first; and the banned
  list gains "next stage of my career", "the combination of", "results-driven" and similar.
- **Not taken:** the locked format (the editor's layout is fixed) and chat-Markdown output.

### Third pass: no stuffing, cleaner content, no page fitting

The first real resume (a consumer storytelling job) showed job tags forced into bullets ("Books apps", "Compute",
"Adaptability"), the company's mission quoted in the summary, product facts under an engineering title, school entries three
times, broken skill brackets, and a page fitter that could not get to one page. Changes:

- **A use for every requirement** (`RequirementUse` in `types.ts`: experience, skill, domain, trait, logistics). The match
  call (`match.ts`) returns it for all requirements in the same call (a `uses` list in its schema, so there is no extra call);
  before that the job's technologies start as skills, other keywords as fields and sentences as experience. Older generations
  without it fall back by kind (`requirementUse`).
- **What follows from the use:** `assumeQualified` ticks only experience and skills of the must haves and nice to haves
  (keywords, fields, ways of working, the company's values and conditions start unticked, so the user picks); the match score
  leaves out conditions; `jobTerms` (the terms the writer is asked to use) lists only skills the candidate has, which means
  met in the source or ticked by the user, and a technology the job names only inside a sentence counts only when the
  record itself says it (`has`), because the sentence being met does not make it the candidate's (this stopped an invented
  "shipped on Vercel").
- **Prompt:** `WHAT THE JOB ASKS FOR` leaves out conditions, fields, ways of working, the company's values and gaps nobody
  ticked (`askedFor`); a `THE COMPANY` section carries its field, about text and values for tone only; `SHOW, DO NOT NAME`
  lists ways of working; each term is used once; one bullet is one fact (at most two ids); length follows importance (hard
  limit 420 characters, supporting bullets about 200).
- **Checks in code** (`keywords.ts`): wording copied from the posting or the company's text (a run of six words), a term in
  more than three places, a way of working named outright. Each triggers the one retry, with the same loop as banned phrases.
  The old "ask again for missing terms" retry is gone.
- **Content chosen in code** (`planWriting`): only facts with wording for the chosen title (fallback to all of a role's
  wording when none fits), skills lines ("Technologies: ...") are not facts, budgets 5/4/3 of 14, projects ranked by the
  requirements they answer and the share of the job's words they contain, `pickEducation`, `uniqueCertifications`,
  `balanceBrackets` and `skillKey` for skills.
- **The record** (`src/lib/career/`): `splitOutsideBrackets` for skill lines, `sameEducation` and `certKey` so a merge matches
  a school or certification written differently. The existing record is not rewritten.
- **The name and contact line** of a written resume come from the Profile, then the base resume's header, then the latest
  uploaded or written resumes (`loadContact` in `source.ts`).
- **Removed** one-page fitting (`fit.ts`, `render.ts`, the `fit` step and its note, bullet drop weights).
- **Verified** on the test database with the real models and synthetic text shaped like the real record: no tags in bullets,
  no relocation, no mission quote, one education entry, engineering facts only, one certification, a project included;
  two write calls when the first answer used a generic phrase, about $0.005 in all.

### Fourth pass: edit the candidate's words, then review

The third pass stopped the stuffing, but the result still read as written by a model, even for facts in the record: the
writer rewrote every line, dropped named tools and products, and added "so that" results nobody wrote. The user chose the
models for this pass: GLM-5.3 at the highest reasoning effort writes, and Kimi K3, a different model, reviews.

- **Edit, do not write** (`write.ts`). The prompt is an editor's: start from the candidate's own wording (each fact's
  wording that says the most of what the job asks for is offered first), change only what the job needs, keep every name
  and number, never add a result, purpose, interest or background the candidate did not give. Bullets vary in length with
  importance; every bullet ends the same way (`bulletText`), and a skill a fuller one covers is dropped (`withoutCovered`).
- **Code checks** (`faithful.ts`): per bullet against the candidate's lines it cites, new numbers, an added outcome clause,
  lost names (fewer than half of a source's tool and product names kept) and a rewrite (under half of its words from the
  source, the user's items or the job's terms); plus the earlier generic-phrase and stuffing checks, and a missing mention.
- **Review** (`review.ts`): Kimi K3 reads each bullet with the candidate's lines under it, the job, what the candidate says
  they have and the code findings, scores ten criteria from 1 to 5 (`RUBRIC`, each with what a 5 and a 1 look like) and
  lists up to 15 edits, each aimed at a bullet id, the summary or the skills. Its stance: the candidate is qualified,
  ticked items are true and never questioned, no new numbers or claims, the candidate's own wording is the voice to keep.
- **Revise** (`writer.ts`): GLM-5.3 gets its draft, the bullets by id, the review's edits and the code findings, and returns
  the whole resume. A failed review or revision keeps the draft with a note; the review is retried after 20 and 40 seconds
  on rate limits. Code then puts back to the candidate's own first wording any bullet under a third of its words from its
  sources (`revertRewrites`), unless it works in something the user ticked.
- **GLM-5.3 does not think under structured outputs**, so the writer asks for JSON in the prompt (`jsonMode: "prompt"` in
  `chatStructured`); see `docs/ai-models-for-jso.md`.
- **Also in this pass:** achievements always on the resume; interests the user ticks become one Interests line (never
  claimed otherwise); a condition can be ticked as "Mention it" and closes the summary; header links shown as labels keep
  their address (`contactPieces` in `doc-to-profile.ts`); the writing phase limit is 15 minutes and the client retries
  rate limits six times.
- **Verified** with the real models on the test database: review 4.4 to 4.9 of 5, two to four edits applied, bullets in the
  candidate's own words with names and numbers kept, about $0.22 and 7 to 8 minutes a resume.

Not yet: the score panel with Fix with AI (step 3), cover letter and cold email, and using `bullet_facts` so adding a
generated resume to the career record needs no grouping call.

### Evaluating the writer

`npm run eval:writer` ([scripts/eval-resume-writer.ts](../scripts/eval-resume-writer.ts)) writes a resume for each of five
synthetic cases ([cases.ts](../scripts/eval-resume-writer/cases.ts): an engineer with a product telling of the same role, a
product manager, an ML engineer, a designer, a teacher moving into instructional design) with each writer and reviewer
config, and reports per run: cost, wall clock, tokens by stage (input, cached, output, reasoning), latency, retries and
the time spent waiting on them, the review's scores and edits, the code-check findings on the draft and the final resume,
and flags (reviewer failed, fell back, or disagrees with the code checks).

- **Same input for every config.** Each case is matched once and ticked as a user would (the defaults plus the case's own
  ticks); every config writes from that. `--matches <earlier run>` reuses a match, so two runs compare like for like.
- **Configs** are named in the script (`--configs A,B,C,D`). The writer's model and effort, the reviewer's model, a
  fallback reviewer and the revision mode are options of `makeWriter` (`WriterConfig`); the app passes none of them, so
  its defaults are unchanged.
- **Fallback reviewer:** when the config's reviewer still fails after its retries, GLM-5.3 (high effort, JSON by prompt)
  reviews, and the run is flagged.
- **Revision modes** (`--revision always|targeted|both`): `always` is the app's flow. `targeted` skips the revision when
  no code check found anything and the review has no material edit (an edit on `faithful`, `outcomes` or `specific`, or
  on a criterion scored 3 or less: `materialEdits`); otherwise the writer rewrites only the flagged bullets, summary,
  skills or interests (`patchSchema`, `applyPatch`), and every other bullet keeps its text and facts.
- **Disagreement** (`disagreements`): the review says "ready" while the code checks found something, makes no edit to a
  part a check flagged, or marks `faithful` or `outcomes` 3 or less while the checks found nothing unfaithful.
- **Blind outputs:** each final resume is saved as `blind/<case>/resume-<random>.md`; `key.json` says which config wrote
  it, and `report.md` and `runs.json` hold the numbers. Runs go to `eval-runs/` (ignored by git).
- **Usage records** go to the test database unless `--dev-db` is given; the report reads them back by run id.
- **Retries** are recorded on every call now (`retry_count`, `retry_wait_ms` in `llm_calls`, counted in
  `src/lib/llm/attempts.ts`), and a generation records `work_ms`, the time spent matching and writing without the wait
  for the user's review.

First results (2026-10-15, one run per config and case, so small differences are noise):

| Config | Writer, reviewer | Written | Mean cost | Mean time | Final resumes with a code-check finding |
| --- | --- | --- | --- | --- | --- |
| A (the default then) | GLM-5.3 max, Kimi K3 | 5 of 5 | $0.25 | 8.0 min | 3 of 5 |
| B | GLM-5.3 max, DeepSeek V4.1 Flash | 4 of 5 | $0.26 | 10.4 min | 2 of 4 |
| C | GLM-5.3 high, DeepSeek V4.1 Flash | 5 of 5 | $0.06 | 2.3 min | 2 of 5 |
| D | GLM-5.3 Flash max, DeepSeek V4.1 Flash | 4 of 5 | $0.03 | 7.7 min | 1 of 4 |

- **Max effort runs out of room.** GLM-5.3 at max reasoned 22,000 to 32,000 tokens per draft (not the 14,000 measured
  earlier), and six calls in B and D were cut off at `WRITER_MAX_TOKENS` (32,000), all of it thinking; two in a row fail
  the resume. A was not cut off in these five runs but came within 300 tokens once. GLM-5.3 Flash does think with JSON
  by prompt (25,000 tokens a draft at max).
- **No final resume in any config had an invented number, result or rewrite.** What remained were copied posting phrases,
  a dropped tool name, and the designer case's hybrid-office mention, missed by every config (a prompt issue).
- **Kimi K3's review** took about 3 minutes and 45% of A's cost; DeepSeek's took 15 to 25 seconds. No reviewer failed or
  needed the fallback.
- **Revision modes on C** (step 2, same matches): `always` $0.037 and 80 s, `targeted` $0.032 and 73 s. No run skipped
  its revision (every review had a material edit), and a targeted revision saved only about 6 seconds and $0.004, since
  at high effort the revision is already small. Final findings: 3 of 5 with `always`, 1 of 5 with `targeted`.
- C's own numbers moved between the two runs (step 1: $0.059 and 138 s; step 2: $0.037 and 80 s), which is the size of
  the noise to expect.
- C became the app's default: see "Fifth pass".

### Fifth pass: the defaults the eval chose, and what it found

- **Defaults:** GLM-5.3 at `high` effort writes (`WRITER_EFFORT`), DeepSeek V4.1 Flash reviews (`REVIEW_MODEL`), in
  `env.ts`, `.env` and `.env.example`.
- **A call cut off at the output limit is asked again with one step less effort** (`askWithRetry`, `lowerEffort`): the
  draft is tried twice for any failure, the revision only when cut off. Asking the same way runs out of room the same way.
- **The mention has its own field.** The summary's "two sentences at most" crowded out the condition the user asked to
  mention (the designer case missed its office days in all six runs). The writer now writes `mention`, required when there
  is one, and code puts it after the summary (`withMention`) unless the summary already says it. The rubric and the
  reviewer's stance keep it.
- **A project or certification the model adds when none was offered is dropped**, not a failed draft (`oneOf` accepts any
  text when there is nothing to choose from).
- **A project bullet written as bare text is taken as its text** (`asObject` in `write.ts`). In the app, GLM-5.3 once
  wrote project bullets as strings instead of `{ "text": ... }`, and the draft was thrown away and written again (about 2
  minutes and $0.05). The schema shown in the prompt still asks for the object.
- **The copied-wording check lets the resume echo** a condition the user asked to mention and the wording of experience
  or a skill the candidate has ("5+ years of product design experience"); the company's own text, the responsibilities,
  fields and ways of working are still checked.
- **Verified** on the five cases with the new defaults (`--configs C`, step 1's matches): 5 of 5 written, $0.20 in all
  ($0.03 to $0.05 each), 59 to 109 seconds each, both mentions written, no failed calls.

### Sixth pass: the right material, proven claims, and the user's choices

A real resume for "Product Engineer (AI / Full-Stack)" (trace `2f99b5649d99128f4aaa9bf1f2a40e4b`, Oct 15) scored 66.5 of
100 with an outside reviewer, against 77.5 for a resume another agent wrote from the same career record. The gap was
mostly decided before the writer ran: it was given the wrong material. The plan and the reasoning are in
[generate-better-resume.md](generate-better-resume.md).

**Choosing the material (code):**
- **The angle of a title comes from its last word** (`guessAngle`, `src/lib/career/match.ts`): "Product Engineer" is an
  engineer, "Product Designer" a designer. Before, "product" matched first, so every role was written from its product
  telling ("Product Manager"), and the writer never saw the engineering wordings that carried the strongest results
  (45% activation, 80% fewer manual workflows, 3x traffic). This also fixes the angle guessed when a document is imported.
- **The telling of a role is chosen on evidence too** (`pickFraming`, `recommendFraming`): the job's angle, the closest
  title, and the share of the best telling's evidence (the weight of the requirements its facts answer plus the proof in
  its wordings).
- **Proof counts** (`proofStrength`, `proof.ts`): numbers, measured changes, result verbs and named tools. Facts are
  ranked by requirement weight plus proof, a role's two strongest facts are always offered, and of a fact's wordings the
  one with the result comes first.
- **The job's core** (`core` on a requirement): the match call names the 3 to 5 requirements the job is about. They
  weigh 8, a must-have that is a way of working weighs 2 (`requirementWeight`).
- **The writer's bullet order is kept.** Code used to sort a role's bullets by summed weight, which put a bullet citing
  two facts above the one that answered the job's first ask.
- **A claim names every technology it says** (`skillTerms`): "Rails and TypeScript experience" gives both, where only
  the longest name was kept and Rails was lost.
- **The company's values are never claims**: they set the tone and have no "I have this" toggle, and no longer count
  toward the match.
- The review gets 24,000 output tokens (it used 13,000 of 16,000 once).

**Writing and review (prompts):**
- **Prove every claim**: each thing the user says they have is written as work, in the role it fits, with that role's
  real product and tools and the user's note. A claim is never only in the skills lines, and never a label ("On realtime
  voice agents, built..."). A bullet that proves a claim may use the words of its role's other lines (`allowedWords`).
  Code flags a label (`labelIn`) and a claim no bullet shows (`unproven`).
- Result first where the candidate gives one; words that add tone and no evidence are cut; the first bullet of each
  recent role proves a `[Core]` requirement; project bullets do not repeat the technologies line.
- Summary of up to three sentences (title, strongest result, how the candidate works), up to 520 characters; bullets up
  to 320 characters.
- The rubric gains **proof** ("Proves what the job is about"), counted as material; the summary, voice and rhythm
  criteria were brought in line.

**The review screen (`choices`, `review_options` on `resume_generations`, migration `0024_review_choices`):**
- **Write each role as**: each recent role told more than one way, with the recommended telling chosen.
- **Your record says this more than one way** (`clashes.ts`): a fact whose wordings give different measured changes for
  the same thing (a share or a multiple; counts are left out, and a line that only adds a number is not a disagreement).
  The recommended one is what most of the fact's wordings say; on a tie, the chosen telling's. The picked wording leads
  and the ones with the other number are left out. On the real record this finds exactly two: activation 45% against
  18%, and API response time 66.7% against 150%.
- A chosen telling is kept for the same job; a settled number is kept for every job (`reviewChoices`, `acceptChoices`).
- **Core** items carry a badge and an open note field; **Add detail** puts a note on what the record already shows, and
  a note there makes it a claim the writer proves.
- **Where the job is** becomes a condition the user can ask to mention, with a note on how they meet it.

The resume written for the same job after this pass goes to the same outside reviewer; the result will be added here.

### Seventh pass: claims with and without detail, a fuller resume, and a writer that stops running out of room

**After Resume 4 (Oct 15).** The outside reviewer scored the next resume 69.0. Tracing it showed most of its new problems
came from the review and from rules added in the sixth pass:
- **A claim with no note** (ticked, nothing written) is `bare` on `PlanUser`. It goes to the skills section, or inside a
  bullet whose own lines show that work. It never gets a bullet of its own or a place in the summary, and never takes a
  fact's place (`bareClaimFindings`). `unproven` applies only to claims with a note. The review screen says so under a
  ticked item with no note.
- **The reviewer may not invent content.** Replacement wording comes from the bullet's own lines or the note of a claim
  it cites. A revised bullet that gains a tool or job term its sources do not have goes back to the draft
  (`addedNames`, `revertAddedNames`): "Claude Code" had been moved into a line about the product's own logging layer.
  The reviewer also sees the posting's responsibilities, the length limits, and that the project's technologies line is
  printed above its bullets.
- **The summary's lead result is chosen in code** (`summaryProof`): of the facts that state a measured result
  (`STRONG_PROOF`), the one that best answers the core, narrowed to its strongest clause (`strongestClause`), since a
  line joined by a semicolon holds two results. A summary sentence whose numbers come from two lines is flagged
  (`mergedResults`). A role that leaves out its strongest result while a bullet proves less is flagged
  (`droppedStrong`).
- **Intentionally fuller**, at the user's request: bullets that answer the core may run to 440 characters, the others
  about 260; the summary is up to four sentences (720 characters); the posting's own short phrases are used for the
  candidate's matching work. A project bullet loses a bracketed list of the project's own technologies
  (`withoutRepeatedStack`).

**Cost and failures (Oct 16).** In two days, 5 of 13 GLM-5.3 calls failed: three ran out of room thinking, two were
thrown away over format. They cost $0.60, more than the $0.55 of the calls that worked. A draft's thinking had grown with
each rule added: about 6,000 tokens, then 10,800, 16,900, 21,900, and finally past the 32,000 limit (trace
`969e0185f614dce7857a11cb58894c57`, $0.15 and no resume). The answer itself is about 1,500 tokens. Splitting the draft
into one call per section was considered and set aside for now: the page would lose its single view (repeats across
roles, claims placed in the weaker role). Instead:
- **The skills section is written by code** (`skills.ts`, `composeSkills`), so the writer no longer chooses and groups
  30 to 40 skills out of 80. The candidate's own categories are tidied:
  - a skill split mid-bracket ("LLM APIs (OpenAI") is left out;
  - a repeat, or a skill a longer one already says ("AWS" next to "AWS (EC2, S3, Lambda)"), is listed once;
  - "Frameworks" joins "Frameworks & Libraries";
  - a catch-all ("Skills", "Technologies") gives its skills to the categories they match, and keeps the rest, last;
  - a small category next to bigger ones keeps only the named tools the job asks for (so "Product & Media" is gone).

  Each line puts the job's skills first, then the candidate's own order, up to about 36 in all. Claims go next to the
  skills they are like. A product area ("Video streaming") is never a skill (`isNamed`). The review scores the section
  but cannot edit it.
- **The writer's rules are half as long**:
  - the system prompt went from about 9,500 to 4,500 characters;
  - overlapping rules were merged;
  - what code decides or checks is said once or not at all.

  The substance is kept: edit the candidate's words, result first, prove claims, the posting's language, a full
  summary.
- **A format slip no longer throws a draft away.** The answer schema is lenient:
  - ids are plain strings, and `readWriting` ignores ids that were never offered;
  - a bullet tied to nothing is dropped;
  - lists are cut to size;
  - a missing mention or list is not an error.

  A bullet or summary past its length is flagged (`tooLong`) for the revision to shorten.
- **A stuck call costs less, and is never repeated as it was:**
  - the draft gets 24,000 tokens, which covers every draft that has worked;
  - one that runs out is asked again at lower effort with 16,000;
  - a revision is asked once, and a failed one keeps the reviewed draft;
  - the revision runs only when the review asks for a material edit or a code check found something.
- **A stopped job is never retried**, and a stream ended by a stop reads "Stopped" in the trace, no longer "not valid
  JSON" (`chat.ts`).

On the real record the prompt is now about 4,500 characters of rules plus 19,800 of material. Of the material, 9,200 is
roles, 3,700 projects and 2,300 requirements. The skills section reads:
- **AI & Automation:** AI Agents, Claude Code, Codex, MCP and more
- **Frameworks & Libraries:** React.js, Rails, Next.js and more
- **Development Practices:** API Development, Agentic Coding and more
- **Programming Languages:** TypeScript/JavaScript, Python, SQL and more
- **Cloud & DevOps:** Terraform, Docker, Kubernetes and more
- **Technologies:** Slack, Mixpanel, LogRocket and more

The next regeneration of the Great Question job checks the targets:
- a draft's thinking under 15,000 tokens;
- a run under $0.10 and 3 minutes;
- no format failures.

If thinking stays above about 20,000, the next steps are a draft at medium effort, then one call per role.

**After the first run on this pass (Oct 16, trace `e75ef1e21673b31134088b8af2cf23a1`).**

| | Before | This run |
|---|---|---|
| Draft thinking | 20,000 | 12,600 tokens, 126 s, $0.069 (target met) |
| Format failures | | none |
| Review | | cut off at 24,000 tokens, its first failure; the revision ran on the code findings alone |
| Writing phase | about $0.18 | about $0.17, 5.3 minutes |
| Matching | | 98 s, 15,000 tokens of thinking |

What the run showed, and what changed:
- **The reviewer saw only two source lines per bullet.** For a project that is the description and one wording, so
  it took true lines ("customer validation plan", "50+ edge-case test suite") for invented. It said the lines were
  truncated, and thought itself out of room reconciling them. It now sees every line (`renderDraft`).
- **A review cut off is no longer lost.** It has 32,000 tokens, still at most $0.04 on DeepSeek. A reply cut at the
  limit keeps its scores and every edit it finished (`salvage` on `chatStructured`, `closeCutJson`, `salvageReview`).
  On this run's review that keeps all 11 scores and the two finished edits. GLM-5.3 as the reviewer was considered and
  set aside: it would review its own writing, cost about 4 times as much, run 2 to 3 times slower, and need its JSON
  asked for in the prompt.
- **The 3x traffic and 150% conversion result was left out.** A bullet chosen to carry "agentic search" took its
  place. Each role's strongest measured results, as many as it has bullets for (two at most), are now marked `[keep]`
  in the prompt (`PlanFact.keep`). `droppedStrong` checks each of them and aims at the weakest bullet that does not
  prove a claim with a note.
- **The summary copied bullet 1.** It was given the whole line as its proof. It now gets only the result clause
  (`resultClause`: "Increased user activation by 45% by owning the customer-facing onboarding redesign") and is told to
  say it in a clause of its own. A summary that shares nine or more words in a row with a bullet is flagged
  (`repeatedInSummary`). The 720-character limit is in the prompt, where it was only checked before.
- **Job terms kept their capitals mid-sentence** ("the Video streaming from desktop feature"). A term for an area of
  work is written in lowercase inside a sentence (`inSentenceCase`); names and acronyms keep theirs.
- **The revision was asked to prove "5+ years"** in a bullet. Claims about years are no longer `unproven` findings;
  the dates show them.
- **Matching runs in parallel** (`makeMatcher`):
  - one call per 6 open requirements, all shown the same record items as before;
  - alongside them, one call on the requirements alone (`read-requirements`) for what each is and which are the core.
  - Matching takes as long as the slowest call. A failed reading leaves the requirements as the posting gave them, with
    no core; a failed match still fails the match.

**A regression the lenient schema caused (Oct 16, trace `4ef61d5a6d04ece2f9fd8fb40250932d`).**

The run itself went well:
- matching took 18 s, in five calls at the same time, against 98 s before;
- the whole run took 4.3 minutes and $0.14, with no failures.

But the resume had no projects and no certifications. The writer had chosen three of each, then named them ("Job Search
OS", "AWS Certified AI Practitioner") instead of giving their ids. The strict schema used to refuse that. The lenient
one let it through, and `readWriting`, which looked them up by id only, dropped every one without a word. Now:
- a project, certification or role is found by its id, or else by its name (`offered`);
- a partial match needs the whole name, or two of its words;
- the schema lists the ids again for projects and certifications;
- a resume with no projects, when the record offers some, is flagged (`left-out`), so the revision puts them back.

Replayed through the fixed code, that run's answer gives all three projects and all three certifications.

**A draft that will always finish (Oct 17).** On the same prompt GLM-5.3's thinking varied from 12,600 to past 24,000
tokens. In trace `61a206fa3621c9bc0139e2ad7daf4695` the draft ran out of room at high effort, and again on its medium
retry: $0.19 and no resume. Now:
- **A cut-off draft is written again at low effort, never medium** (`FALLBACK_EFFORT`). At low effort GLM-5.3 barely
  thinks, so the draft is written, then reviewed and revised as usual.
- **It is marked a fallback** in three places:
  - the generation screen's draft step;
  - the resume's notes;
  - the call's span (`resume.fallback`, with `resume.attempt` on every draft call).
- **The output limits are settings**: `WRITER_MAX_TOKENS` 24,000, `WRITER_FALLBACK_MAX_TOKENS` 16,000 and
  `REVISE_MAX_TOKENS` 16,000. They count thinking and the answer together. The largest draft that worked used 22,908 of
  them, before the prompt was cut; since then, 13,900 and 17,300.
- **No separate early stop by token count was added**: it would be the output limit again. A 16,000 threshold would
  have stopped about half the drafts that worked.
- **A draft with structural gaps goes to the revision, not to failure** (`leftOut`):
  - an empty summary;
  - a role it left out (`fromRecord`, kept from the candidate's own lines meanwhile);
  - no projects when the record offers some.
- **Notes carry over.** A note on a requirement the record already shows ("Add detail") now carries over to the next
  run, as ticked items' notes always did.
- **The thinking of a cut-off call is saved to its trace** (see LLM-LOGGING.md), so the next runaway shows what it was
  stuck on. A check call confirmed Together streams GLM-5.3's thinking text. Asked for a bullet under 200 characters,
  it counted the characters in its thinking. That is one example, not yet the cause of the runaways.

**High against low effort (Oct 17).** Five drafts each on the 09:00 prompt, run in parallel, no revision:

| | High | Low |
|---|---|---|
| Finished | 4 of 5 (one cut off at 24,000) | 5 of 5 |
| Thinking | 12,400 to 23,000 tokens | 100 to 2,700 |
| Time per draft | 98 to 193 s | 12 to 30 s |
| Cost per draft | $0.07 to $0.11 | $0.014 to $0.025 |
| Review score (of 5) | 4.11 | 4.07 |
| Code findings per draft | 3.8 | 5.4 |
| Projects kept | 3 every time | 3, 3, 3, 2, 2 |

High stays the default (low is close on the score but not consistently: more findings, and it drops projects); low is
the fallback. The cut-off draft's saved thinking (89,000 characters) was not mostly counting characters, so the length
wording stays. It went round three demands the rules could not all meet: two noted claims that both belonged to one fact
against "two ids per bullet", a core requirement ("agentic coding harness daily") that only the skills list supported
against "never move a tool into a line about other work", and "cover what is listed" against 30 requirements for 10
bullets. It had finished planning ("Write JSON.") at 22,994 tokens of 24,000.

### Eighth pass: what an outside reviewer found, judged against our own standards

The 09:00 resume (rebuilt as version 7) lost to another agent's resume, about 60 to 69 on an outside reviewer's rubric.
The reviewer's findings, and what was taken:

| Finding | Taken? | What changed |
|---|---|---|
| Ways of working listed as keywords, not described | Yes | The summary's "how they work" sentence comes only from a note or a line of the candidate's that says it; with neither it is left out, never written generically (the reviewer's correction: a required line with no source turns into filler). |
| Claims with nothing behind them (Rails, MCP) | Half | The summary names only what the bullets show (`unbackedInSummary`). Terms no offered line mentions are sent as "IN THE SKILLS SECTION ONLY" and stay there; they are never cut from the skills section. |
| LLM features without a quality signal | Yes | `proofStrength` counts how the work was checked (tests, evals, accuracy, an approval step), so those lines rank up; the writer keeps that clause. |
| Strong material left out | Yes | The latest role had 5 of 12 bullets, so its nine facts were packed into catch-alls. Bullets now go to roles by how many facts each has that answer the job or state a strong result (`shareBullets`): 8, 4 and 2 for this record. The reviewer's correction: by relevance, not a fixed 8/3/2, which would break a candidate whose second job is the relevant one. Bullets are shorter (320 and 220 characters, from 440 and 260). A fact the core rests on is offered whatever telling it was worded for. A project's most proving wordings are offered, not its first three. |
| Catch-all bullets | Yes | "One story per bullet"; a line of the candidate's joining two pieces of work may give two bullets citing the same fact. Two measured results joined by a semicolon are flagged (`twoStories`); "packs several deliverables" is a reviewer criterion, since it is a judgement. |
| One feature across every layer | Follows | The RBAC admin panel fact now has room. |
| Echoing the posting | Yes | The summary no longer opens with the posting's title. |
| A link the job asks for; results, not plans | Yes, as a reviewer criterion | "A plan rather than a result" is semantic, so the reviewer judges it. All the record's project links are empty: only the user can add them. |
| Location left ambiguous | Yes | A condition the user answered goes in the header (`headerLocation`); unanswered, a header location that is only a way of working is left out (the reviewer's correction: a bare "Remote" beside a +91 number reads as evasive). |
| Seniority | Already done | |
| Placeholders in the resume | No | A generated resume must be ready to send; the review screen asks instead. |
| Cut unbacked terms from the skills section | No | The user's claims are theirs to make, and the skills section is a list by design. |
| Merge education, certifications and hackathons | No | The house layout stays. Certifications and achievements each go on one line instead. |
| Job Pilot and the eval harness | Not a writing gap | Neither is in the record (version 15). The review screen now asks about a job's term the record has only in its skills list ("Anything you have built with MCP?"), which is how such work gets in. |
| A pre-flight checklist pass | No | Its cheap items are code checks, its judgements reviewer criteria: no extra model call. |

**Certifications on one line, checked with text extractors.** Equal columns read as a table: pdftotext read down the
columns and put two achievements before their own heading. A divider drawn with `position: absolute` was painted last,
so unpdf (the app's own reader) put both rows after both headings. What reads in order in pdftotext (plain and layout),
unpdf and Word's text: inline items an even space apart with a " | " divider as real text, an item moving whole to the
next line when it does not fit. Tested in `documents-export.test.ts` with unpdf and mammoth.

**The draft limit** is 28,000 (`WRITER_MAX_TOKENS`), from 24,000: a cut-off costs about $0.02 more, and drafts that had
finished thinking are no longer cut before the answer.

**The first run of the eighth pass (Oct 17, trace `acdb5f21352d4b4407820f3c1b35a053`).** Louper got its 8 bullets, the
summary landed, and the outside reviewer scored it about 59. Three defects were ours:
- **An invented place in the header.** The note said "I can work remotely"; the writer's mention line said "In Canada; can
  work remotely" for a candidate in India, and it went in the header (the user corrected it by hand). The mention may
  now name nothing the note does not; otherwise it is the note itself without "I" (`headerMention`).
- **A cut-off duplicate in place of the MCP proof.** The user answered "MCP" on the review screen with a note on their
  MCP server, and the draft proved it in a Job Search OS bullet. Project bullets could not cite a claim, so code took
  "MCP" for a name the bullet added and put back the project's first wording, clipped at 600 characters ("profile...")
  and the same as the bullet above. Now a project bullet cites the claims it proves (and one that names a claim with a
  note is tied to it anyway); wordings are cut at a sentence end, never with "..."; a bullet goes back to the closest
  wording that repeats no other bullet, or is left out; and a bullet repeating another is dropped last
  (`withoutRepeats`).
- **Two projects dropped.** The writer kept only Job Search OS. Code chooses the projects, so each one left out is now a
  finding for the revision, and the prompt asks for all of them.

Also: a fact split into two stories may run up to two bullets past the role's count, so splits no longer push out
facts such as the RBAC panels; the stale note "The summary does not mention" is not given when the header carries it;
the reviewer rubric names a change of who built what. Two of the reviewer's points were not taken: "real-time
captioning" is what the record and the note say (the other resume's "built voice agents" overclaimed), and the
prototyping bullet's "eliminating spec ambiguity" is the candidate's own line in the record.
