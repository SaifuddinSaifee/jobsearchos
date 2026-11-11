# Career record compaction: implementation plan

Oct 28, 2026 · @MuSaif

## Goal and decisions

Each fact in the career record becomes one short statement plus its details, so the record shrinks to roughly a third of its size and stops growing with every document added. Today's export is 59 KB, about 15k tokens.

Decisions already made:

| Decision | What it means |
| --- | --- |
| One statement per fact, plus details | A fact holds a merged statement, the numbers, tools, people and specifics it mentions, at most one wording per angle and form, and pointers to the documents it came from. |
| Relax word for word for statements only | The model writes the statement. Code checks every number and named tool in it against the fact's sources, and the user approves it in review. Details stay exact phrases from documents; wordings stay word for word. |
| DeepSeek V4.1 Flash for the new steps | Model `deepseek-ai/deepseek-v4.1-flash` on Together: $0.30 per million input tokens, $0.006 cached, $1.20 output. |
| Prompt caching, no RAG | The compacted record goes first in every prompt that uses it, byte for byte the same across calls, so repeat calls pay the cached price. No embeddings. |

## The problem today

More than half the record is copies: in the version 15 export, 57% of the bytes are "Also worded" lines.

| What | Measured in the export | Cause in code |
| --- | --- | --- |
| Repeated wordings | 101 "Also worded" lines under 95 points; several facts carry 9 to 12, some differing by one word or a full stop | `classifyBullet` in `src/lib/career/dedupe.ts` adds any new text under a known fact as a new wording, kept whole |
| Feedback loop | Generated resumes added back to the record reword facts already there | A generated resume is a document like any other, so each one adds a wording to every fact it touched |
| Projects never grouped | Gather.io has 14 flat bullets, about 6 the same sentence | `ProjectSchema` has `wordings` but no facts, so nothing groups them |
| Same work split into facts | Psylief: user interviews in two facts, the feedback pipeline in three | The grouper in `group.ts` is told "when in doubt, answer new", and nothing revisits old facts |
| Skills lines stored as facts | 6 "Technologies:" lines across roles | Only the resume writer skips them (`isSkillsLine` in `write.ts` and `clashes.ts`) |
| Older duplicates | Education 3 times over, certifications twice, skills such as "LLM APIs" twice in one category | Merged before `sameEducation`, `certKey` and `skillKey` existed; nothing cleans old data |
| Numbers that disagree | API speed-up as 66.7%, 150% and 3x; query time as 33% to 50% and 66.7% | Clashes are only asked about during generation (`findClashes`), never settled in the record |

The app's own calls already trim what they send: 3 wordings per fact, at most 60 facts per role, 6 items per requirement. The size problem shows up when the whole record is used: the Markdown export, review screens, and any outside tool given the record.

## New fact shape

A fact keeps one statement, a list of details, at most one wording per slot, and pointers to every source. This is record schema version 2 in `src/lib/career/schema.ts`.

```ts
export const DETAIL_KINDS = ["metric", "tool", "team", "specific"] as const;

/** One thing a fact says, as an exact phrase from one of its sources: "80%", "LangChain", "Sales, CS and Marketing". */
export const DetailSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(DETAIL_KINDS),
  text: z.string().min(1),
  /** What a metric measures ("manual workflows", "API response time"), so two values for one measure can be found. */
  measures: z.string(),
  ...Tracked,
});

export const FactSchema = z.object({
  id: z.string().min(1),
  /** The merged one-line statement. Written by the model, checked against the details, approved by the user. */
  statement: z.string(),
  details: z.array(DetailSchema),
  /** At most one per (framingId, form): an engineering bullet, a product bullet, a story. Word for word from a document. */
  wordings: z.array(WordingSchema),
  /** Every document that told this fact. Text is not copied: the document stays in the library. */
  sources: z.array(SourceRefSchema),
  /** hash8 of normalizeText of every wording ever folded in, so the same text coming back is known without a model call. */
  seen: z.array(z.string()),
  provenance: ProvenanceSchema,
});
```

Other changes:

- **Projects get facts.** `ProjectSchema.wordings` becomes `facts: Fact[]`, so project bullets are grouped like role bullets.
- **Roles get `technologies: string[]`.** "Technologies:" lines go there, and each name also goes to skills, instead of being stored as a fact.
- **Statement edits count as the user's.** `provenance.user` gains `"statement"`, so a later merge proposes a new statement instead of overwriting it.
- **Version 1 records still read.** Each version row already stores `recordSchema`. `upgradeRecord` in a new `src/lib/career/upgrade.ts` turns a version 1 record into version 2 when it is read. The statement becomes the first wording, details start empty, and sources become the union of the wordings' sources. Old versions can still be restored.

## Merging a new document

A point that matches an existing fact only changes the record if it adds a detail the fact lacks. Otherwise only its source pointer is kept. Placement stays as it is; three steps are added after it in `processProposal` (`src/lib/career/queue.ts`).

1. **Read and place (unchanged).** `buildProposal`, then `classifyBullet` for exact, near and same-block matches, then the `group-bullets` model step for what is left. Project bullets now go through the same placement. "Technologies:" lines are routed to the role's `technologies` first.
2. **Read the details (new step `extract-details`).** One call per role sends the new points and the fact each was placed under. It asks for the metrics, tools, teams and specifics each point states, as exact phrases. Code drops any phrase that is not a substring of its point, the same rule as `assertTextFromSource`. Code then compares the rest with the fact's details (`normalizeText`, and `skillKey` for tools).
3. **Decide, in code.**
   - Adds nothing: the point becomes `known` and only a source pointer is added. Generated resumes almost always end here. `isNothingNew` then dismisses the whole proposal without asking, as it does today for exact repeats.
   - Adds details: the details join the fact. The point replaces the wording in its slot only if it carries more of the fact's details than the current one.
   - A metric for something the fact already measures with a different value ("API response time" 66.7% vs 150%) is not merged. It becomes a question in the review.
   - New fact: its details are read the same way and it gets a statement in step 4.
4. **Write statements (new step `write-statement`).** One call per proposal covers every fact that is new or gained details. Each fact sends its details, its current statement and its wordings, and gets back one statement of at most 300 characters.
5. **Check statements, in code (`checkStatement` in a new `src/lib/career/statement.ts`).** Every number in the statement (`numbersIn`) must be a metric detail of the fact. Every tool or product name (`namesIn`) must be a detail or appear in a wording. A failing statement is retried once with the findings. If it fails again, the old statement stays and the review flags the fact.
6. **Review.** For each fact the review shows the details added, the statement before and after, and any replaced wording. A statement the user edited is marked as theirs, so later merges propose a new one beside it instead of replacing it.

&#91;embedded content: merge flow for one new point · 1 decision, 3 outcomes\]

Most points from generated resumes take the middle path down: the record keeps a pointer to the document and no new text.

The proposal schema (`proposal-schema.ts`) gains a `facts` list carrying, per fact, the details added, the statement before and after, the check result, and any open question.

## One-time compaction of the current record

The existing record is compacted once, through a review like a merge, and saved as a new version that can be restored. Done means the Markdown export of version 15 comes out under 20 KB with every metric still in it.

Compaction runs as a queued job, action `compact-record`, started from a "Tidy the record" button on the career page. Its result is stored in a new `career_compactions` table: status, base version, proposed record, and the list of changes. Applying it saves a version with a new reason, `compact`, added to `RECORD_VERSION_REASONS`.

1. **Clean up, in code, no model.**
   - Skills: merge by `skillKey` across categories, keeping the first category.
   - Education: merge by `sameEducation`, keeping the entry with the most filled in.
   - Certifications: merge by `certKey`.
   - Lines starting "Technologies:": move to the role's `technologies`.
   - Wordings that differ only in case, punctuation or a full stop: collapse into one.
2. **Join facts that are the same work (new step `cluster-facts`).** One call per role, and one per project, sends each fact's first wording, clipped to 300 characters. It returns groups of fact aliases only, the same schema trick as `group.ts`, so the model cannot return text. This joins the split Psylief facts and the 6 Gather.io copies.
3. **Read details.** `extract-details` over every wording of each joined fact, then removal of repeated details.
4. **Fill the slots.** For each (framing, form) slot, keep the wording that carries the most details. The other wordings' text is dropped. Their sources go to `fact.sources` and their hashes to `fact.seen`, so they come back as `known`.
5. **Write and check statements.** `write-statement` and `checkStatement`, the same steps as a merge.
6. **Ask about conflicts.** Each metric measured with two values becomes one question ("API response time: 66.7%, 150% or 3x?"). The answer keeps one value and removes the others with a tombstone.
7. **Review and apply.** Per role, the review shows the fact count before and after, which facts were joined, each statement and the open questions. The user can accept all, or open a fact and change it.

A fact that mixes two pieces of work, such as the Louper story that also covers the one-click release, is split by hand with the existing `moveWording` edit (`toFactId: null`). Compaction does not split facts.

## Model, prompt caching and logging

Every career step runs on DeepSeek V4.1 Flash, with the compacted record as a fixed prefix, so after the first call of a run the record costs $0.006 per million tokens instead of $0.30. A whole compaction should cost about 2 cents, most of it output.

| Step | New or changed | Used in | Action |
| --- | --- | --- | --- |
| `extract-details` | New | Merge, compaction | `read-career-source`, `compact-record` |
| `write-statement` | New | Merge, compaction | `read-career-source`, `compact-record` |
| `cluster-facts` | New | Compaction | `compact-record` |
| `group-bullets` | Moves to the new model | Merge | `read-career-source`, `regroup-role` |
| `classify-cover-paragraphs` | Moves to the new model | Merge | `read-career-source` |

**Model.** A new `RECORD_MODEL` in `src/lib/env.ts`, defaulting to `deepseek-ai/DeepSeek-V4.1-Flash`. Its price is already in `prices.ts`. All five steps use it, because a cache is per model and the steps of one run should share it.

**Prompt layout for caching.**

- A new `recordForPrompt(record)` in `src/lib/career/prompt.ts` writes the compacted record as Markdown: statements and details only, no wordings, ids as short aliases. It is deterministic, with stable ordering and no dates or version line, so the same version always gives the same bytes. It is about 5k tokens.
- `chatStructured` and `chatCompletion` gain a `prefix` option, sent as the first system message ahead of the step's own instructions and JSON schema. Today the schema is appended to the system message (`structured.ts`), which would put text that differs per step ahead of the record and break the shared prefix.
- Each career step passes `prefix: recordForPrompt(current.record)` and puts only its question (one role's new points, one fact's details) in the user message.
- The resume writer keeps choosing facts in code (`planWriting`) and is not changed by this plan.

**Check that caching works.** `cached_tokens` is already recorded per call (`chat.ts` reads `prompt_tokens_details.cached_tokens`). After the first compaction run, the second and later calls of the run should show `cached_tokens` close to the prefix size:

```sql
select step, prompt_tokens, cached_tokens, cost_usd from llm_calls where action = 'compact-record' order by created_at;
```

If Together does not cache this model, the plan still works and costs about 6 cents per compaction instead.

**Logging, per AGENTS.md.**

- The three new steps go in `LLM_STEPS` (`src/lib/llm/names.ts`) and `STEP_LABELS` (`src/lib/usage/labels.ts`).
- `compact-record` goes in `LLM_ACTIONS` and `ACTION_LABELS`. `LlmIds` gains `compactionId`, with a matching `compaction_id` column on `llm_calls`. The compaction job runs inside `withLlmContext("compact-record", { compactionId }, fn)`.
- No prompt or reply text goes into our database. Phoenix gets the traces.
- `docs/LLM-LOGGING.md` gets the `prefix` option and the caching check.

## Downstream changes

The resume writer, the editor UI, the export and the project rules all read wordings today, and each needs a small change to read statements and details.

| Area | Files | Change |
| --- | --- | --- |
| Resume writer | `resume-writer/write.ts`, `context.ts`, `match.ts`, `clashes.ts` | `planWriting` offers the fact's statement as a text beside its slot wordings, used when no wording fits the chosen framing. `indexSource` indexes the statement and details instead of the first 3 wordings, so matching sees every tool and number in fewer bytes. `findClashes` skips facts whose conflicts were settled. `GenerationChoices.wordings` stays for the rest. |
| Hand edits | `career/edit-schema.ts`, `edit.ts` | New ops: `editStatement`, `addDetail`, `deleteDetail`, `answerConflict`. `"detail"` joins `REMOVED_KINDS`, so a deleted detail is proposed as left out when it comes back. |
| Record and review screens | `components/career/record-view.tsx`, `record-browser.tsx`, `record-lists.tsx`, `review-employer.tsx`, `proposal-review.tsx`, `documents/editor/record-panel.tsx` | A fact card shows the statement first, details as chips grouped by kind, slot wordings folded under "Tellings", and a source count. Review shows statement before and after, details added, and conflict questions. Uses the shared motion system for hover, press, loading and transitions. |
| Export | `career/markdown.ts`, `app/api/career/export/route.ts` | The default export writes statement, details and slot wordings. A second option, "Export for AI", returns `recordForPrompt`, for pasting into another tool. |
| Project rules | `CLAUDE.md`, `AGENTS.md` | The "applies to writing, not to the record" bullet becomes: record text stays word for word from documents, except fact statements. The model writes those from the fact's details, code checks them, and the user approves them. |
| Docs | `docs/PRODUCT.md`, `docs/LLM-LOGGING.md` | Describe the new fact shape, compaction and the `prefix` option. |

## Build order, tests and open questions

Build in eight steps, each one leaving the app working. Pure code comes before model steps, so most of it is tested without a model.

1. **Schema version 2.** New fact shape, `upgradeRecord`, `RECORD_SCHEMA_VERSION = 2`. Every reader compiles against it.
2. **LLM layer.** The `prefix` option, `RECORD_MODEL`, new steps and action with their labels, and `compactionId` with its `llm_calls` migration.
3. **Pure pieces.** Comparing details, filling slots, `checkStatement`, `recordForPrompt`.
4. **Model steps.** `extract-details`, `write-statement`, `cluster-facts`, each with an injectable `chat` like `makeGrouper`.
5. **Merge flow.** The proposal schema's `facts`, the new steps in `processProposal`, `isNothingNew` reading seen hashes and details.
6. **Compaction.** The `career_compactions` table and migration, the queued job, the review screen, and the `compact` version reason.
7. **Downstream.** Resume writer, hand edits, record screens, export.
8. **Real run.** Compact the record on the dev database, check the size and `cached_tokens`, then update `CLAUDE.md`, `AGENTS.md` and the docs.

Tests use Vitest with `@/lib/llm/openai` (`chatClient`) mocked and synthetic records, never the real one:

- [ ] `upgradeRecord`: every version 1 wording's source ends up in `fact.sources` and its hash in `fact.seen`.
- [ ] `recordForPrompt`: the same record gives the same bytes twice, and a synthetic 95-point record comes out under 6k tokens.
- [ ] `checkStatement`: rejects a number missing from the details, and a tool missing from the details and wordings.
- [ ] Merge: a resume reworded from the record's own facts is dismissed by `isNothingNew`. Points whose hash is in `seen` cost no model call.
- [ ] Compaction keeps every metric: every number in the version 1 wordings is a detail of some fact afterwards.
- [ ] `chatStructured` with `prefix`: the prefix is the first message, ahead of the step's instructions and schema.
- [ ] Browser check on `jobtracker_test` with a seeded record: tidy, review, apply, restore.

Open questions:

- **Slot rule.** This plan keeps the wording with the most details in each slot. Keeping the newest instead would favour recent rewrites.
- **Statement length.** 300 characters is a guess; resume bullets here run up to 320.
- **Resume writer later.** With caching, sending the whole compacted record as the writer's prefix costs little. It is left out to keep this plan to the record.
- **Caching on Together.** A cache price is listed for DeepSeek V4.1 Flash, but caching is unconfirmed until the first run shows `cached_tokens`.
