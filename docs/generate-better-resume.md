# Better generated resumes: the sixth pass

## Context

Resume 3, written by our pipeline for "Product Engineer (AI / Full-Stack)" at Great Question, scored 66.5 of 100 against 77.5 for Resume 1, which another agent wrote from the same career record. Looking into the trace and the record (version 14) showed the gap was mostly decided **before** the writer saw anything:

- `guessAngle` ([src/lib/career/match.ts:94](../src/lib/career/match.ts#L94)) matches "product" before "engineer", so "Product **Engineer**" chose the Product version of every role. Louper became "Product Manager", and the writer only saw product wordings. The strongest results (45% activation, 8 minutes to 1, 80% fewer manual workflows, 3x traffic) are in the Engineering wordings: 8 of 9 for the activation fact. The one product wording says 18%.
- Facts and bullets are ranked by how many requirements they match, never by how strong their proof is. Code then re-sorts the writer's bullets (`readWriting`, [write.ts:379](../src/lib/resume-writer/write.ts#L379)), which pushed the Claude Code bullet to third place.
- Every must-have weighs 5, so "comfortable with ambiguity" counts as much as "strong across the full stack".
- Claims were listed but not proven: "Agentic search" appears only in the skills line, and "On realtime voice agents, built captioning..." puts the job's term in front as a label. Rails was lost (`skillTerm` keeps only the longest technology), and company values became "things the candidate has".
- The summary rule (two sentences) and the 420-character bullets left the summary thin and the bullets long.

**Guiding principle (from the user):** the user is always telling the truth. The writer's job is to *prove* each claim on the page in the most believable way: concrete work, in the role where it happened, with that role's real products, tools and numbers. A claim is never only listed or attached as a label. There are still no invented numbers, titles, employers or certifications (CLAUDE.md).

**Decisions made with the user:**
- **Role version:** chosen automatically. The review screen shows it for each role with a dropdown to change it.
- **Conflicting numbers:** asked on the review screen, with a recommended choice.
- **Order of work:** phased: selection, then prompts, then the review screen. An external reviewer scores the old and the new resume at the end.

Read `SKILL.md` before changing any prompt (memory: skill-md-writing-spec).

---

## How the result is judged

The focus is the fixes below. Evaluation is kept light:

- **Models stay as they are:** GLM-5.3 writes and revises, DeepSeek V4.1 Flash reviews. No model comparisons, no eval runs.
- **Before:** Resume 3, version 1 of the Great Question job's generated document (`87dcedf7`).
- **After:** once all three phases are in, regenerate that resume in the app. It becomes the next version of the same document, with the earlier review answers carried over (`carryOver`), so the inputs match.
- **Who judges:** the user gives both resumes to the same external reviewer, who scores them with their own metrics. Their report decides what to fix next.
- **Before handing it over:** I read the new resume against the gaps listed in Context:
  - engineering titles;
  - the 45%, 80% and 3x results;
  - claims proven in bullets;
  - Rails present;
  - no added numbers (code-check findings in the generation's notes).
  - If one of these clearly failed, I fix it and regenerate. At most two extra regenerations, about $0.15 each.

## Phase 1: Choosing the right material (code only, no prompt changes)

1. **Angle from the title's head noun:** in `guessAngle` ([src/lib/career/match.ts](../src/lib/career/match.ts)):
   - drop parentheses and anything after a comma or dash;
   - test `ANGLES` against the last word first ("Engineer", "Designer", "Manager"), then fall back to the whole title as now.
   - So "Product Engineer (AI / Full-Stack)" gives Engineering, "Product Designer" gives Design, and "Product Manager" still gives Product.
   - This also fixes the guessed angle when a record is imported (`proposal.ts:203`).
2. **Version by evidence:** `pickFraming` ([write.ts:94](../src/lib/resume-writer/write.ts#L94)) adds an evidence score to the angle and title score. The evidence score is the share of requirement weight answered by facts that have wordings in that version, plus the proof strength of those wordings (item 3).
   - It accepts an override, `choices.framings[roleId]`, which Phase 3 provides.
   - Export it as `recommendFraming(role, job, requirements)` so the review screen can show the recommended version.
3. **Rank by proof as well as relevance:** add a `proofStrength(text)` helper, using `numbersIn` and `namesIn` from [faithful.ts](../src/lib/resume-writer/faithful.ts). It counts numbers, percentages and multipliers, result verbs (increased, cut, reduced, raised, grew, doubled), and named tools and products.
   - In `planWriting`, rank facts by requirement weight plus proof strength, and always include the role's two strongest-proof facts.
   - Within a fact, order wordings by `fitScore` plus proof strength, so the wording that carries the result comes first.
4. **Requirement importance:** the match call ([match.ts](../src/lib/resume-writer/match.ts)) also returns `core`: the ids of the 3 to 5 requirements the job is really about. It goes in the same call, like `uses`.
   - Add `core?: boolean` to `Requirement` ([types.ts](../src/lib/resume-writer/types.ts)).
   - Add a `requirementWeight(r)` helper: a core requirement weighs 8, a must-have whose use is `trait` weighs 2, everything else keeps `REQUIREMENT_WEIGHT`.
   - Apply it in `matchRequirements` so `weight` is stored, and `matchScore` and the plan's `weightOf` follow.
   - Older rows without `core` keep their stored weights.
5. **Keep the writer's bullet order:** remove the relevance sort in `readWriting`. The prompt (Phase 2) and the reviewer's `relevance` criterion take over ordering.
6. **Every technology a claim names:** `skillTerm` returns all the job's technologies found in the text, longest first, so "Rails and TypeScript experience" gives `["Rails", "TypeScript"]`.
   - `PlanUser.skill` becomes `skills: string[]`.
   - The prompt line reads `u2: Rails, TypeScript`.
   - `readWriting` expands a `u` alias into each item, and `withoutCovered` plus `skillKey` drop the repeat "TypeScript".
   - Update `allowedWords` in faithful.ts to match.
7. **Company values are never claims:** the `users` filter in `planWriting` excludes `kind === "company"`, so values stay tone-only under THE COMPANY.
   - On the review screen ([requirement-review.tsx](../src/components/resume-writer/requirement-review.tsx)), "From the company" rows show no "I have this" toggle.
8. **Reviewer token room:** in [review.ts:234](../src/lib/resume-writer/review.ts#L234), raise `maxTokens` from 16,000 to 24,000. The trace used 13.2K.

Expected after this phase: engineering titles, the 45% / 80% / 3x results back on the page, Rails in the skills line, and no company values as claims.

## Phase 2: Writing and review (prompts)

In `SYSTEM` and `buildPrompt` in [write.ts](../src/lib/resume-writer/write.ts):

1. **Prove every claim.** Replace "work every one in" with this rule:
   - each item under THE CANDIDATE SAYS THEY HAVE THIS is shown as work done, in a bullet of the role it fits best;
   - the bullet uses that role's real product, tools and team from the record, plus the candidate's note when there is one;
   - a skill also goes in the skills line;
   - never as a label ("On realtime voice agents, ..."), and never with a number the candidate did not give.
   - In `allowedWords` and `revertRewrites` ([faithful.ts](../src/lib/resume-writer/faithful.ts)), a bullet that cites a `u` item may use words from all of its role's wordings, which is the context that makes it believable. It is never reverted (as now).
2. **Result first:** when the candidate's line states a result, lead with it by reordering their own clauses ("Increased user activation by 45% by ...").
3. **Cut tone, keep evidence:** words that add tone and no evidence may be cut ("ruthlessly", "spaghetti", "from first principles"). One idea per bullet.
4. **Mark the core requirements:** in WHAT THE JOB ASKS FOR, mark them `[Core]`, and add the rule "The first bullet of each recent role proves a core requirement."
5. **Summary in up to three sentences:**
   - who the candidate is, with the job's title as posted;
   - the strongest result in the record, in new words rather than copied from a bullet;
   - how the candidate works, from their lines or claims (for example, daily agentic coding).
   - `MAX_SUMMARY_CHARS` goes from 400 to 520. The mention line is unchanged.
6. **Length:** `DEFAULT_BULLET_CHARS` goes from 420 to 320. `SUPPORT_BULLET_CHARS` stays at 200.
7. **Projects:** "The project's technologies are printed above its bullets; do not list them again."

In `RUBRIC` and `SYSTEM` in [review.ts](../src/lib/resume-writer/review.ts):

8. Add a criterion `proof` ("Proves what the job is about"):
   - a 5 means each core requirement and each claim is shown by a concrete bullet that says where, with what, and what happened;
   - a 1 means claims appear only in the skills line or as labels.
   - Add it to `HARD_CRITERIA` in [writer.ts](../src/lib/resume-writer/writer.ts).
9. Update `summary` to three sentences. Rewrite `voice` cleanly (it currently has a stray "and also follows the XYZ framework"). Add "result first where the candidate states one" to `rhythm`.

Expected after this phase: claims proven in bullets, a three-sentence summary with the strongest result, shorter result-first bullets, and no rise in code-check findings.

## Phase 3: The review screen

**Data:** add a `choices` jsonb column to `resume_generations`: `{ framings: Record<roleId, framingId>, wordings: Record<factId, wordingId> }`. Generate migration 0024 with `drizzle-kit generate`, and add it to `GenerationItem`.

1. **Role versions:**
   - `runMatching` ([process.ts](../src/lib/resume-writer/process.ts)) stores each recent role's options and the recommended version (`recommendFraming`).
   - The review screen gets a "Write each role as" section above the requirements: one `NativeSelect` per role with more than one version, with the recommended one labelled "(recommended)" and its reason ("proves the most of what this job asks for").
   - The choice is saved with `saveReview` ([service.ts](../src/lib/resume-writer/service.ts)) and used by `planWriting`.
2. **Conflicting numbers:** a new module, `src/lib/resume-writer/clashes.ts`.
   - `findClashes(record, roleIds)` looks at all wordings of each fact on the chosen roles. It pairs each number with its measure (the nearest content word, such as "activation" or "query"). A clash is the same measure with different numbers.
   - **Recommendation:** the number most of the user's wordings and documents agree on (for example, 45% in 8 of 9). On a tie, prefer the chosen version's wording, then the most recent source.
   - The review screen shows "Your record says this two ways": a radio list of the two sentences, with the numbers highlighted and the recommended one marked with its reason.
   - The answer goes to `choices.wordings[factId]`. `planWriting` puts that wording first and drops wordings that state the other number.
   - Choices carry over to later generations for any job, from the latest finished generation, since record ids are stable (extend `carryOver`).
3. **Notes that make claims believable:**
   - Core requirements show a "Core" badge.
   - For a core requirement the note field is always open: "One line on how you do this makes the resume more believable."
   - Notes are allowed on "In your record" items too. A note on any requirement turns it into a `u` item, so the writer proves it.
4. **Job location as a condition:** when the job has a location ("Canada, Remote"), `buildRequirements` ([context.ts](../src/lib/resume-writer/context.ts)) adds it as a logistics requirement. The user can then tick "Mention it", for example work status or relocation. It is never shown unless ticked.

Follow the motion system and the page layout rules (memory: ux-motion-consistency). Lucide icons only, no symbol characters.

Then regenerate the Great Question resume through the review screen: accept the recommended role versions, pick 45% for the clash, and add a one-line note on daily agentic coding. The resulting version is the "after" resume for the external reviewer.

---

## Docs

- [docs/generate-resume.md](generate-resume.md): add a "Sixth pass" section: what changed and why (this trace), and later the external reviewer's verdict.
- `docs/PRODUCT.md` (memory: product-doc-tracker): the new review-screen parts (role versions, conflicting numbers, Core notes, location condition).

## Verification

- `npm run typecheck`, `npm run lint`, `npm test`. Tests inject the model; the DB tests run on `jobtracker_test`.
  - [tests/career-match.test.ts](../tests/career-match.test.ts): `guessAngle` for "Product Engineer (AI / Full-Stack)", "Product Designer", "Product Manager", "Senior Software Engineer".
  - [tests/resume-writer-write.test.ts](../tests/resume-writer-write.test.ts): `pickFraming` and `recommendFraming` by evidence; `proofStrength` ranking; `skillTerm` giving Rails and TypeScript; company values excluded from `users`; `readWriting` keeping the model's order; the prompt marking `[Core]`.
  - [tests/resume-writer-match.test.ts](../tests/resume-writer-match.test.ts): `core` read from the answer, and weights applied.
  - New `tests/resume-writer-clashes.test.ts`: 18% vs 45% is found and the recommendation follows the majority; a wording that only leaves a number out is not a clash.
  - [tests/resume-writer-review.test.ts](../tests/resume-writer-review.test.ts): the rubric includes `proof`.
  - [tests/resume-writer-generation.test.ts](../tests/resume-writer-generation.test.ts): `choices` are saved by `saveReview`, applied by the writer, and carried over.
- **Final:** one regeneration of the Great Question resume after Phase 3 (see "How the result is judged"). Both versions go to the external reviewer.
- **Browser check** on the test DB (memory: browser-checks-test-db): seed a synthetic record with two role versions and a number clash, then walk through:
  - the review screen: version dropdowns, the clash choice, Core notes, the location condition;
  - writing;
  - the editor: confirm the titles, the chosen number and the proven claims.
  - Then `select action, step from llm_calls` should show no `unknown`. Stop the dev server before `npm test`.
- Also update [docs/generate-better-resume.md](generate-better-resume.md), the user's copy of an earlier draft of this plan, to match.
