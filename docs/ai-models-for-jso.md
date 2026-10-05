# AI models for JobSearchOS

Which models the app uses, which ones we are considering, and how to decide between them. Cost is treated as a first-class constraint.

Status: proposal. Nothing in this document has been applied to the code or `.env`. The "Current lineup" section is verified against the repo; the "Proposed lineup" and "Candidate models" sections come from an external model-selection analysis (see "Sources and caveats") and need our own evals before any change.

Last updated: 2026-10-05.

## Contents

1. [Current lineup](#current-lineup)
2. [Guiding principle](#guiding-principle)
3. [Proposed lineup](#proposed-lineup)
4. [Candidate models](#candidate-models)
5. [Pipeline](#pipeline)
6. [Value ranking](#value-ranking)
7. [Evals to run](#evals-to-run)
8. [Config changes](#config-changes)
9. [Sources and caveats](#sources-and-caveats)
10. [Open questions](#open-questions)
11. [Task-by-task model table](#task-by-task-model-table)

## Current lineup

Verified from [src/lib/env.ts](../src/lib/env.ts), `.env.example` and the call sites. All LLM calls go through Together AI (client in [src/lib/llm/client.ts](../src/lib/llm/client.ts)), except embeddings, which run locally through Ollama.

| Role | Env var | Model | Provider | Status |
| --- | --- | --- | --- | --- |
| Writing (resume, cover letter, cold email) | `WRITER_MODEL` | `MiniMaxAI/MiniMax-M3` | Together AI | Planned for Stage 4, not in use yet |
| Extraction, parsing, scoring, classification | `EXTRACTION_MODEL` | `zai-org/GLM-5.3-Flash` | Together AI | In use (job extraction, resume parsing) |
| High-volume triage (discovery prefilter) | `FAST_MODEL` | `zai-org/GLM-5.3-Flash` | Together AI | Configured, nothing calls it yet |
| Embeddings | `EMBEDDING_MODEL` | `qwen3-embedding:4b` | Ollama (local) | Planned for Stage 5 |

Every extraction row stores the model that produced it (`model` column in [src/lib/db/schema.ts](../src/lib/db/schema.ts)), so model changes stay traceable and old results can be compared with new ones.

## Guiding principle

The question is not "what is the smartest model", it is:

> For each job in the pipeline, are we paying more than necessary for a model that is not actually better at that job?

Rules that follow from this:

- Optimize for **cost per successful task**, not the lowest price per 1M tokens. A $0.15 model that needs three attempts costs more than a $0.30 model that gets it right once.
- Cheap model for a cheap task. Smart model for an expensive decision.
- Never use a premium model when a cheap model passes our eval.
- Benchmark scores (such as an intelligence index) do not prove writing quality. Writing models must be judged on our own prompts.

## Proposed lineup

Two immediate changes, one addition, and two evals. Everything else stays.

| Role | Env var | Current | Proposed | Decision |
| --- | --- | --- | --- | --- |
| Triage | `FAST_MODEL` | GLM-5.3 Flash | `deepseek-ai/DeepSeek-V4.1-Flash` | Change. Triage is a judgment ("is this worth sending down the pipeline"), not just extraction, so the stronger model earns its higher token price. Its cache-hit price is also very low. |
| Extraction | `EXTRACTION_MODEL` | GLM-5.3 Flash | GLM-5.3 Flash | Keep. Structured JSON extraction does not need a strong model. Run the Qwen3.8 Flash eval as a possible cheaper replacement. |
| Reasoning | `REASONING_MODEL` (new) | none | `mimo-v2.6-pro` | Add. Candidate-to-job reasoning, final matching and hard decisions. Roughly the same measured intelligence as GLM-5.3 at a fraction of the price. |
| Writing | `WRITER_MODEL` | MiniMax M3 | MiniMax M3, pending A/B | Keep for now. Run the writing A/B against DeepSeek V4.1 Flash; if DeepSeek wins or ties, drop M3. |

## Candidate models

Prices are USD per 1M tokens, as listed in the source analysis (Together's pricing page, plus MiMo's own pricing page for MiMo). Verify before relying on them; they change.

| Model | Input | Cached input | Output | Notes |
| --- | ---: | ---: | ---: | --- |
| Qwen3.8 Flash | 0.09 | not listed | 0.282 | Cheapest option. Test against GLM-5.3 Flash for extraction. |
| GLM-5.3 Flash | 0.15 | 0.03 | 0.50 | Current extraction model. Structured outputs. 1M context. |
| GPT-OSS 120B (`openai/gpt-oss-120b`) | 0.15 | not listed | 0.60 | Cheap general structured-output model. Benchmark against GLM Flash. |
| MiniMax M3 | 0.30 | 0.06 | 1.20 | Current writer. 524K context. |
| DeepSeek V4.1 Flash | 0.30 | 0.006 | 1.20 | Same price as M3 but scores higher on the benchmarks below. |
| MiMo-V2.6-Pro | 0.435 | not listed | 0.87 | 1M context. Intelligence index 46. About $0.13 per benchmark task. |
| GLM-5.3 | 1.40 | not listed | 4.40 | Not a default. About 3.2x MiMo on input and 5x on output for a similar score (about 45). |
| Kimi K3 | 3.00 | not listed | 15.00 | Not a default. About 7x MiMo on input and 17x on output. Reference model only. |

Other models in the source's table (Qwen3.8-2.4T-A95B, Inkling) are rated low value for this app and are not discussed further.

### DeepSeek V4.1 Flash vs MiniMax M3

The clearest "same price, better model" case in the analysis. Figures are from Artificial Analysis.

| Measure | MiniMax M3 | DeepSeek V4.1 Flash |
| --- | ---: | ---: |
| Intelligence Index | 29 | 39 |
| GDPval | 1245 | 1600 |
| AutomationBench | 21% | 69% |
| Terminal Bench | 2% | 27% |
| Input price | $0.30 | $0.30 |
| Output price | $1.20 | $1.20 |
| Cache price | $0.06 | $0.006 |
| Cost per task | $0.51 | $0.27 |

None of these measure cover-letter quality, so M3 is not replaced until the writing A/B below says so.

### Why not Kimi K3 or GLM-5.3 by default

Both cost several times more than MiMo-V2.6-Pro without a matching jump in measured quality. Keep them as specialist candidates only, for tasks where our own evals show a clear advantage.

## Pipeline

Proposed flow for a discovered job. Today only the extraction step exists; triage is part of the Discover feature and reasoning and writing come in later stages.

1. **Job found.** A posting arrives from a source or a pasted URL.
2. **Triage** with `FAST_MODEL` (DeepSeek V4.1 Flash). Cheap judgment: is it relevant enough to continue? Irrelevant jobs stop here.
3. **Extraction** with `EXTRACTION_MODEL` (GLM-5.3 Flash). Structured extraction, classification and parsing into the job record.
4. **Reasoning** with `REASONING_MODEL` (MiMo-V2.6-Pro). Candidate-to-job reasoning, final matching and difficult decisions.
5. **Writing** with `WRITER_MODEL` (MiniMax M3 or DeepSeek V4.1 Flash, decided by A/B). Resume, cover letter and cold email.

## Value ranking

Best value for this app, not best models in general.

| Rank | Model | Use in this app |
| ---: | --- | --- |
| 1 | MiMo-V2.6-Pro | Deep reasoning |
| 2 | DeepSeek V4.1 Flash | Cheap reasoning and triage |
| 3 | GLM-5.3 Flash | Extraction |
| 4 | Qwen3.8 Flash | Ultra-cheap extraction (needs our own eval before promotion) |
| 5 | MiniMax M3 | Writing |
| 6 | GPT-OSS 120B | General and structured output |
| 7 | GLM-5.3 | Specialist reasoning and coding |
| 8 | Qwen3.8-2.4T-A95B | General |
| 9 | Kimi K3 | Premium specialist |
| 10 | Inkling | Premium reasoning |

## Evals to run

Run both before changing `WRITER_MODEL` or `EXTRACTION_MODEL`. Use 30 to 50 real examples each. Record cost per successful task, not just token price.

### Writing: MiniMax M3 vs DeepSeek V4.1 Flash vs MiMo-V2.6-Pro

Use about 30 real application-writing prompts. Score each output on:

- Factuality
- Personalization
- Writing quality
- Verbosity
- Following constraints
- Avoiding hallucinated experience
- ATS relevance
- Tone

Decision rule: if DeepSeek wins or ties, drop M3.

### Extraction: Qwen3.8 Flash vs GLM-5.3 Flash (and GPT-OSS 120B)

Replay the saved job-page fixtures and real resumes. Score each output on:

- JSON reliability
- Missing fields
- Hallucinated fields
- Schema adherence
- Job description parsing
- Resume parsing
- Classification accuracy

Decision rule: if Qwen wins or is indistinguishable, use Qwen. Qwen would cut input cost by about 40% and output cost by about 44% versus GLM-5.3 Flash. The existing `npm run eval:jobs` and `npm run eval:resume` scripts replay fixtures and real resumes against the configured model and are the natural starting point.

## Config changes

Proposed `.env` and `.env.example` diff. Do not apply until the checks in "Open questions" are done.

```diff
- FAST_MODEL=zai-org/GLM-5.3-Flash
+ FAST_MODEL=deepseek-ai/DeepSeek-V4.1-Flash

  EXTRACTION_MODEL=zai-org/GLM-5.3-Flash

+ REASONING_MODEL=mimo-v2.6-pro

  WRITER_MODEL=MiniMaxAI/MiniMax-M3
```

Code changes this implies:

- Add `REASONING_MODEL` to the schema in [src/lib/env.ts](../src/lib/env.ts) with a default.
- Add it to the model-ID check and the model list on the settings page ([src/app/(app)/settings/page.tsx](../src/app/(app)/settings/page.tsx)).
- Update the model routing table in [docs/PLAN.md](PLAN.md).

## Sources and caveats

The proposed lineup, prices and benchmark numbers come from a pasted analysis written outside this repo, which cited:

- Together AI pricing page
- Artificial Analysis model pages and the DeepSeek V4.1 Flash vs MiniMax M3 comparison
- Xiaomi MiMo pricing page
- An Intelligent Living article, used for the DeepSeek V4.1 Flash intelligence and cost-per-task figures

Treat all of it as unverified until checked:

- Prices and benchmark scores were not re-checked against the live sources when this document was written.
- Some figures come from a secondary article rather than the benchmark site.
- The claim that GLM-5.3 Flash sits in a "much lower tier" than DeepSeek V4.1 Flash has no number attached.
- Benchmark scores measure general capability, not the quality of our extraction or writing.

## Open questions

- **Provider for MiMo.** The MiMo price came from Xiaomi's own pricing page, and the model ID `mimo-v2.6-pro` has no Together-style `org/name` prefix. Today every LLM call goes through the Together client. Confirm whether MiMo is on Together; if not, adding it means a second provider, client and API key.
- **Exact model ID for DeepSeek.** Confirm `deepseek-ai/DeepSeek-V4.1-Flash` is the ID Together serves. The settings page check will report unknown IDs.
- **Is a separate reasoning role needed yet?** Matching and scoring currently fall under `EXTRACTION_MODEL`. A `REASONING_MODEL` only pays off once Stage 3 or later features need it.
- **Cache pricing.** DeepSeek's low cache-hit price only helps if our prompts share a long stable prefix. Check how the triage prompt is built before counting on that saving.

## Task-by-task model table

Every task in the app that needs a model, whether it is built yet, which env variable picks its model, and what we use now versus what the proposal says.

How to read it:

- **Status** is checked against the code. "Implemented" means a feature calls the model today. "Not implemented" means it is only planned (the stage is from [docs/PLAN.md](PLAN.md)).
- **Current model** is what the env variable resolves to today (the defaults in [src/lib/env.ts](../src/lib/env.ts), which match `.env`). For tasks not built yet, it is the model PLAN.md assigns to them.
- **Proposed model** is what this document recommends. "Keep" means no change proposed. Where the source analysis said nothing about a task, the row says so rather than guessing.
- Tasks that ask for structured data go through `chatStructured` ([src/lib/llm/structured.ts](../src/lib/llm/structured.ts)): one call, the output shape is forced to a Zod schema with `response_format: json_schema`, the reply is validated, and truncated, non-JSON or off-schema replies raise an error. When a call passes no model, it uses `EXTRACTION_MODEL`.

| # | Task (the rule) | Status | Env variable | Current model | Proposed model | What the task does, and how the model achieves it | Why this model now, and why change (or not) |
| ---: | --- | --- | --- | --- | --- | --- | --- |
| 1 | Turn an uploaded resume into a structured profile | Implemented ([src/lib/resume/parse.ts](../src/lib/resume/parse.ts), `POST /api/resume/parse`) | `EXTRACTION_MODEL` (default, no model passed) | GLM-5.3 Flash | Keep GLM-5.3 Flash. Eval Qwen3.8 Flash as a cheaper swap. | Text pulled from a PDF or DOCX goes in with a strict prompt: extract only what is written, never infer or embellish, keep bullets verbatim, use empty values for anything missing, dates exactly as written. The model returns the profile JSON (experience, skills, projects, education, certifications, achievements). The result is a draft the user reviews and edits before it is saved as a profile version. | This is copying text into a schema, which needs reliable JSON and a long context window, not deep reasoning. GLM-5.3 Flash is $0.15 input and $0.50 output per 1M tokens, has a 1M context and supports structured outputs. A stronger model costs more and would not do this job better. Qwen3.8 Flash ($0.09 and $0.282) is only worth switching to if it matches GLM on the resume eval (`npm run eval:resume`). |
| 2 | Turn a job posting into a structured job record | Implemented ([src/lib/jobs/extract.ts](../src/lib/jobs/extract.ts), run by the pipeline and the background queue) | `EXTRACTION_MODEL` | GLM-5.3 Flash | Keep GLM-5.3 Flash. Eval Qwen3.8 Flash and GPT-OSS 120B as cheaper or equal swaps. | The posting text (from an ATS API, JSON-LD or the page body) plus any hints goes in. The model returns company, title, location, remote type, employment type, salary, posted date, responsibilities, requirements, technologies, application URL, what the posting says about the company, and additional details. Values that an ATS API or JSON-LD gives reliably override the model's (`mergeHints`), and the application URL is kept only if it is a real http(s) link. The model name is stored on the row. | Same reasoning as row 1, but with more volume: the queue runs two extractions at once and discovery will add many more, so price per task matters most here. The saved page fixtures (`npm run eval:jobs`) give an objective way to test a cheaper model before swapping. |
| 3 | Fill "additional details" for jobs saved before that field existed | Implemented (`extractAdditionalDetails` in [src/lib/jobs/extract.ts](../src/lib/jobs/extract.ts), run from [src/lib/jobs/service.ts](../src/lib/jobs/service.ts)) | `EXTRACTION_MODEL` | GLM-5.3 Flash | Keep GLM-5.3 Flash | Re-reads the saved original posting text (kept even if the posting is taken down) and returns only the details that are not duties, requirements or the company description. It uses only what the posting says and ignores navigation, cookie notices and equal-opportunity or legal boilerplate. It is one call per job. | A narrow extraction on text we already have. Cheapest capable model is the right fit; nothing about it needs reasoning. |
| 4 | Summarize a company from its web sources | Implemented ([src/lib/companies/research.ts](../src/lib/companies/research.ts), the company page's research action and the pipeline) | `EXTRACTION_MODEL` (default, no model passed) | GLM-5.3 Flash | Keep GLM-5.3 Flash | Code first gathers pages cheapest first: the posting's own text, the company's own site (About pages), then at most two paid Tavily searches. The model reads the numbered sources and returns what the company does, mission, values and culture, plus which sources it used. Code enforces that mission, values and culture can only come from company-owned sources, never from job boards or review sites. Tavily itself is a search API, not a model. | The model only condenses supplied text into fixed fields; the trust rules live in code, not in the model's judgment. That keeps this an extraction-grade task. |
| 5 | Decide which discovered jobs are worth keeping (discovery prefilter) | Not implemented (Stage 8, Discover page) | `FAST_MODEL` | GLM-5.3 Flash (configured; no code calls it yet) | DeepSeek V4.1 Flash (`deepseek-ai/DeepSeek-V4.1-Flash`) | For each of the many openings found per day, the model would read a short version of the posting against the user's preferences and answer whether it is worth sending further down the pipeline. Jobs that fail stop there, so the expensive steps never run on them. | GLM-5.3 Flash is the cheapest option and PLAN.md estimates about $10 per 10,000 jobs at 5K tokens in and 500 out. The change is proposed because this is a judgment call, not just copying, and a stronger model should discard fewer good jobs and keep fewer bad ones. The cost is real: at $0.30 input and $1.20 output, 10,000 jobs come to roughly $21 without caching (my arithmetic from the listed prices), about double GLM. Its cache-hit price of $0.006 per 1M tokens only helps if the triage prompt keeps a long fixed prefix. Test on real discovered jobs before switching. |
| 6 | Expand a job's keywords with related terms | Not implemented (Stage 5) | `EXTRACTION_MODEL` | GLM-5.3 Flash | Keep. The source analysis does not cover this task. | Starts from keywords in the job description (for example "automation", "n8n", "Zapier") and proposes related terms the posting does not contain (for example "workflow orchestration", "Make.com", "webhooks"). They are stored as `expanded` keywords and used to search past jobs and resumes. | A short structured list; no deep reasoning. The extraction model is already the planned fit. |
| 7 | Rerank retrieved past resume chunks against the job | Not implemented (Stage 5) | `EXTRACTION_MODEL` | GLM-5.3 Flash | Keep for now. The source analysis does not cover this task; PLAN.md allows moving it to a stronger model if quality needs it. | Vector search and full-text search each produce candidates, merged by reciprocal-rank fusion to about 20. The model then ranks those against the job description and keeps the best few, which are injected into the writing prompt as style and phrasing references, never as facts. | Ranking about 20 short chunks is a bounded comparison. Start cheap and escalate only if the references it picks look wrong. |
| 8 | Score how well a candidate fits a job and explain the gaps | Not implemented (Stage 6) | `EXTRACTION_MODEL` today; a new `REASONING_MODEL` if adopted | GLM-5.3 Flash (as PLAN.md assigns it) | MiMo-V2.6-Pro (`mimo-v2.6-pro`). This mapping is mine: the source says MiMo is for candidate-to-job reasoning and final matching. | Scores five areas (Skills, Experience, Responsibilities, Location, Preferences) as structured output, and lists strengths, missing requirements, concerns and why the job is relevant. The overall score is a weighted sum computed in code, not by the model. Deterministic flags (country mismatch, sponsorship, salary below minimum, excluded company) are also code. Results are cached per job snapshot and profile version. | Comparing a whole profile with a whole posting is real reasoning, the kind where a weak model gives unstable scores (the goal is within 5 points across reruns). MiMo-V2.6-Pro scores about 46 on the Artificial Analysis index for $0.435 input and $0.87 output, similar to GLM-5.3 at about a fifth of its output price. It may not be served by Together; see Open questions. |
| 9 | Write a tailored resume | Not implemented (Stage 4). The provider exists ([src/lib/llm/generation.ts](../src/lib/llm/generation.ts)) but no feature calls it. | `WRITER_MODEL` | MiniMax M3 | Keep MiniMax M3 for now. A/B against DeepSeek V4.1 Flash (and MiMo-V2.6-Pro) on about 30 real prompts; drop M3 if DeepSeek wins or ties. | Input is the latest profile version, the job, the generation instructions and, from Stage 5, retrieved past-resume references. Output is structured by section (summary, skills, each role's bullets, projects) with per-section length limits so it fits the user's cramped template. The provider sends one chat call with up to 16,000 output tokens and raises an error if the output is cut off. | MiniMax M3 is a writing-oriented model at $0.30 input and $1.20 output with a 524K context. DeepSeek V4.1 Flash costs exactly the same and scores much higher on general benchmarks (index 39 versus 29), which is the reason to test it. Benchmarks do not measure resume quality, so the choice is made on factuality, no invented experience, ATS relevance, tone and constraint-following. |
| 10 | Write a cover letter | Not implemented (Stage 4) | `WRITER_MODEL` | MiniMax M3 | Same as row 9 | Generated from the same inputs as the resume, as a letter the user edits and copies into their own template. Every save is a new version. | Same model and same A/B as row 9; writing roles should not be split across models without a reason. |
| 11 | Write a cold email and follow-ups | Not implemented (Stage 4; sending is Stage 7) | `WRITER_MODEL` | MiniMax M3 | Same as row 9 | A short subject plus an 80 to 150 word body, with follow-ups, generated from the same inputs. Sending is always a manual click from the user's Gmail. | Same as row 9. Short outputs make this the cheapest document to test first in the A/B. |
| 12 | Check generated documents for claims not in the profile | Not implemented (Stage 4) | `EXTRACTION_MODEL` | GLM-5.3 Flash | Keep. The source analysis does not cover this task. | A second pass reads each generated bullet against the profile and flags anything it cannot trace back, so invented claims are caught. | Verification against supplied text is extraction-grade work, and using a different model from the writer means the checker does not share the writer's blind spots. |
| 13 | Rank possible contacts for a job | Not implemented (Stage 7) | `EXTRACTION_MODEL` | GLM-5.3 Flash | Keep. The source analysis does not cover this task. | Contact candidates come from the posting, from Hunter.io or Apollo.io, or from manual entry. The model ranks them by relevance to the role (hiring manager for that team, then team lead, then technical recruiter, then general recruiter) and gives a reason for each. | Ranking a handful of candidates by a fixed order of preference is a small bounded task. |
| 14 | Turn job descriptions and resume chunks into vectors for search | Not implemented (Stage 5) | `EMBEDDING_MODEL` (with `OLLAMA_BASE_URL`) | `qwen3-embedding:4b`, local through Ollama | Keep. No change proposed. | Produces an embedding for each job description and each resume section or bullet, stored in pgvector. Retrieval compares them by similarity, and the model name is stored next to every vector so old vectors are never mixed with a different model's. | Together has no serverless embedding models, so this is the one task that runs locally. Free to run, and nothing in the proposal affects it. |
| 15 | "Ask Claude" button on a job | Implemented ([src/components/jobs/ask-claude.tsx](../src/components/jobs/ask-claude.tsx)) | None | None. It does not call a model from the app. | None | Builds a prompt from the structured job (without the verbatim posting, capped at about 8,000 characters in the URL) and opens a new claude.ai chat with it. The user adds their resume there and uses their own Claude account. | Included only so it is not mistaken for part of the lineup. It uses no app API key and nothing here changes it. |

Summary: 4 model tasks are implemented, all on `EXTRACTION_MODEL` (GLM-5.3 Flash). 10 are planned, covering triage, keyword expansion, reranking, match scoring, three writing tasks, the accuracy check, contact ranking and embeddings. The proposal changes the model for two of them (triage, and match scoring if a reasoning role is added) and puts the three writing tasks behind an A/B test. Row 15 is outside the app's model setup.
