Written for: you, as the basis for deciding what to change in the resume pipeline next.

# What Resume 3's gap actually was, and what we learn from it

## Bottom line

The report blames the writing in Resume 3, but most of the 11-point gap was decided before the writer saw anything. Our pipeline picked the wrong version of the candidate's career for this job.

**The cause:** `guessAngle` in [match.ts:94](src/lib/career/match.ts#L94) checks job titles for "product" before "engineer". So "Product Engineer (AI / Full-Stack)" was treated as a Product job, and every role used its product-framed version (the record's per-angle variant of a role):
- Louper became "Product Manager" instead of "Fullstack Software Developer".
- Psylief became "Associate Product Developer" instead of "Backend Developer Intern".
- Siglens became "Associate Product Management Intern" instead of "Developer Relation and SWE Intern".

The writer may only use wordings that belong to the chosen version. So it never saw most of the evidence Resume 1 used, even though all of it is in the record (version 14):

| What the report says Resume 3 "dropped" | Wordings in the record, by version | What the writer was given |
|---|---|---|
| 45% activation, 8 minutes to 1 | 8 Engineering, 1 Product Manager | The PM wording, which says **18%** |
| 3x traffic, 150% conversion | 10 Engineering, 1 Product Manager | The PM wording: "doubling organic traffic, churn down 33%" |
| 80% fewer manual workflows | 7 Engineering, 1 Product Manager | The PM wording, which has no 80% |
| API 66.7%, query 33 to 50% (Psylief) | Engineering only | The PM wording "query 66.7% and API 3x", which counts one result twice |

Resume 1 drew on the same record. The title, the missing numbers and the "PM who codes" impression in the report are mostly this one wrong choice, not weak writing. My rough estimate is that 7 to 8 of the 11 points trace to it: ownership, full-stack depth, LLM features and part of clarity.

## The other causes, ranked

**1. Facts are chosen for how many requirements they match, not how strong the proof is.**
- A fact's weight is the sum of the requirement weights it matches. A bullet with a big result scores no higher than one that names the right keywords.
- After writing, code re-sorts bullets by the same sum. This is the issue from the trace, and it pushed the Claude Code bullet down to third.
- Result: Louper's five bullets held almost no outcomes, while the record had five strong ones.

**2. All requirements count about the same.**
- The job produced 26 requirements, 11 of them must-haves at weight 5.
- "Comfortable with ambiguity" counts as much as "strong across the full stack".
- The report scored 9 criteria with very different weights: full-stack 20%, ownership 15%, AI workflow 15%. Ours flattens the job's real priorities.

**3. "Editor, not writer" keeps the candidate's wording, including its problems.**
- The prompt says to start from the candidate's line word for word. So Resume 3 kept "ruthlessly", "spaghetti", "from first principles", 50-word sentences and activity-first openings.
- The rule protects the candidate's voice and facts, which is right. But it doesn't allow the one edit that matters most: moving the result to the front. Reordering the candidate's own clauses adds nothing new, so it is safe.

**4. Some proof is missing from the record, and no prompt can fix that.**
- Not in the record: the eval harness with its cost and latency results, the 1,100+ tests, Job Pilot (the MCP project), Cursor, and a description of the harness setup.
- Resume 1's author got them elsewhere; their own notes say "from your Oct 15 eval write-up".
- This explains most of the AI-workflow gap (3.0 points). The job's central requirement, an agentic coding harness used daily, had only one asserted line to draw on.

**5. Job terms were forced in where they didn't fit.**
- "On realtime voice agents, built real-time captioning..." is the term attached to work that was really captioning.
- "Agentic search" and "MCP" went into the skills lines with nothing in the body behind them.
- Rails was dropped by the `skillTerm` bug from the trace.

**6. The summary rule is too tight.**
- "Two sentences, one proof point" gave a summary that repeats bullet b4's numbers and says nothing about how the candidate works with AI.

## Advice in the report: take, adapt, discard

| Advice | Verdict | Why |
|---|---|---|
| Use the engineering title | **Take, as a fix to how we choose the version** | We already store the engineering version. Don't use the report's "Product Manager (hands-on...)" title |
| List every quantified win; never drop one by accident | **Take** | This is cause 1: choose facts for proof strength as well as relevance |
| Reconcile conflicting numbers | **Take, as a flag for the user** | The conflicts are in the record (18% vs 45%, 66.7% query vs 66.7% API). The record stays word for word, so we show the conflict and let the user choose |
| Result, then what was built, then the decision | **Take** | Within our rules, by reordering the candidate's own clauses |
| Summary of three sentences: who, signature result, how they work with AI | **Take** | The signature result should be the strongest number, not a repeat of a bullet |
| One idea per bullet; cut tone words | **Take** | "Ruthlessly", "spaghetti" and "from first principles" can go |
| Job Search OS lists its technologies twice | **Take** | A rendering bug: a "Technologies" line is shown and the bullet repeats it |
| Every skill must point to a bullet | **Adapt** | Never remove a skill the user picked (CLAUDE.md). Instead, the writer should tie it to real work where the work exists, and describe the work accurately rather than relabel it |
| Bullets under 30 words | **Adapt** | Resume 1 won with 60 to 80 word bullets, so proof beat length. Aim for about 25 to 40 words, with the top one or two allowed more |
| Add "[N] sessions" placeholders | **Adapt** | Never put brackets in a resume. Where a bullet has no result, optionally ask the user for one in the requirement review |
| Add Job Pilot, the eval harness, harness setup | **Adapt** | Right content, but it has to reach the record first, as a document or as "I have this" with a note |
| State location and work status in the header | **Adapt** | Show hard filters (country, work status) as requirements the user answers, like the existing mention lines. The user decides what goes in the header |
| "Interview-proof every line" as a check | **Discard as a gate** | It conflicts with the no-guards rule. The user owns what they claim |
| Reference-check risk from the title | **Discard** | Choosing the right version solves this; both titles are the candidate's own |
| Resume 2's format | **Discard** | No context on it |

## Where Resume 1 is weaker, so we must not copy it

- **It copies the job posting.** Its summary opens with the posting's sentences: "owns problems end to end... validating whether it actually worked". Our rule against this is correct; keep it.
- **It adds a detail the record doesn't have.** "Worked from Figma designs on UI and UX polish" was written in by the agent. We shouldn't add details on our own initiative, but we should welcome them when the user supplies them.
- **Its layout is weaker.** Long bullets, "Technologies:" lines in every role, and education above experience.
- **It misses work we found.** No video streaming or real-time captioning. Resume 3 found that work through the candidate's notes, and the report counts it as our best strength.

## What to apply to every future resume

1. **Choose the angle from what the job does, not the first word of its title.** A "Product Engineer" builds and ships, so for a mixed title, engineering-type words and the job's requirements should decide.
2. **Weigh proof, not only relevance.** A fact with a clear result should win over one that only names the right keywords.
3. **Rank the job's requirements before writing.** The core three or four (here: full stack, production ownership, AI workflow, customer loop) should outweigh soft traits.
4. **Lead with the result, using the candidate's own words.** Reordering the candidate's clauses is editing, not invention.
5. **Show conflicting numbers in the record to the user, once, and use what they confirm.**
6. **For a core requirement with thin proof, ask before writing.** For example: "This job's main ask is daily agentic coding. Want to add how you work?" That puts proof into the record for every later resume.
7. **Fit job terms to real work.** Use the term where the work is that thing. Otherwise describe the work plainly and keep the term in the skills line.
8. **Write the summary in three parts:** who the candidate is, in the job's title; their single strongest result; how they work.

Three bugs from the trace belong on the same list: Rails dropped by `skillTerm`, the re-sort that buried the Claude Code bullet, and company values offered as things the candidate has.

**What this means for the next step:** the highest-value fix is small. Choosing the right version would recover most of the gap with no prompt changes. Next in value are proof-weighted fact selection and result-first bullets. Missing record content is a product-flow problem (asking the user), not a writing problem.

I can also put this on a shareable page if you want to pass it along.