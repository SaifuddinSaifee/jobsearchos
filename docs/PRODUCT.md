# Job Search OS: Product

What this app is, what it can do today, where it is going, and what we build next. This is the functional view: no
code, no schema. For how each piece is built, follow the links to the stage docs and [PLAN.md](PLAN.md).

Keep this file current. When a feature ships, move it from "Roadmap" to "What it does today" and add its user stories.

Last updated: 2026-10-12 (branch `stage-emails`).

---

## Contents

1. [What it is](#1-what-it-is)
2. [Who it is for](#2-who-it-is-for)
3. [Vision](#3-vision)
4. [Product principles](#4-product-principles)
5. [What it does today](#5-what-it-does-today)
6. [User stories (built)](#6-user-stories-built)
7. [Status by stage](#7-status-by-stage)
8. [Roadmap: what comes next](#8-roadmap-what-comes-next)
9. [Recommended next steps](#9-recommended-next-steps)
10. [Open questions](#10-open-questions)
11. [Related documents](#11-related-documents)

---

## 1. What it is

Job Search OS is a personal workspace for running a job search the way a small sales team runs a pipeline. It runs on
your own machine and keeps your data there.

Instead of a spreadsheet, a pile of resume files, scattered bookmarks and a Gmail search, it gives you one place to:

- **Capture** jobs: paste a link and get a clean, structured job record
- **Understand** them: the role, the requirements, and the company behind it
- **Track** every application through its stages, from Saved to Offer
- **Reach out**: find the right person at the company and email them from your own Gmail, with the right resume attached
- **Reuse** what you already have: your profile, your past resumes, your notes

Later it will also write the tailored resume, cover letter and cold email for each job, score how well each job fits,
and find new openings for you.

## 2. Who it is for

One person running their own job search, who:

- applies to many roles and loses track of where each one stands
- tailors their resume per role and wants to reuse the best past wording
- believes a short, well-aimed email to the hiring manager beats a cold application
- wants AI to do the tedious parts (reading postings, finding people, first drafts) but keep the final say

It is single-user. There are no accounts, teams or sharing.

## 3. Vision

**From "I found a job link" to "a tailored application is out and the hiring manager has an email" in a few minutes of
review, for every job, with nothing lost along the way.**

Where it is heading, in order:

1. **One record per opportunity.** Everything about a job lives on it: the posting, the company, your status and notes,
   the people, the emails sent, the resume used. (Mostly built.)
2. **Writing done for you.** A tailored resume, cover letter and cold email per job, drawn from your real experience and
   your past resumes, checked so nothing is invented. You review, edit and copy into your own template.
3. **Know what is worth your time.** An explainable fit score per job, with gaps and concerns, so you spend effort on the
   right roles.
4. **Jobs come to you.** A Discover feed of relevant openings from Fortune 500 companies and Y Combinator startups,
   filtered by your preferences.
5. **The loop closes itself.** Follow-up reminders, reply detection from Gmail, and analytics that show what actually
   gets responses ("automation roles reply 2x more than full-stack").

Nothing is ever submitted or sent without an explicit click from you.

## 4. Product principles

- **You are in control.** AI proposes; you decide. Emails send only on a click, after a confirmation that shows exactly
  what goes out.
- **Your edits win.** Anything you type is never overwritten by automation or research.
- **Nothing is invented.** Generated content must trace back to your profile. Guessed emails are labelled as guesses.
- **History is kept.** Profile saves, job snapshots and attached files are never changed after the fact, so you can
  always see exactly what was used for an application.
- **Cheapest reliable source first.** Public APIs before scraping, free lookups before paid credits, and the app tells
  you what a lookup cost.
- **Work survives the tab.** Slow tasks (reading postings, finding people, indexing resumes) run in the background and
  keep going if you leave the page.
- **Private by default.** Data lives in your local database and disk. The exception: AI calls send their input (resume
  text, job pages) to Together AI, and Gmail, Tavily and Prospeo receive what they need.

## 5. What it does today

The sidebar has: **Dashboard, Jobs, New Application, Quick links, Companies, Discover, Profile, Settings.**

### Profile

- Upload your resume (PDF or DOCX). The app reads it and fills a structured profile: experience, skills, projects,
  education, certifications, achievements. You review and edit it.
- **Preferences:** target roles, locations, remote/hybrid/on-site, minimum salary, countries, visa sponsorship,
  preferred technologies, excluded roles and companies.
- **Generation instructions:** your style rules, tone and per-section length limits, ready for when the app writes for
  you.
- **Past resumes:** import older resumes so the app can learn from them later.
- **Version history:** every save is kept; you can look back and restore an older version.

### Adding jobs (New Application)

- Paste one job link, or many at once. They are processed in the background, two at a time, and a tracker in the
  sidebar shows progress. You can leave the page.
- Works with the common applicant tracking systems (Greenhouse, Lever, Ashby, Workday, SmartRecruiters, Workable) and
  ordinary career pages, including ones that need a browser to render.
- For sites that block automated reading (LinkedIn, Indeed), paste the job text instead.
- The app pulls out company, title, location, remote type, employment type, salary, posted date, responsibilities,
  requirements, technologies, keywords, and extra details such as benefits and the interview process.
- Clean results save automatically. Doubtful ones wait for your review.
- Duplicates are detected, so the same job is not saved twice.

### Jobs (the tracker)

- A table of every job, with tabs: **Active, Saved, Preparing, Applied, Interviews, Offers, Closed.**
- Search, filters, sorting, column choice, pagination and CSV export.
- Change status inline, per row or in bulk, with Undo. Marking a job Applied records the date.
- Statuses: Saved, Preparing, Applied, Recruiter Screen, Interview, Technical Interview, Final Interview, Offer,
  Rejected, Withdrawn, Ghosted. Every change is recorded on a timeline.
- A side panel per job: links, status, applied date, notes, details, requirements, responsibilities, keywords, timeline
  and the original posting text. Move to the previous or next job without closing it. Each job has its own link.
- Edit any job's fields by hand.
- **Copy or download a job as Markdown**, including the company profile, for use in any AI tool.
- **Ask Claude:** opens a claude.ai chat with the job already loaded and a prompt to tailor your resume and cover letter
  and point out gaps.
- Keyboard shortcuts: `/` search, `j`/`k` move, `Enter` open, `x` select, `Shift+A` mark Applied, `Esc` close.

### Dashboard

- Funnel counts by stage.
- **Needs attention:** applications with no movement for 7+ days, jobs stuck in Preparing for 3+ days.
- Recent activity.

### Companies

- One profile per employer, shared by all its jobs: what they do, mission/values/principles, culture, and your private
  notes.
- Jobs link to their company automatically, and different spellings or brands (YouTube and Google) can be linked or
  merged.
- **Research** fills a profile from the posting, then the company's own website, then one web search only if needed.
  Sources are labelled, and mission and values come only from the company's own pages.
- A brand can be marked as part of a parent company.

### Outreach (email a contact about a job)

Opened from a job's side panel ("Email a contact").

- **Find people:** searches the posting, the company's Y Combinator page, the web and Prospeo at the same time, merges
  duplicates, then ranks everyone (hiring manager, founder at a small company, team lead, technical recruiter,
  recruiter) with a one-line reason for each. It runs in the background, and you get a notice when it finishes.
- **Find email:** tries the cheapest source first (your saved contacts, then public web pages, then a paid Prospeo
  lookup, then format guesses such as `first.last@`). Each address shows how trustworthy it is (Verified, Risky,
  Unverified, Invalid) and where it came from.
- Add or edit people by hand. Mark someone **Do not contact**.
- **Write the email:** an editor laid out like a real message, with Write/Preview, a word count and live advice
  (length, template phrases, too many links, long subject). The draft saves itself.
- **Attach a resume:** your base resume by default, or any resume from your library, or upload a new one for this job.
- **Send from your Gmail** after a confirmation showing exactly who gets what. Sending is blocked by hard problems
  (no address, a Do not contact person, an unfilled placeholder, the daily limit) and warns on softer ones (an
  unverified address, a repeat email, outside your usual sending hours).
- **Sent history** per job, with the exact resume that went out, and "Use as a new draft" to adapt one.

### Quick links

- Your own list of bookmarks for the job search (job boards, saved searches, portals), grouped, with notes, showing
  which ones you have already opened today.

### Settings

- **General:** health checks for the database and the AI provider.
- **Email:** connect Gmail, set sending rules (daily limit, days and hours), writing defaults and extra banned phrases,
  turn the automatic email lookup on or off, and check the contact-finder keys.

### Behind the scenes (in progress on this branch)

- Every resume that enters the app (base, uploaded for a job, past) is indexed for search in the background, so future
  writing can reuse your real wording for similar jobs. Nothing uses this yet from a user's point of view, except the
  index status shown on the Profile page and the attach panel.

## 6. User stories (built)

**Profile**

- As a job seeker, I can upload my resume and get an editable structured profile, so I do not retype my history.
- I can set my preferences (roles, locations, salary, sponsorship, exclusions), so the app knows what I am after.
- I can write generation instructions (tone, length limits), so future generated content fits my template.
- I can import past resumes, so the app can learn from what I wrote before.
- I can see and restore earlier versions of my profile.

**Capturing jobs**

- I can paste a job link and get a structured job record without copying anything by hand.
- I can paste many links at once and keep working while they are processed.
- I can paste the job text when a site cannot be read automatically.
- I can review and correct anything the app was unsure about before it is saved.
- I can edit a saved job's details at any time.

**Tracking**

- I can see all my jobs in one table and filter by stage.
- I can move a job through its stages, one at a time or in bulk, and undo a mistake.
- I can keep notes on a job and see its full status timeline.
- I can see on the dashboard which applications have gone quiet and need a nudge.
- I can export my jobs to CSV.
- I can copy a job as Markdown, or open it in Claude, to get help with my application elsewhere.

**Companies**

- I can see what a company does and what it values before I apply or write to them.
- I can keep my own notes on a company, shared across all its jobs, and the app never overwrites them.
- I can merge duplicate companies and link a brand to its parent.

**Outreach**

- I can find the best person to email about a job, with a reason for the ranking.
- I can find someone's email address cheaply and see how much to trust it.
- I can add a contact myself and mark people I must not contact.
- I can write an email with live advice, and my draft is still there when I come back.
- I can attach the right resume for this job, or upload a new one.
- I can send from my own Gmail, only after seeing exactly what will go out.
- I can see every email sent for a job, with the resume that went with it.

**Utilities**

- I can keep my job-search bookmarks in one place and see which I have checked today.
- I can connect Gmail and set my sending rules once.

## 7. Status by stage

| Stage | What | State |
| --- | --- | --- |
| 0 | Foundations: app, database, AI client, file storage, app shell | Done |
| 1 | Profile: resume parsing, preferences, instructions, past resumes, history | Done |
| 2 | New Application: link or text to structured job, background queue | Done |
| 3 | Jobs tracker and dashboard | Done |
| 3b | Company directory and research | Done |
| 4 | Writing: resume, cover letter, cold email | **Not started** |
| 5 | Learning from past resumes | **Started**: resume indexing built, not yet used for writing |
| 6 | Match score and gap analysis | Not started |
| 7a | Email settings and Gmail connection | Done |
| 7b | Outreach: find people, find emails, compose, attach, send | Done (on `stage-emails`, not yet merged) |
| 8 | Discover: new openings from Fortune 500 and YC | Not started (page is a placeholder) |
| 9 | Global search, more filters, follow-ups, browser extension | Not started |
| 10 | Analytics | Not started |
| 11 | Later: interview prep, reply detection, salary data | Not started |
| Extra | Quick links, Ask Claude, Markdown export, job editing | Done |

Stages were not built in number order: outreach (7) came before writing (4) because sending was the immediate need.

## 8. Roadmap: what comes next

### Stage 4: Writing (the biggest gap)

The app can send an email, but you still write it elsewhere. This stage closes that gap.

- Generate a **tailored resume** per job, section by section (summary, skills, bullets per role, projects), within your
  template's length limits, with "copy section" and "copy all" buttons that paste cleanly.
- Generate a **cover letter** and a **cold email** (short subject, 80 to 150 words) from the same inputs.
- Edit each document in the app, with every save kept as a version. Versions lock when the job is marked Applied.
- An **accuracy check** flags any line that cannot be traced back to your profile.
- Optionally upload the final PDF you made in your template and keep it on the application.
- The cold email drafts straight into the Outreach composer.

User stories: *As a job seeker, I can generate a tailored resume, cover letter and cold email for a job in under two
minutes, edit them, and trust that nothing is made up.*

Spec: [PLAN.md](PLAN.md) (Stage 4),
[cold-email.md](cold-email.md).

### Stage 5: Learning from past resumes (finish it)

- Use the index already built to pull your best past wording for similar jobs into generation.
- Expand the job's keywords with related terms (for example "n8n" also finds "workflow automation", "Zapier").
- Show "References used" on each generated document.
- **Resumes page:** every resume in one place, readable as Markdown next to the original file.
- **Master resume (optional):** one long resume merging everything you have done, in every phrasing, reviewable and
  editable. See [RESUME-LIBRARY.md](RESUME-LIBRARY.md).

User story: *When I write for an automation role, the app reuses what I wrote for past automation roles, and shows me
which resumes it drew on.*

**MVP is complete after Stages 4 and 5:** link in, tailored documents out, informed by past resumes.

### Stage 6: Match score

- A fit score per job (skills, experience, responsibilities, location, preferences) with strengths, missing
  requirements and concerns.
- Hard flags: wrong country, no sponsorship, salary below your minimum, excluded company or role.
- A score column in Jobs and Discover.

User story: *I can see at a glance which jobs fit me best and why, and what I am missing for the others.*

### Stage 8: Discover

- A feed of new openings from Fortune 500 companies (mostly Workday) and Y Combinator startups (Ashby, Greenhouse,
  Lever), refreshed daily, filtered by your preferences and ranked by match score.
- Save moves a job into the tracker; Ignore hides it.

User story: *Each morning I can scan relevant new openings and save the good ones in one click.*

### Stage 9: Quality of life

- **Global search** across jobs, companies, contacts, documents and notes.
- More filters on Jobs: company, score, salary, date.
- **Follow-ups:** a reminder when there is no reply after N days, with a generated follow-up on the same Gmail thread.
- **Browser extension:** "Save job" from any page, including LinkedIn and Indeed.

### Stage 10: Analytics

- Applications sent; response, interview and offer rates; cold email reply rate.
- Breakdowns by role, company and source, and score against response rate.

### Stage 11: Later

- Interview prep and tracking.
- Reply detection from Gmail that updates the job's status (the read permission is already granted).
- Scheduling a send for the recipient's morning.
- Salary data and AI recommendations.
- Extra contact sources (Apollo, Hunter).
- An MCP server so AI assistants (Claude Code, Claude Desktop) can read and act on your job search. Ideas in
  [mcp-jobsearchos.md](mcp-jobsearchos.md).
- Automatic form filling, last, and only with your confirmation.

## 9. Recommended next steps

In order:

1. **Finish and merge `stage-emails`.** Resume attachments, the resume library plumbing and indexing are in the working
   tree but not committed. Run tests, typecheck and lint, try a real send end to end, then merge to `main`. Confirm the
   two unchecked Prospeo calls with a live key (see [STAGE-7B-OUTREACH.md](STAGE-7B-OUTREACH.md#unconfirmed-against-prospeo)).
2. **Refresh the README status table.** It still says Stage 2 is next.
3. **Stage 4, cold email first.** The composer is ready to receive a draft, so generating the cold email gives value
   right away. Then the resume, then the cover letter. Answer open question 1 (template sections and limits) before the
   resume.
4. **Stage 5 retrieval in generation**, then the Resumes page. The index already exists, so this is mostly wiring.
5. **Stage 6 match score.** It is needed before Discover, because Discover ranks by score.
6. **Stage 8 Discover.** Decide the first sources in a dedicated discussion first.
7. **Follow-ups (from Stage 9)**, since outreach without follow-ups leaves replies on the table.

## 10. Open questions

1. **Resume template:** which sections and per-section length limits? This decides the structured output for Stage 4.
2. **Past resumes:** how many, and are the original job descriptions available? This decides how much retrieval can
   help.
3. **Master resume:** when the same role is worded differently in two resumes, keep both or ask you to pick?
4. **Discover sources:** which Fortune 500 companies and which YC filters come first?
5. **Follow-up timing:** after how many days, and how many follow-ups at most?

## 11. Related documents

| Document | What it covers |
| --- | --- |
| [PLAN.md](PLAN.md) | Full technical roadmap: stack, model routing, data model, every stage |
| [STAGE-1-PLAN.md](STAGE-1-PLAN.md) | Profile |
| [STAGE-2-PLAN.md](STAGE-2-PLAN.md), [STAGE-2B-QUEUE.md](STAGE-2B-QUEUE.md) | Adding jobs and the background queue |
| [STAGE-3-PLAN.md](STAGE-3-PLAN.md), [STAGE-3B-COMPANIES.md](STAGE-3B-COMPANIES.md) | Jobs tracker, companies |
| [STAGE-7A-EMAIL-SETTINGS.md](STAGE-7A-EMAIL-SETTINGS.md), [STAGE-7B-OUTREACH.md](STAGE-7B-OUTREACH.md) | Gmail, outreach |
| [RESUME-LIBRARY.md](RESUME-LIBRARY.md) | Resumes page and master resume (planned) |
| [cold-email.md](cold-email.md) | How cold emails should be written and sent |
| [ai-models-for-jso.md](ai-models-for-jso.md) | Choice of AI models |
| [prospeo.md](prospeo.md) | Prospeo API reference |
| [mcp-jobsearchos.md](mcp-jobsearchos.md) | MCP ideas |
