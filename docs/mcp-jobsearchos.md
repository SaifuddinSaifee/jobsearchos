# MCP and jobsearchos

How the Model Context Protocol (MCP) can solve problems named in [PLAN.md](PLAN.md), and what it makes possible that the plan does not cover yet.

---

## Background

**MCP** is an open standard for connecting AI applications to tools and data. A **host** (Claude Code, Claude Desktop, Claude mobile, Cursor) runs one **client** per **server**. A server exposes three kinds of things:

- **Tools:** functions the model can call (`list_jobs`, `change_status`)
- **Resources:** read-only data the host can attach as context (`jobsearchos://job/{id}`)
- **Prompts:** reusable templates that show up as slash commands (`/mcp__jobsearchos__tailor_resume`)

Messages are JSON-RPC 2.0 over **stdio** (local child process) or **Streamable HTTP** (remote, with OAuth). Newer protocol features used below: **elicitation** (the server asks the user a question mid-call) and **sampling** (the server asks the host's model to generate text).

jobsearchos can use MCP in two directions:

- **As a server:** AI hosts read and act on jobsearchos data. Inside a host, it combines with every other connected server (Gmail, Calendar, Drive, GitHub, a browser) without jobsearchos integrating with any of them.
- **As a client:** the app itself calls other MCP servers, either directly (MCP is plain RPC) or from an agent loop running on the Together AI models.

Most features below use the server direction.

---

## Design principles

These apply to every feature in this document.

1. **Proposals, not mutations.** Agent write tools that change important state create a proposal; the user approves it in the app. See feature 2.
2. **Agent once, code forever.** Agents handle one-off discovery and repair work. What they learn is saved as config that deterministic code then runs with no LLM. This keeps the plan's cost and reliability goals.
3. **Agent provenance.** Stage 3b already records who wrote each company field (posting, web, you). Add `agent`, plus the run that wrote it. "Your edits win" then covers agents too.
4. **Small tool scope.** Tools return only what a task needs (for example, a profile without salary history for most tasks). This limits what leaves the machine, which addresses the plan's privacy section.
5. **Nothing is sent or submitted automatically.** Emails are drafts and forms stop before Submit, matching the plan's email-safety rule.

---

## Contents

**Foundation**

1. [jobsearchos MCP server](#1-jobsearchos-mcp-server)
2. [Proposals inbox](#2-proposals-inbox)

**Plan problems, solved differently**

3. [Template filling with layout feedback](#3-template-filling-with-layout-feedback)
4. [Evidence vault](#4-evidence-vault)
5. [Inbox reconciler](#5-inbox-reconciler)
6. [Source scout](#6-source-scout)
7. [Self-healing fetch recipes](#7-self-healing-fetch-recipes)
8. [Save from any page](#8-save-from-any-page)
9. [Calendar follow-ups](#9-calendar-follow-ups)
10. [Conversational analytics](#10-conversational-analytics)

**Not in the plan**

11. [Warm-path finder](#11-warm-path-finder)
12. [Inbound recruiter triage](#12-inbound-recruiter-triage)
13. [Company timing signals](#13-company-timing-signals)
14. [Market skill-gap map](#14-market-skill-gap-map)
15. [Screening-question answer bank](#15-screening-question-answer-bank)
16. [Form fill, stop before Submit](#16-form-fill-stop-before-submit)
17. [Posting-closed watch](#17-posting-closed-watch)
18. [Capture from anywhere](#18-capture-from-anywhere)
19. [Interview prep pack](#19-interview-prep-pack)
20. [Story bank and mock interviews](#20-story-bank-and-mock-interviews)
21. [Interview debrief and thank-you notes](#21-interview-debrief-and-thank-you-notes)
22. [Offer comparison and negotiation](#22-offer-comparison-and-negotiation)
23. [Weekly review](#23-weekly-review)

[Build order](#build-order) and [Risks and prerequisites](#risks-and-prerequisites) are at the end.

---

## Foundation

### 1. jobsearchos MCP server

**Description**
A local MCP server (`scripts/mcp-server.ts`, stdio) that wraps the existing service layer as tools, resources and prompts. Every other feature builds on it.

**Problem**
The "Ask Claude" button ([ask-claude.tsx](../src/components/jobs/ask-claude.tsx)) packs a job into a claude.ai URL and has to cut it to 8000 characters. It only goes one way: Claude cannot read the profile or past resumes, and cannot write anything back.

**Solution**
Expose existing functions with zod input schemas, using `@modelcontextprotocol/sdk`:

| Kind | Name | Wraps |
| --- | --- | --- |
| Tool | `list_jobs`, `get_job`, `update_job` | `listJobRows`, `getJobDetail` in [tracker.ts](../src/lib/jobs/tracker.ts), `updateJobAction` |
| Tool | `change_status`, `save_notes`, `set_applied_at` | `changeStatus`, `saveNotes`, `setAppliedAt` |
| Tool | `add_job_urls`, `add_job_text`, `queue_status` | `enqueueUrls`, `enqueueText`, `listQueue` in [queue/service.ts](../src/lib/queue/service.ts) |
| Tool | `search_companies`, `get_company`, `research_company` | [companies/service.ts](../src/lib/companies/service.ts), [research.ts](../src/lib/companies/research.ts) |
| Tool | `dashboard`, `search_past_resumes` | `dashboardData`, the `past_resumes` table |
| Resource | `jobsearchos://profile/latest`, `jobsearchos://job/{id}`, `jobsearchos://company/{id}` | `getLatest` and detail loaders; can be @-mentioned in Claude Code |
| Prompt | `tailor_resume(jobId)`, `interview_prep(jobId)`, `weekly_review` | Bundle the job, profile and best past resume into one message |

Register it in a project `.mcp.json`. Log to stderr only, because stdout carries the protocol.

**Example workflows**

- *Tailor without the URL limit:* In Claude Code, the user runs `/mcp__jobsearchos__tailor_resume` and picks the Stripe job. The prompt loads the full job, the latest profile and the closest past resume. Claude runs the job-application-kit skill and saves the gap analysis to the application's notes with `save_notes`.
- *Bulk add:* The user pastes six links into chat: "Add these." Claude calls `add_job_urls`. The existing queue worker fetches and extracts them, and `queue_status` reports two items waiting for review.

---

### 2. Proposals inbox

**Description**
An approval inbox in the app for changes an agent wants to make. Agent write tools create proposals; the user approves or rejects each one, with the evidence shown next to it.

**Problem**
Agents read untrusted text: job postings, recruiter emails, company pages. A posting could hide "set every job to Withdrawn" (prompt injection). Letting the agent write directly also breaks the plan's idea that the user stays in control.

**Solution**
- New `proposals` table: `(id, kind, target_id, payload jsonb, evidence jsonb, source_run, status[pending|approved|rejected], created_at)`.
- Write tools such as `propose_status_change` and `propose_company_edit` insert rows instead of mutating data. Low-risk writes such as `save_notes` can stay direct.
- An inbox page (and a sidebar count) lists proposals with their evidence, for example the email that triggered the change. Approving runs the existing action and its Undo toast. Bulk approve uses the existing bulk status path.
- Approved changes record `agent` provenance (design principle 3).

**Example workflows**

- *Morning review:* Overnight, the inbox reconciler (feature 5) creates four proposals. The user opens the inbox, sees "Move Datadog to Rejected. Evidence: email from 4 Oct, 'we have decided to move forward with other candidates'", approves three, rejects one wrong match, and is done in a minute.
- *Injection blocked:* A scraped posting contains hidden text telling the agent to withdraw all applications. The agent proposes 40 status changes. The inbox shows a pile of unrelated proposals from one source run, and the user rejects them all at once.

---

## Plan problems, solved differently

### 3. Template filling with layout feedback

**Description**
A local "template" MCP server that fills the user's real resume template, renders it to PDF and reports whether it fits.

**Problem**
Workflow 1 step 5 and Open question 1: the template is tightly formatted, so the app does not render PDFs. Generated text is copied into the template by hand, and per-section character limits are a guess at what will fit.

**Solution**
- Add placeholders to the user's `.docx` template once (for example `{summary}`, `{#roles}{bullets}{/roles}`).
- Server tools: `fill_template(documentId)` fills it with docxtemplater; `render_pdf` uses headless LibreOffice; `measure_layout` reports page count and overflow per section ("Experience: 2 lines over").
- The writer loops: generate, fill, measure, trim, until it fits. The finished PDF is stored as a content-addressed file and attached to the application as `final_resume_pdf`, with an optional copy to Google Drive.

**Example workflows**

- *One-click final resume:* The user clicks Generate resume. The writer produces sections, the template server reports that Projects overflows by one line, the writer shortens one bullet, and the final PDF appears attached to the job. Nothing is copied by hand.
- *Template change:* The user changes the template font size. The next generation is measured against the new layout automatically; there are no character limits to retune.

---

### 4. Evidence vault

**Description**
A store of proof for the user's accomplishments, collected from GitHub, Drive, Jira and similar MCP servers, and cited by every generated bullet.

**Problem**
Stage 4's accuracy check verifies bullets against the profile, but the profile is a restatement of the resume. It cannot catch exaggeration, and it has no source for the metrics that make bullets strong.

**Solution**
- New `evidence` table: `(id, source[github|drive|jira|manual], url, title, summary, metrics jsonb, skills text[], occurred_at)`.
- An agent session reads merged PRs, design docs, performance reviews and launch notes through those MCP servers and proposes evidence items for the user to accept.
- Generation must cite an evidence ID for each bullet. The Stage 4 accuracy check flags bullets with no citation, and the editor shows each bullet's source on hover.

**Example workflows**

- *Building the vault:* The user asks Claude, "Collect my work from the last two years." Claude reads their GitHub PRs and Drive docs and proposes 30 evidence items, such as "Cut checkout latency from 900ms to 300ms (PR #412)." The user accepts 24.
- *Grounded bullet:* While writing a resume for a performance-focused role, the writer pulls the latency evidence and writes a bullet with the real number. The accuracy check passes because the bullet cites evidence #17.

---

### 5. Inbox reconciler

**Description**
Matches Gmail threads to applications and proposes status changes, with the email as evidence.

**Problem**
Stage 7 "later" and Stage 11 put off reply detection because it needs Gmail OAuth with `gmail.readonly`. Until then, the tracker is only as accurate as the user's manual updates, and the "needs attention" list fills with stale rows.

**Solution**
- Use the Gmail MCP connector instead of building OAuth.
- Match threads by company domain, ATS senders (`no-reply@greenhouse.io`, `@ashbyhq.com`, `myworkday`), job title and timing.
- Classify each match (rejection, scheduling request, assessment, offer, auto-acknowledgement) and create proposals (feature 2). Store the thread ID on the application so later matches are exact.

**Example workflows**

- *Weekly sync:* "Reconcile my inbox for the past week." Claude finds 12 related threads and proposes: 3 to Rejected, 1 to Recruiter screen, 1 to Technical interview. Auto-acknowledgements set the applied date on 2 jobs that were missing one.
- *Unknown sender:* A recruiter writes from a personal Gmail address about "the backend role." Claude matches it to the only backend job at that company by the title in the signature, and proposes it at low confidence for the user to confirm.

---

### 6. Source scout

**Description**
An agent that finds a company's ATS and job endpoint once, then registers it as a discovery source that runs without an LLM.

**Problem**
Stage 8 needs a "company to ATS to endpoint" mapping for the Fortune 500 and YC. Finding each Workday tenant and site, or each Greenhouse or Ashby board, by hand is slow detective work.

**Solution**
- A scout agent with a browser MCP server opens the company's careers page, follows the job links and identifies the ATS and its public endpoint.
- It calls an `add_source(kind, config)` tool, which writes a `sources` row as a proposal. After approval, the existing `SourceAdapter` and pg-boss cron refresh it daily.
- This is "agent once, code forever": the LLM cost is paid once per company, not once per day.

**Example workflows**

- *Seeding discovery:* "Scout these 50 Fortune 500 companies." The agent finds 31 on Workday, 8 on Greenhouse and 4 on SmartRecruiters, and marks 7 as unknown. The user approves the 43 sources in one bulk action, and Discover fills up the next morning.
- *A company switches ATS:* A source starts returning errors in `source_runs`. The scout re-runs for that company, finds its new Ashby board and proposes the updated config.

---

### 7. Self-healing fetch recipes

**Description**
When a job page fails to fetch or extract, an agent finds a working method and saves it as a per-site recipe that the fetch pipeline uses from then on.

**Problem**
Stage 2 targets about 90% extraction success. The remaining 10% land in `needs_review` or `failed` and need manual paste. The same sites keep failing in the same way.

**Solution**
- New `fetch_recipes` table: `(host, strategy, config jsonb, verified_at)`. Example configs: "wait for this selector", "job JSON is at this URL pattern", "click Show more first".
- A repair agent with a browser MCP server takes failed queue items, works out what is wrong and proposes a recipe. Once approved, the pipeline in [src/lib/jobs/fetch/](../src/lib/jobs/fetch/) checks recipes before its generic fallbacks.
- Each recipe is verified against the saved fixture set before use.

**Example workflows**

- *Repairing a stubborn site:* Five jobs from one company's custom careers site fail because the description loads after a click. The repair agent finds the hidden JSON endpoint and saves a recipe. The five jobs are re-queued and all extract cleanly.
- *Recipe goes stale:* The site changes and the recipe starts failing. The recipe is marked unverified and the repair agent is queued again.

---

### 8. Save from any page

**Description**
Save the job page you are viewing into jobsearchos from a browser agent, with no custom extension.

**Problem**
Stage 9 plans a Chrome Manifest V3 extension to cover LinkedIn and Indeed, which block fetching. Building and maintaining an extension is a project on its own.

**Solution**
- With Claude in Chrome (or another browser MCP host), Claude reads the page the user already has open and calls `add_job_text(text, url)`. That reuses `enqueueText` and the normal extraction pipeline.
- Because the user is viewing the page themselves, this is the same as the plan's "paste JD text" fallback, without the copying.

**Example workflows**

- *LinkedIn save:* The user is reading a LinkedIn posting and says, "Save this." Claude reads the visible page and calls `add_job_text`. The job shows up in the queue tracker in the sidebar.
- *Batch from search results:* On a job board results page: "Save the three that match my preferences." Claude checks them against `get_profile` preferences and saves the three that fit.

---

### 9. Calendar follow-ups

**Description**
Follow-up reminders are created as events on the user's real calendar, with the follow-up email already drafted.

**Problem**
Stage 9's follow-up reminders live inside the app, so they only work if the user opens the app at the right time.

**Solution**
- When an application reaches Applied, or an outreach email is sent, create a Calendar event N days later through the Calendar MCP connector. Its description links to the job (`?job=<id>`).
- On the day, the follow-up is drafted as a Gmail draft on the same thread (draft only, never sent automatically).
- If a reply arrives first (feature 5), the event is removed.

**Example workflows**

- *Follow-up on time:* The user marks a job Applied on Monday. The following Monday their calendar shows "Follow up: Acme, Backend Engineer", and a short follow-up is already sitting in Gmail drafts on the original thread.
- *Reply arrives first:* The recruiter replies on day 4. The reconciler proposes Recruiter screen, and approving it cancels the follow-up event.

---

### 10. Conversational analytics

**Description**
Ask questions about the job search in plain language and get answers from the real data, with a warning when the sample is too small.

**Problem**
Stage 10 plans charts and insights such as "Automation roles have a 2.3 times higher response rate." Building a chart for every question takes time, and with small numbers these insights are often noise.

**Solution**
- A read-only `query_pipeline` tool runs parameterized queries over `applications`, `status_events`, `jobs` and `companies` (or a read-only database role for free-form SQL).
- The prompt tells the model to report sample sizes and to say when a difference is not meaningful.
- Questions that get asked often can later become charts on the Analytics page.

**Example workflows**

- *Where do responses come from:* "Which sources get me the most interviews?" Claude answers: "Referrals 3 of 5, Greenhouse boards 4 of 31, LinkedIn 1 of 22. The referral numbers are too small to be sure, but the gap is large."
- *Timing:* "Does applying within 3 days of posting help?" Claude compares response rates by days between `posted_at` and `applied_at`, and says so if there is not enough data.

---

## Not in the plan

### 11. Warm-path finder

**Description**
Before cold outreach, find people the user already knows at the company, using their own email and calendar history.

**Problem**
Stage 7 only does cold outreach (Hunter, Apollo, a ranked stranger). The plan ignores the user's existing network, and a referral from someone who knows you usually beats any cold email.

**Solution**
- Search Gmail and Calendar through the MCP connectors for addresses at the company's domains, including aliases and the parent company from Stage 3b.
- Store the results as contacts with `source = "network"`, plus how the user knows them (shared thread, past meeting, last contact date). Rank them above cold contacts in the Stage 7 list.
- Generate a referral-request draft instead of a cold email for network contacts.

**Example workflows**

- *Hidden connection:* The user saves a job at Shopify. The warm-path finder finds a 2023 email thread with a former colleague who now has an `@shopify.com` address. The contact list shows them first, with a referral request draft ready to edit.
- *Parent company:* For a YouTube job, the finder also searches `@google.com` because of the parent-company link, and finds a past interviewer.

---

### 12. Inbound recruiter triage

**Description**
Detect job opportunities that recruiters send by email, and put them in the same pipeline as jobs the user finds.

**Problem**
The plan covers jobs the user finds (New Application, Discover) but not jobs that come to them. Recruiter emails get lost in the inbox and are never scored against preferences.

**Solution**
- The Gmail MCP connector finds recruiter outreach (role descriptions, "are you open to", job links).
- Each one is enqueued with `enqueueText` (or `enqueueUrls` if there is a link), with origin `inbound` and the thread ID kept.
- The Stage 6 match score and deterministic flags (salary, location, sponsorship) decide what surfaces first. A polite decline draft is offered for poor matches.

**Example workflows**

- *Weekly triage:* "Check for recruiter emails this week." Claude finds five, enqueues them, and reports: two match well, one is below the minimum salary, two are in excluded locations. It drafts decline replies for the last three.
- *Link in an email:* A recruiter sends a Lever link. It goes through `enqueueUrls` and the full ATS extraction path, so the job is as complete as one the user added.

---

### 13. Company timing signals

**Description**
Add recent events (funding, layoffs, hiring freezes, leadership changes) to company profiles, and use them to time and shape outreach.

**Problem**
Stage 3b researches what a company is (what it does, its values, its culture) but not what is happening there now. Timing changes everything: right after a funding round is the best moment to reach out; right after layoffs, the message has to be different.

**Solution**
- A `signals` field (or table) on companies: `(kind, summary, url, occurred_at)`.
- A web-search or news MCP server, run during research and on a weekly refresh for companies with active applications. It follows the same source-quality rules as [STAGE-3B-COMPANIES.md](STAGE-3B-COMPANIES.md).
- Signals appear in the job panel, are passed into cold email and cover letter generation, and feed the Stage 6 concerns list.

**Example workflows**

- *Good timing:* A saved startup announces a Series B. The job panel shows the signal, and the cold email opens by congratulating them and linking the user's experience to the growth stage.
- *Warning:* A target company announced layoffs two weeks ago. The signal appears as a concern in the match analysis, and the user decides to put the application on hold.

---

### 14. Market skill-gap map

**Description**
Combine skill gaps across all saved and discovered jobs to show which missing skills matter most, then turn that into a learning plan.

**Problem**
Stage 6 finds gaps one job at a time. It cannot tell the user that one missing skill blocks a large share of their target roles.

**Solution**
- Aggregate `job_keywords` and Stage 6 "missing requirements" across jobs, weighted by match score and status (a gap in a job that reached interview counts more).
- Compare against the profile and the evidence vault (feature 4).
- An agent turns the top gaps into a learning plan and portfolio project ideas, with Calendar time blocks if the user wants them.

**Example workflows**

- *Market view:* "What should I learn next?" Claude: "Kubernetes appears in 40% of your saved jobs, and you have no evidence for it. Terraform is 25%. Here is a 4-week plan and a small project that would show both."
- *Closing the loop:* The user finishes the project and adds it to the evidence vault. The next match scores for Kubernetes roles go up.

---

### 15. Screening-question answer bank

**Description**
A versioned store of answers to the questions application forms keep asking, tailored per company.

**Problem**
Almost every application asks the same things: why this company, work authorization, salary expectations, a challenging project, notice period. The user retypes these every time, and the plan does not cover them at all.

**Solution**
- New `answers` table: `(id, question_key, question_text, answer, company_id null, version, used_in_application_ids[])`. Generic answers have no company; tailored ones do.
- Answers are versioned and locked when an application is marked Applied, like documents.
- Tools: `get_answer(question, jobId)` returns a tailored draft built from the generic answer, the company profile and the job. `save_answer` stores the final text.

**Example workflows**

- *Filling a form:* A Workday form asks "Why do you want to work at Acme?" The user asks Claude, which drafts an answer from their generic "why us" answer, Acme's principles from the company profile and the job. The user edits and saves it.
- *Consistency:* A recruiter later asks what salary the user gave on the form. The answer locked on that application shows exactly what was submitted.

---

### 16. Form fill, stop before Submit

**Description**
A browser agent fills application forms with the profile, the locked documents and the answer bank, then stops so the user can review and click Submit.

**Problem**
Stage 11 puts automatic submission last. Until then, every application means re-entering the same data into Workday, Greenhouse and Lever forms, sometimes with account creation first.

**Solution**
- A browser MCP server fills fields from `get_profile`, uploads the locked resume PDF (feature 3) and uses `get_answer` for free-text questions (feature 15).
- The agent never clicks Submit. It lists anything it was unsure about and hands control back.
- After the user submits, it proposes marking the application Applied with today's date.

**Example workflows**

- *Greenhouse form:* "Fill the application for the Stripe job." The agent fills 18 fields, uploads the resume, drafts two free-text answers and stops: "Ready for review. I was unsure about the 'How did you hear about us' dropdown." The user fixes it and submits.
- *Workday:* The agent fills the multi-page Workday flow, including repeated work-history entries from the profile. It stops at the final review page.

---

### 17. Posting-closed watch

**Description**
Re-check saved postings from time to time to see whether they were closed or changed.

**Problem**
The "needs attention" list and the Ghosted status rely on time alone (Applied with no change for 7+ days). A posting that has been removed is much stronger evidence that the role is filled. Edits such as an added salary go unnoticed.

**Solution**
- A pg-boss job re-fetches active applications' postings weekly through the existing fetch pipeline.
- If the posting is gone, propose Ghosted (or flag it if an interview is in progress). If the text changed, store a new immutable `job_snapshot` and highlight what changed.
- An agent can investigate unclear cases with a browser MCP server, for example a page that redirects to a generic careers page.

**Example workflows**

- *Filled role:* Three weeks after applying, the posting returns a 404. The proposals inbox shows "Move Acme to Ghosted. Evidence: posting removed on 2 Oct."
- *Salary added:* A posting adds a salary range. The job panel shows the change, and the Stage 6 score is recalculated against the user's minimum.

---

### 18. Capture from anywhere

**Description**
Log updates from a phone in a few seconds, using a remote jobsearchos MCP server and Claude mobile.

**Problem**
Updates happen away from the desk: a recruiter calls, an interview is booked in the hallway. By the time the user is back at the app, details are forgotten or never logged.

**Solution**
- Offer the server over Streamable HTTP with OAuth (in addition to local stdio), behind a tunnel or on a small host connected to the database.
- A short voice or text note to Claude mobile becomes tool calls: status proposal, notes, Calendar event.

**Example workflows**

- *After a call:* Walking out of a meeting, the user tells Claude: "Recruiter from Stripe called, phone screen Thursday at 2, they asked about Go experience." Claude proposes Recruiter screen, adds a note about Go and creates the Calendar event.
- *Quick check:* In a coffee line: "What's my next interview and what did I send them?" Claude answers from the tracker and the locked documents.

---

### 19. Interview prep pack

**Description**
When an interview appears on the calendar, build a prep pack with exactly what the user sent, the posting as it was, the company and the interviewers.

**Problem**
Stage 11 mentions interview prep in one line. Before an interview, the user has to hunt for which resume version they sent, and the posting may already be gone.

**Solution**
- Match Calendar events to applications (company domain in attendees, company name in the title).
- Build a pack from:
  - the **locked resume and cover letter** sent with the application (the plan's immutability design)
  - the **JD snapshot**, which survives even if the posting is removed
  - the company profile and timing signals (feature 13)
  - the interviewers from the attendee list, with public background where available
  - likely questions, using past debriefs for this company (feature 21)
- Save the pack to the application and link it in the event description.

**Example workflows**

- *Day before:* An interview event exists for tomorrow. In the morning, the event description links to a prep pack: the resume sent on 12 Sep, the original posting, Acme's principles, two interviewers and ten likely questions.
- *Posting taken down:* The posting was removed a week ago. The prep pack still has the full original text from the snapshot.

---

### 20. Story bank and mock interviews

**Description**
A bank of STAR stories linked to evidence, mapped to each company's stated principles, and used for mock interviews with Claude.

**Problem**
Behavioral interviews ask for stories, and the user improvises them each time. The plan already stores `companies.principles` but does not use them for interview practice.

**Solution**
- New `stories` table: `(id, title, situation, task, action, result, competencies text[], evidence_ids[])`. Stories are drafted from the evidence vault (feature 4) and edited by the user.
- For a given company, map stories to its principles (for example, one story per leadership principle) and show which principles have no story yet.
- An `mock_interview(jobId)` prompt runs a practice interview using the JD, the principles and the story bank, and gives feedback afterwards.

**Example workflows**

- *Coverage check:* For an Amazon interview, the map shows stories for 11 of 16 leadership principles. Claude suggests evidence items that could become stories for the missing five.
- *Practice:* The user runs a mock interview from their phone with voice. Claude asks behavioral questions, then notes that their answer on "Disagree and commit" had no clear result.

---

### 21. Interview debrief and thank-you notes

**Description**
Right after an interview, capture a short debrief, then draft a thank-you note from it.

**Problem**
Details fade within hours: what was asked, who was in the room, what went badly. That information would improve the next round and the thank-you note, and the plan has nowhere to put it.

**Solution**
- When the matched Calendar event ends, the server uses elicitation to ask three or four quick questions: questions asked, how it went, follow-up promises, red flags.
- Debriefs are stored per application and per company, and build a per-company question bank that feeds the prep pack (feature 19).
- A thank-you note is drafted as a Gmail draft to the attendees within 24 hours, mentioning something specific from the debrief.

**Example workflows**

- *After the interview:* Ten minutes after the event ends, Claude asks: "How did the Acme technical round go? What did they ask?" The user dictates a summary. A thank-you draft referring to the system-design discussion is waiting in Gmail.
- *Next round:* Before the final round, the prep pack includes the questions from the earlier round and the user's own notes on what to improve.

---

### 22. Offer comparison and negotiation

**Description**
Turn offer letters into structured offers, compare total compensation, keep track of deadlines and draft negotiation emails.

**Problem**
The plan ends at the Offer status. Stage 11 mentions "salary intelligence" but nothing about handling offers: comparing them, deadlines, negotiation, references.

**Solution**
- New `offers` table: `(application_id, base, bonus, equity jsonb, vesting, sign_on, benefits, start_date, deadline, source_file_id)`.
- Offer PDFs are found in Gmail or Drive through MCP and extracted with `chatStructured()` into rows, reviewed by the user.
- A comparison view shows total compensation by year. Deadlines go on the Calendar.
- When an offer arrives, draft emails asking companies still interviewing to speed up. Negotiation drafts use the real competing numbers.
- A small references list: who is listed for which company, and whether they have been told.

**Example workflows**

- *Two offers:* Offers arrive from Acme and Globex. The comparison shows Globex is higher in year one but lower over four years because of vesting. Claude drafts a negotiation email to Acme using the Globex sign-on bonus.
- *Speeding up:* With the Acme deadline on 20 Oct, Claude drafts short notes to the two companies still interviewing, asking whether they can decide before then. The user sends them.

---

### 23. Weekly review

**Description**
A weekly rhythm for the job search: what happened, what is stuck, goals versus actual, and time blocked for next week.

**Problem**
A job search is a long project, and it tends to run in bursts followed by burnout. The dashboard shows numbers, but nothing turns them into a plan.

**Solution**
- A `weekly_review` prompt pulls `dashboardData`, the week's `status_events`, pending proposals and upcoming interviews.
- The user sets weekly goals (for example, 10 applications and 3 outreach emails). The review compares them with what happened.
- It ends with suggested Calendar blocks for next week (applications, prep, learning from feature 14) that the user approves.

**Example workflows**

- *Sunday review:* The user runs `/mcp__jobsearchos__weekly_review`. Claude: "6 of 10 applications, 2 new screens, 4 applications quiet for 10+ days. Suggest follow-ups on those 4 and three 90-minute application blocks next week." The user approves the blocks.
- *Pace check:* After three heavy weeks, the review shows response rates dropping while volume is rising. Claude suggests fewer, more tailored applications and more warm-path outreach (feature 11).

---

## Build order

| Order | Features | Why |
| --- | --- | --- |
| 1 | 1. MCP server (read-only tools first), 2. Proposals inbox | Everything else depends on these |
| 2 | 3. Template filling with layout feedback | Removes the biggest manual step in the plan |
| 3 | 5. Inbox reconciler, 12. Inbound triage | Keeps the tracker accurate and brings Stage 11 work forward |
| 4 | 11. Warm-path finder | Not in the plan, and likely worth more than cold outreach |
| 5 | 19 to 21. Interview loop | Uses the locked documents and stored company principles |
| 6 | 6, 7. Source scout and fetch recipes | Speeds up Stage 8 and the Stage 2 success rate |
| Later | Everything else | Builds on the above |

---

## Risks and prerequisites

- **Host required:** most features run inside an MCP host (Claude Code, Desktop or mobile). The in-app Together AI models only benefit if the app also acts as an MCP client.
- **Prompt injection:** postings, emails and web pages are untrusted. Keep destructive tools off the server, route important writes through the proposals inbox, and keep host approval on for write tools.
- **Privacy:** Gmail, Calendar and Drive access widens what an agent can read. Keep the server local over stdio unless remote capture (feature 18) is needed, and then only behind OAuth.
- **Site terms:** browser agents (features 6, 7, 8, 16) must respect each site's terms and robots.txt, as the plan already requires.
- **Connectors:** Gmail and Google Calendar connectors need to be authorized in claude.ai connector settings before features 5, 9, 11, 12, 19, 21 and 22 work.
- **SDK versions:** check that the installed `@modelcontextprotocol/sdk` supports zod 4, which this project uses.
