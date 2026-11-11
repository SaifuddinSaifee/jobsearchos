# How we evaluated the resume writer

October 15, 2026. How we chose the models that write and review resumes, and what we changed because of it.

## 1. The question

The writer was GLM-5.3 at max reasoning effort, with Kimi K3 reviewing. A resume cost about $0.22 and took 7 to 8
minutes, against a goal of 2 to 3 minutes. The question was whether cheaper or faster models write resumes that are just
as good.

## 2. The pipeline under test

```
Job + career record
  -> match: what the job asks for, against the record      (GLM-5.3 Flash)
  -> review screen: the user ticks what they have
  -> draft: edits the user's own record lines               (writer)
  -> code checks: faithfulness, copying, stuffing
  -> review: scores 10 criteria, lists edits                (reviewer)
  -> revise: makes the edits                                (writer)
  -> safety: puts back any bullet rewritten beyond recognition
```

## 3. What we built to measure it

| Piece | What it does | Where |
| --- | --- | --- |
| Per-call logging | Every model call records step, model, input, cached, output and reasoning tokens, latency, retry count, retry wait and cost | `llm_calls` table; retries counted in `src/lib/llm/attempts.ts` |
| Per-resume time | Each generation records `work_ms`: matching plus writing, without the user's review pause | `resume_generations` table |
| Eval harness | Runs test cases through named setups and reports on every run | `npm run eval:writer`, `scripts/eval-resume-writer.ts` |
| Test cases | 5 synthetic candidates, each with a job | `scripts/eval-resume-writer/cases.ts` |
| Writer options | Model, effort, reviewer, fallback reviewer and revision mode, all injectable; the app passes none | `WriterConfig` in `src/lib/resume-writer/writer.ts` |

**Token accounting:** reasoning tokens are part of the output count, so they are not added to the cost again. Checked
on live calls: GLM-5.3 Flash's output of 783 tokens was 728 reasoning plus about 55 visible.

## 4. The test cases

| Case | Candidate | Job | What it tests |
| --- | --- | --- | --- |
| backend-storytelling | Backend engineer whose role is also recorded as product work | Software engineer, storytelling app | Picking the right telling of a role; relocation mention; interests line |
| pm-b2b-saas | Product manager with many numbers | Senior PM, workflow software | Keeping numbers and names |
| ml-health-imaging | Data scientist with research work | ML engineer, medical imaging | Skills the job asks for that the record doesn't show |
| designer-marketplace | Product designer | Senior designer, marketplace | Mentioning a hybrid-office condition |
| teacher-to-instructional-design | Teacher | Instructional designer | A career switch with little direct overlap |

## 5. How a run is judged

**Fairness**
- **Same input for every setup:** each case is matched once and ticked the same way, so only the writer and reviewer change.
- **Fallback:** if a reviewer fails after its retries, GLM-5.3 reviews instead and the run is flagged. It never happened.

**Measures**

| Measure | Source | Trust |
| --- | --- | --- |
| Cost, time, tokens by stage, retries | Usage rows, read back by run id | Exact |
| Finished or failed | Writer result | Exact |
| Code checks on the draft and on the final resume | The same code for every setup: new numbers, added results, dropped names, rewrites, copied posting wording, overused terms, missing mentions | Objective; the fairest quality measure |
| Reviewer score, 10 criteria from 1 to 5 | The reviewer model | Not comparable across reviewers (Kimi against DeepSeek); also moved about 0.2 between identical runs |
| Disagreement flag | Reviewer against code checks | Shows when the reviewer misses or invents problems |
| Blind read | Final resumes saved as `blind/<case>/resume-<random>.md`; `key.json` holds the mapping | The real quality verdict |

## 6. Step 1: model swaps

| Setup | Writer | Reviewer | Finished | Mean cost | Mean time | Final resumes with a check problem |
| --- | --- | --- | --- | --- | --- | --- |
| A (then the default) | GLM-5.3, max | Kimi K3 | 5/5 | $0.25 | 8.0 min | 3/5 |
| B | GLM-5.3, max | DeepSeek V4.1 Flash | 4/5 | $0.26 | 10.4 min | 2/4 |
| **C** | **GLM-5.3, high** | **DeepSeek V4.1 Flash** | **5/5** | **$0.06** | **2.3 min** | **2/5** |
| D | GLM-5.3 Flash, max | DeepSeek V4.1 Flash | 4/5 | $0.03 | 7.7 min | 1/4 |

**Findings**
- **Max effort was the problem.** GLM-5.3 at max reasoned for 12,000 to 32,000 tokens a draft, and 6 calls hit the
  32,000-token limit, all of it reasoning. Cut-off drafts are paid for and then retried, which is why B cost more than A.
- **Kimi K3** was about 45% of A's cost and took about 3 minutes a review. DeepSeek took 15 to 25 seconds.
- **No setup invented content.** No final resume had a new number, an added result or a full rewrite.
- **One problem every setup shared:** the designer's hybrid-office mention was missed in all runs. That was a prompt
  problem, not a model one.

## 7. Step 2: always revise against targeted revision (setup C)

The targeted mode skips the revision when the checks pass and the reviewer asks for nothing material. Otherwise it
rewrites only the flagged parts.

| Mode | Mean cost | Mean time | Final resumes with a check problem |
| --- | --- | --- | --- |
| Always revise | $0.037 | 80 s | 3/5 |
| Targeted | $0.032 | 73 s | 1/5 |

**Finding:** the skip never triggered, because the reviewer said "revise" on all 30 drafts. On C the revision is
already cheap, so targeted saves about 6 seconds and $0.004. We kept always-revise.

## 8. Decision and changes

**New defaults:** GLM-5.3 at high effort writes, and DeepSeek V4.1 Flash reviews.

**Fixes**

| Change | Why |
| --- | --- |
| A call cut off at the token limit is retried at one effort level lower | The same request runs out of room the same way again |
| The condition to mention has its own required `mention` field, which code adds to the end of the summary | The "two sentences at most" summary crowded it out |
| A project or certification the model adds when none was offered is dropped | Before, it failed the whole draft |
| A project bullet written as plain text is accepted | It happened in the real app and cost a retry |
| The copied-wording check allows echoing a ticked condition and requirements the candidate has | False alarms; matching the posting's phrasing helps keyword screening |

**Verified:** all 5 cases written on the new defaults, $0.03 to $0.05 and 59 to 109 seconds each, with both mentions
present. 1103 tests pass.

## 9. Limits and next steps

- **One run per setup per case.** C's mean moved from $0.059 and 138 s to $0.037 and 80 s between runs, so treat
  smaller differences as noise.
- **Synthetic records are small and clean.** In the app, your real record gave about 5,600 input tokens, against about
  2,300 for the test cases. Next step: add your real career record and the Y/n job as a sixth case.
- **The blind read by a person is still pending.**
- **The reviewer always says "revise".** A stricter verdict would let the revision be skipped when it isn't needed.

## 10. How to rerun

```
npm run eval:writer                                   # all setups, all cases
npm run eval:writer -- --configs C --revision both    # one setup, both revision modes
npm run eval:writer -- --configs A,C --matches eval-runs/resume-writer/step1   # reuse a match
```

Results go to `eval-runs/resume-writer/<time>/`, which git ignores: `report.md`, `runs.json`, `blind/` and `key.json`.
Usage records go to the test database unless you pass `--dev-db`.
