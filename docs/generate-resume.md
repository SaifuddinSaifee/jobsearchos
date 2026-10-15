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
