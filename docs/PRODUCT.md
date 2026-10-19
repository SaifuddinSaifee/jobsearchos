# Job Search OS: Product

What this app is, what it can do today, where it is going, and what we build next. This is the functional view: no
code, no schema. For how each piece is built, follow the links to the stage docs and [PLAN.md](PLAN.md).

Keep this file current. When a feature ships, move it from "Roadmap" to "What it does today" and add its user stories.

Last updated: 2026-10-14 (branch `enh-career-records`).

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
- **You know what is true about you.** Writing starts from your career record and assumes you are qualified for the job.
  Anything you tell it you have (a certification, a tool) is worked in, and nothing is refused. The record itself only
  ever holds words from your own documents. Guessed emails are labelled as guesses.
- **History is kept.** Profile saves, job snapshots and attached files are never changed after the fact, so you can
  always see exactly what was used for an application.
- **Cheapest reliable source first.** Public APIs before scraping, free lookups before paid credits, and the app tells
  you what a lookup cost.
- **Work survives the tab.** Slow tasks (reading postings, finding people, reading resumes) run in the background and
  keep going if you leave the page.
- **Private by default.** Data lives in your local database and disk. The exception: AI calls send their input (resume
  text, job pages) to Together AI, and Gmail, Tavily and Prospeo receive what they need. If you turn on Phoenix tracing
  (optional), the prompts and replies of AI calls are also kept in your own local Phoenix; they never go anywhere else.

## 5. What it does today

The sidebar has: **Dashboard, Jobs, New Application, Quick links, Companies, Library, Discover, Profile, AI usage, Settings.**

### Profile

- Upload your resume (PDF or DOCX). The app reads it and fills a structured profile: experience, skills, projects,
  education, certifications, achievements. You review and edit it.
- **Preferences:** target roles, locations, remote/hybrid/on-site, minimum salary, countries, visa sponsorship,
  preferred technologies, excluded roles and companies.
- **Generation instructions:** your style rules, tone and per-section length limits, ready for when the app writes for
  you.
- **Base resume:** importing a resume file here also makes your base resume in the Library, from the profile you reviewed.
  Past resumes now live in the Library.
- **Version history:** every save is kept; you can look back and restore an older version.

### Adding jobs (New Application)

- Paste one job link, or many at once. They are processed in the background, two at a time, and a tracker in the
  sidebar shows progress. You can leave the page.
- Works with the common applicant tracking systems (Greenhouse, Lever, Ashby, Workday, SmartRecruiters, Workable) and
  ordinary career pages, including ones that need a browser to render.
- For sites that block automated reading (LinkedIn, Indeed), paste the job text instead.
- Y Combinator's Work at a Startup pages are read from the data behind the page, which includes parts the page hides
  when you are logged out: the company's tech stack, the full skills list, the application questions and the founders.
- The app pulls out company, title, location, remote type, employment type, salary, posted date, responsibilities,
  requirements, technologies, keywords, and extra details such as benefits and the interview process.
- It also pulls out **how to apply**: any instruction in the posting beyond the usual apply button, such as "do not
  apply on LinkedIn, use this Google Form", "email your resume to this address with this subject line", what to
  include (portfolio, expected salary, an answer to a question), deadlines, and things to avoid ("do not DM the
  founders"). Each note is marked as where to apply, what to include, a deadline, or other, with its link or email
  address. You can edit them on the review screen.
- Keywords aim to be the full list a resume should match (usually 25-60): every technology, the posting's named focus
  areas, domains, practices, role type and stage, and the working traits it asks for.
- Clean results save automatically. Doubtful ones wait for your review.
- Duplicates are detected, so the same job is not saved twice.

### Jobs (the tracker)

- A table of every job, with tabs: **Active, Saved, Preparing, Applied, Interviews, Offers, Closed.**
- Search, filters, sorting, column choice, pagination and CSV export.
- Change status inline, per row or in bulk, with Undo. Marking a job Applied records the date.
- Statuses: Saved, Preparing, Applied, Recruiter Screen, Interview, Technical Interview, Final Interview, Offer,
  Rejected, Withdrawn, Ghosted. Every change is recorded on a timeline.
- A side panel per job: links, status, applied date, notes, details, requirements, responsibilities, keywords, timeline
  and the original posting text. Its header has a toolbar (previous and next job, and **Edit**), the title with
  company, location and salary, and one row of actions in the same place for every job: **Generate resume**, **Open
  job posting** (and the application page when it differs) and **Email a contact**, then icon buttons with tooltips at
  the end of the line: Ask Claude, Copy as Markdown, Download Markdown, Refetch and
  Delete. A highlighted **How to apply** box sits right under them, grouped
  into labelled rows (Apply via, Include, Deadline, Also note), with the form links and email addresses clickable and
  each email address copyable. Jobs saved before this existed offer **Check the posting for how to apply**, which
  reads the saved posting text once.
- In the table, a job with instructions on how to apply shows a highlighted icon next to its links ("Read how to apply
  first") that opens the job. Move to the previous or next job without closing it. Each job has its own link.
- Edit any job's fields by hand.
- **Refetch a job** from the row menu or the side panel: gets the posting again and replaces the job's details with a
  fresh extraction, for when the posting changed or the extraction got better. Status, notes, documents and the
  company profile stay as they are. A pasted job reads its saved text again. If the site cannot be fetched (the
  posting was taken down), the app says so and offers **Use saved text** instead; a job-board posting that is gone is
  never replaced by whatever page the link now shows. **Undo** puts the previous details back.
- **Copy or download a job as Markdown**, including the company profile, for use in any AI tool.
- **Ask Claude:** opens a claude.ai chat with the job already loaded and a prompt to tailor your resume and cover letter
  and point out gaps.
- Keyboard shortcuts: `/` search, `j`/`k` move, `Enter` open, `x` select, `Shift+A` mark Applied, `Esc` close.
- A **Documents** section in the side panel lists every resume and cover letter linked to the job, each opening in the
  editor. The row menu has **Resume for this job**.

### Writing a resume for a job

Nothing is written when a job is saved. When you want a resume for a job, you ask for it, from the job's side panel
(**Generate resume**), from the row menu, or from the **Generate resume** button on the "Saved" toast after a pasted
link. It is written from your career record (or from your base resume while the record is empty). Matching the job
against your record takes under a minute or two; writing, reviewing and revising takes a few minutes more. It ends in the
editor.

- **A page per job** (`/jobs/<job>/resume`), so it survives a reload and leaving. A sidebar card and toasts say when the
  match is ready to look at, when the resume is ready, or when it failed. **Stop** cancels it.
- **Where the time goes.** The page lists each step with how long it took: reading, matching, the first draft, the review
  (with its score), the review's edits (or "nothing needed"), and saving. The running step's time counts up, and a
  total shows below, not counting the time you spend on the match. The same list stays on the page once the resume is
  ready, has failed or was stopped. If the first draft thinks for too long it is stopped and written again with less thinking;
  the draft step and the resume's notes say it was a fallback, so you know to read it with that in mind or write it
  again.
- **Match first.** Everything the job asks for (must haves, nice to haves, the posting's keywords and the company's
  values) is lined up against your record: **In your record**, **Partly in your record** or **Not in your record**, with
  the lines of your record behind each. Short terms like a tool name are found directly; the rest are judged by the AI,
  which can only point at items of your record, not write evidence. In the same pass the AI says what each item is: an
  **experience**, a **skill** (a tool or technical area), a **field** (the kind of product or audience, such as "Books
  apps"), a **way of working** ("Adaptability") or a **condition** ("willing to relocate"). That decides where it may go on
  the resume: skills go in bullets and the skills lines, a field is at most a few words in the summary, a way of working is
  shown by what you did and never named, and a condition is left off (it sits under **Not on the resume** and does not count
  toward the match). It also names the 3 to 5 requirements the job is really about, marked **Core**: they count most when
  the resume is written, and a way of working counts little.
- **The title each role is written under.** A role your record tells more than one way (Fullstack Software Developer and
  Product Manager for the same job) shows under **Write each role as**, with the recommended telling chosen: the one that
  fits the job's title (a "Product Engineer" is an engineer) and proves the most of what the job asks for. Pick another and
  the resume is written from that telling. A choice is remembered when the same job is written again.
- **When your record disagrees with itself.** If one achievement is told with different numbers in different documents
  (activation up 45% in most, 18% in one), **Your record says this more than one way** shows the versions with the numbers
  in bold and recommends the one most of your documents give. The resume uses the one you pick and leaves the other out,
  and your pick is remembered for every later resume.
- **You are taken to be qualified.** Whatever the record does not fully show of the experience and skills the job asks for
  (its must haves and nice to haves) starts out ticked as **I have this**, because a record is usually shorter than what you
  have done. Untick what you would rather leave out, and add a note where it helps ("AWS certified, 2023"). Your ticks and
  notes, including notes added to what the record already shows, come back the next time you write a resume for the job. Each ticked
  item with a note is proven on the page: written as work you did, in a bullet under the role your note places it in, with
  that role's real product and tools and the specifics of your note, with no invented numbers, certifications or degrees.
  A ticked item with no note is listed in your skills, or named inside a bullet whose own lines show that work; it never
  gets a bullet of its own or a place in the summary, and the screen says so under it ("Say where you did it and the
  resume shows it as work"). A **Core** item opens a note field ("One line on how you do this makes the resume
  more believable"), and **Add detail** does the same for anything already in your record. Something your record has
  only in its skills list, with no line telling of work with it (MCP), is marked **Only in your skills** with its note
  field open: "Anything you have built with MCP? Say where, and the resume shows it as work". It is optional; without a
  note the resume lists it in the skills section and nowhere else. **Keywords are your pick** and start unticked, as do fields, ways of working,
  the company's values and conditions: tick the ones you want in. The footer shows "Your record covers 76%. With what you
  have: 100%", which updates as you tick. **Don't show this step again** skips the match screen from then on, and the
  experience and skills are then taken as yours without asking (a switch in Profile, under instructions, turns the screen
  back on).
- **Written for the job.** The most recent roles, each under the title that fits the job. Only the facts you worded for that
  title are used (an engineering job gets your engineering facts, not your product ones; a role with nothing for that title
  keeps all its wording so it is never missing; a fact the job's core rests on is used whatever title it was worded for),
  chosen for what they answer of the job and how much they prove: a line with a measured result, or one that says how the
  work was checked (tests, an eval, an accuracy number, an approval step), is never lost to one that only names the right
  things, and of a fact's versions the one with the result comes first. The bullets go to the roles by how much each has
  for this job, not by a fixed share for the latest: about 14 in all, so a role with most of the job's evidence gets most
  of them (8, 4 and 2 for the Great Question job), and no role gets more than it has facts or fewer than one. A
  project's versions that prove the most are offered, not its first ones. Each recent role opens with a bullet that proves one of the job's core requirements, a bullet leads
  with its result where you gave one ("Increased activation by 45% by..."), and words that add tone but no evidence are cut.
  One bullet tells one story you did: a line of yours that joins two results becomes two bullets, or keeps the one that
  matters. Length follows importance: the bullets that answer the top requirements carry the full detail and may run to
  about three lines, the rest stay to one or two. The summary is up to three sentences: what you are, in plain
  words (never the posting's title); your strongest measured result (chosen in code, one result per sentence) with what
  you built that answers the job's core; and how you work, only from your note or a line of yours that says it (with
  neither, it is left out rather than written generically). It names only what the bullets show: a tool found only in
  your skills list stays in the skills section. Education is
  one entry per school (repeats of the same school written different ways are one), without high school and board exams
  once there is a degree; certifications are cleaned of repeats. The skills section is written from your record by code, not
  the model: your own categories (a catch-all like "Technologies" gives its skills to the categories they belong to; a small
  category such as "Product & Media" is folded away), skills split mid-bracket or said twice left out, the job's skills
  first in each line, about 36 in all, with what you ticked placed next to the skills it is like. A product area you worked
  on ("Video streaming") is proven in a bullet, never listed as a skill. Projects that answer the
  job are included. Employers, titles, dates, schools and certifications are copied
  from your record, never written. Your Profile's tone, style rules and section limits are followed, and generic wording
  such as "passionate", "leverage" or "results-driven" is rewritten. Each bullet remembers which facts it came from.
- **Made to pass applicant tracking, without stuffing.** The writing rules come from the job application skill (`SKILL.md`):
  the posting's own terms in its own spelling, an acronym spelled out once, each bullet an
  action and a result, the company never named in the resume, and no responsibility line of the posting copied in. The
  terms it is asked to use are only the tools and skills you have (shown in your record, or ticked by you), each used once
  where it fits. After writing, the resume is checked in code for the signs of writing for a keyword scanner: wording
  copied from the posting or the company's own text, a term used in more than three places, or a way of working named
  outright. If it finds one the writer is asked once more. The notes say which terms were worked in, and skills are ordered
  with what the job asks for first.
- **Your words, edited, then reviewed.** The writer (GLM-5.3, thinking at high effort) starts each bullet from your own
  wording in the record and changes only what the job needs: the posting's spelling of a term, something you ticked, a
  cut, a reorder. It keeps your names and numbers and never adds a result you did not write ("so that the team..."). A
  second model (DeepSeek V4.1 Flash) then reviews the draft like a hiring manager would, against eleven criteria (faithful to the record,
  sounds like you, specific, no invented results, proves what the job is about, answers the job, terms placed naturally,
  varied rhythm, a summary with a point of view, clean, skills), and the writer makes the edits that matter. Code also flags a
  job term worn as a label ("On realtime voice agents, ..."), anything you have with a note that no bullet shows, a tool
  the summary names that no bullet shows, and a bullet that tells two results joined by a semicolon. Code
  checks the same things and puts back to your own words any bullet still rewritten beyond recognition, or one the
  revision moved a tool into from other work. The notes show the review's score. A draft that runs too long is not thrown
  away for a format slip; a stuck model call is cut off early and asked once more with less room; a job you stop is never
  retried.
- **Your wins, your interests, your conditions.** Achievements from the record (a hackathon win) are always on the
  resume. An interest the job asks about ("into fandom or fanfiction") is yours to tick, with a note for the specifics; it
  becomes one short **Interests** line and is never claimed if you did not tick it. A condition such as relocating can be
  ticked as **Mention it**, with a note on how you meet it, and goes in the header next to your contact details ("Open to
  relocating to Toronto"); a longer one closes the summary instead. Where the job is ("Canada, Remote") is listed as a
  condition too, and when the job sets a location you have not answered, a header location that is only a way of working
  ("Remote") is left out rather than shown beside a phone number from another country. Certifications and achievements
  each sit on one line, the items an even space apart with a divider between them, which every text extractor tried
  (pdftotext, unpdf, Word's text) reads in order; an item too long for the line moves whole to the next one.
- **Links that work.** The name and contact line come from your Profile, then your resumes; a link shown as a label
  ("GitHub") keeps its address.
- **Length is yours to set.** A resume written for a job is not squeezed to one page: its length follows the bullets above,
  and you trim it in the editor (the editor's **Keep to one page** switch still works there).
- **One resume per job.** It is saved in your Library, linked to the job, and the job then offers **Open resume**. The job moves
  from Saved to **Preparing** when writing starts (with Undo); a job already past Saved is left alone.
- **Write it again** from the editor (**Regenerate**, shown above any resume written for a job): it is matched again, with your
  earlier "I have this" answers filled in, and saved as the next version of the same resume. Your current version, edits
  included, stays in the version history, and a version already sent with an application is never changed.
- **Connected.** An email for that job starts with this resume attached instead of the base resume. Marking the job Applied
  locks it like any document. **Add to career record** (see Career record) adds it with one click if you want the record to
  remember it.
- The AI usage page shows it as "Write a resume for a job", with two steps: matching the requirements and writing the resume.

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
- **Format it:** select text for a small toolbar with bold, italic, underline and link; the link button opens a field to
  paste the address, so "My proposal (GitHub)" can link to the page. Web addresses you type or paste become links on
  their own. A formatted email goes out with an HTML version and a plain-text copy (a link reads "text <address>" there);
  an email with no formatting goes as plain text.
- **Attach files:** as many as the email needs (up to 10, 5 MB in total). Your base resume is attached by default; add
  any resume or cover letter from your Library, upload a new resume for this job (it is filed in the Library under the
  job), or upload other files for this email alone, such as a proposal or a writing sample (PDF, Word, text, Markdown,
  slides, spreadsheets or images; they go exactly as uploaded and are not added to the Library). An uploaded resume
  nobody has edited goes out as that exact file, so your own formatting is untouched. Anything else from the Library goes
  out as a PDF made at the moment you send (a cover letter's file name ends in "Cover letter"). Attachments go in the
  order you added them, and the confirmation shows each file's real name, size and page count.
- **Send from your Gmail** after a confirmation showing exactly who gets what. Sending is blocked by hard problems
  (no address, a Do not contact person, an unfilled placeholder, the daily limit) and warns on softer ones (an
  unverified address, a repeat email, outside your usual sending hours).
- **Sent history** per job, with every file that went out (and a link to each Library version), and "Use as a new draft"
  to adapt one (it keeps the same attachments).

### Library

Resumes, cover letters and emails, kept as text you can read and search, not as files.

- Four tabs: **Resumes, Cover letters, Emails, Career record** (see Career record, below). Each document shows what it is for (job and company), its date, where it
  came from, how many versions it has, and (for an uploaded resume) whether it is still being read into sections.
- **Add** a document three ways: upload a PDF or DOCX, paste text, or start blank (a resume can start as a copy of your base
  resume). Link it to a job, and add the role, date and the job description it was written for.
- An uploaded resume is read into headings, bullets and sections, then the AI structures it in the background (roles with
  title, company and dates) and saves that as a new version. Text the AI has no place for (Publications, Languages) is kept.
  If you edit it before that finishes, your version is left alone. Uploading the same file twice is caught.
- A **document page** is where you read and write it (see Editor, below), with its version history (view any version,
  restore one as a new version), its details (editable) and **Copy Markdown**.
- **Export** any document as **PDF, Word (DOCX), Markdown or plain text** (emails: Markdown or text). Files are named
  "Name - Company - Role". A PDF or Word export is first saved as a version, so you can always find exactly what you sent.
- **Base resume:** the one marked Base is attached to emails by default. Make any resume the base from its menu.
- **Emails you send** appear in the Emails tab on their own, locked, so they cannot be changed or deleted afterwards.
- Anything sent or used in an application is **locked**: marking a job **Applied** locks the resume and cover letter
  written for it (unsaved edits are saved as a version first), and a sent email locks every resume and cover letter version it carried.
  Locking is never undone, not even by undoing the status. You can still edit; the edit becomes a new version.
  Deleting hides a document from the library and search, and is refused for anything locked.
- Your earlier past resumes, base resume and sent emails were moved into the Library automatically.
- Uploads are read into text and the file is not kept. A file is stored only when it leaves the app as an email attachment.

### Career record

One record of everything you have done, merged from your resumes, cover letters, the Profile and a LinkedIn profile saved
as a PDF. It lives in the **Career record** tab of the Library. It has no length limit and is never sent anywhere. It is
the base the writer will use to pick the right facts and wording for a job.

- **Export as Markdown.** **Export** (next to Versions) downloads the whole record as one structured Markdown file
  ("Career record - date.md"): each employer and role with its dates, the titles it was told under, every fact with all
  its wordings, then skills by category, projects, education, certifications, achievements and reasons for applying.
  Internal ids, sources and removed items are left out. It is the record as it is now; nothing is saved or sent.
- **You choose what goes in.** Nothing is added on its own, and nothing is sent to the AI until you add it. The tab
  lists **Not in your record**: every resume and cover letter that is not in the record and would add something to it,
  with what it would add, worked out for free by comparing words ("2 of 4 bullets are already in your record. New: 2
  bullets, a job (Junior Developer at Initech, Jun 2018 to Dec 2019) and 1 skill."). Tick the ones that belong (or
  **Select all**) and choose **Add to record** (added as suggested, one after another, no review) or **Review each
  first**. A document whose content is all in the record already is not listed; when nothing is left to choose, the
  tab says so, with how many documents are in the record and how many were left out. **Never** takes a document off the
  list for good; the documents set to never are listed apart, with **Ask again**. The first build is the same list.
- **Include Profile** and **Add LinkedIn PDF** add those two by hand (save your LinkedIn page as a PDF from the browser's
  print dialog; only its text is kept, never the file). Once a record exists, a saved Profile is offered for review on
  its own.
- **Progress in the sidebar.** While sources are being prepared, a card in the sidebar (on every page) shows which one
  is being read and how many of the batch are done. When one is ready, the card says so (with how many wait after it)
  and opens the review, and a toast with a **Review** button appears wherever you are. Only one source is prepared ahead
  of your review, so the next starts after you save; sources added with one click go straight through. Failures show
  on the card and as a toast too.
- **Skip a source for now.** **Stop and skip** (on the sidebar card and the Career record tab) stops the source being
  read, cancelling its model calls, and starts the next one. **Review later** does the same for one waiting for review,
  keeping your choices so far. A skipped source is not reviewed and not in the record: it is listed under "Skipped, not
  reviewed yet" with **Prepare** to queue it again (adding it from the editor does the same) and **Leave out** to drop
  it for good (it is not offered again, but you can still add it by hand from the editor). A new version of its
  document replaces it as usual.
- **After a restart.** A source that was being read when the server stopped is queued again as soon as the server
  starts, so it never shows as in progress when nothing is working on it.
- **When a source fails.** The record tab names the sources that could not be prepared, with **Try again** and
  **View details**. Details opens a dialog with each failure taken apart: the plain reason, when it failed, attempts, the
  step that failed and, for model errors, the HTTP status, error type, code, parameter and request id, plus the raw
  error. Copy one failure or **Copy all** as plain text to share or debug.
- **Review, when you ask for it.** For each source you chose to review, you see every employer, role and bullet with a suggestion: new,
  the same role, a new **framing** of a role you already have, the same fact worded differently, or already in your
  record. You can include or leave out anything, move a role under another role or framing, say which fact a bullet
  belongs to, and see in words what saving will add. Your choices are saved as you go. Saving makes a new record version.
- **Framings.** The same employer and dates under a different title (Product Manager in one resume, Software Engineer in
  another) is one role with two framings. Each framing keeps its own title, angle and the roles it was written for, and
  facts are shared, so one fact can hold a PM wording and an engineering wording. A promotion that overlaps by a month
  stays a separate role. Dates widen to cover every source; a disagreement becomes a note, never a block.
- **Browse and edit.** Employers, then roles (with a filter by framing), then facts, then wordings, each with the
  documents it came from (linking to the exact version). Search the whole record. Edit a wording, add a fact or
  wording, move a wording to another fact, merge facts, edit dates and location, add or edit a framing, split a
  framing off as its own role, merge roles, rename or delete an employer, and manage skills and achievements.
- **Your edits win.** Anything you change is marked "Edited by you" and a later merge never overwrites it. Something you
  delete is proposed as "left out" the next time it appears, with "You removed this before".
- **Versions.** Every merge, edit and restore is a new version; restoring an old one saves it as a new version and marks
  the merges since as undone, so you can review them again.
- Employers are linked to the Companies directory when a company of that name exists. Nothing is created there.
- **Reworded bullets.** A bullet that matches nothing exactly is put to the AI, which only chooses whether it repeats a
  fact you already have (or another new bullet); it cannot write or change text. If you move a role under a different
  role, "Compare bullets with this role" re-checks its bullets against it.
- **Cover letters.** Each paragraph is labelled a story about a job (kept under that role and fact), a reason for
  applying to the company (the company is the one the letter is linked to), a general reason, or filler that is skipped.
  You can change any label, role or fact. Reasons are listed under "Reasons for applying".
- A resume with no structure is read by the AI before it is compared. Merges never rewrite text: every wording is word
  for word from its source.
- **From the editor.** A resume or cover letter that is not in the record shows a short card above the page: what
  adding it would bring (the same free summary), with **Add to record** (one click, no review), **Review first**, **Not
  now** (hides the card until the next version) and **Never for this document**. The header always has **Add to career
  record** (adding overrides Not now and Never), and shows "Adding to career record" while it is added, then "In career
  record", with a toast when it is done (or a **Review** button when it waits for review). Adding saves what is on the
  page as a version first, so the record gets exactly that. Use it for a resume you have polished and want the record
  to remember, including one tailored for a job. Saving a document never adds it to the record or calls the AI.
- A source that turns out to add nothing once it is read (every bullet is already there, the dates and the role it was
  written for are noted) is left out without asking, with a note.

### Editor

Open any document and write on it, like Notion on a real sheet of A4.

- **Type anywhere.** Enter moves through a role (title, dates, company, location) and into its bullets; Enter on an empty
  last bullet starts the next role; Tab indents a bullet (two levels) and moves between fields. Backspace never merges or
  deletes text by accident. `- ` starts a bullet list and `## ` starts a section.
- **Slash menu:** type `/` on an empty line to add a role, project, education entry, skills line, bullet list, text, a new
  section or a divider. It is narrowed as you type, and it does not open for a slash in the middle of a sentence ("AI/ML").
- **Selection toolbar** over selected text: bold, italic, underline, link. Ctrl or Cmd with B, I, U also work.
- **Handle in the margin** beside whatever you point at (a bullet, a role, a whole section): drag it to reorder, click it
  for Duplicate, Move up, Move down, Delete, or press the plus to add below.
- **Outline** (toolbar): the sections and entries, to jump around by.
- **Record** (toolbar, resumes): a panel that shows your career record's wording for the role the cursor is in. It lists
  the facts of that role with each wording (and cover letter stories), marks what is already on the page, and has an
  **Insert** button that adds the wording as a bullet at the end of that role (Undo takes it back). By default it shows
  only wordings that fit the title on the page (for example the engineering wording on an engineering resume); untick the
  box to see the others too. If the record has nothing for the role, it says so.
- **Saves as you type**, and a checkpoint is made when you choose **Save version**, export, attach to an email or apply.
  If the same document is changed in another tab, it tells you instead of overwriting it. Ctrl or Cmd with S saves now.
- **Page settings:** font (Calibri, Arial or Times style), spacing, **margins (Narrow half inch by default, Normal, Wide)**,
  accent colour, and fine tuning in exact numbers. Body text is justified (the header stays centred, dates stay on the
  right), in the editor and in the PDF and Word exports alike.
- **Keep to one page** is a switch (on by default). On: a line shows where page one ends, the toolbar says "Fits on one
  page" or how many lines it runs over, and the spacing tightens as you write so it stays on one page. Your words are never
  cut, and if it still cannot fit it says which sections are longest. Off: no limit, no warnings.
- Editing is for screens at least tablet wide; on a phone you can read and export.
- Not built yet: dragging in the outline, turning a block into another kind, a zoom control.

### Quick links

- Your own list of bookmarks for the job search (job boards, saved searches, portals), grouped, with notes, showing
  which ones you have already opened today.

### AI usage

- Every AI call the app makes is recorded with its numbers only: which step and action it was for, the model, tokens
  (including the model's thinking), cost, time and whether it worked. The text of prompts and replies is not stored.
- **Headline numbers** for the last 7, 30 or 90 days: spend (with all-time spend beneath it), calls and failures,
  tokens, and typical call time. If a model has no known price its calls are counted but left out of the spend, and
  the page says how many.
- **Spend per day** as a chart you can hover, or as a table.
- **Where it went**, by action (adding a job, reading a resume, researching a company, finding people, writing a resume), by step, or by
  model, with the cost of one action on average.
- **Failures** with what went wrong, and the **latest calls**, each linking to the job, company or document it was for.
  A call you stopped is shown as stopped, not as a failure.
- With Phoenix running, each call also has a trace there (the full prompt and reply), and an **Open Phoenix** button.

### Settings

- **General:** health checks for the database and the AI provider.
- **Email:** connect Gmail, set sending rules (daily limit, days and hours), writing defaults and extra banned phrases,
  turn the automatic email lookup on or off, and check the contact-finder keys.

### Behind the scenes

- An uploaded resume with no sections is read into sections by the AI in the background (once per upload). Resumes are
  no longer embedded for search: the career record is what writing will draw on. Its reading status is shown in the
  Library, on the Profile page and in the attach panel only while it is being read, or if reading failed.

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
- I can attach several files to one email, such as my resume, a cover letter and a proposal the posting asks for.
- I can make words bold, italic or underlined, and turn a phrase into a link, by selecting it.
- I can send from my own Gmail, only after seeing exactly what will go out.
- I can see every email sent for a job, with the resume that went with it.

**Library**

- I can keep every resume, cover letter and email as readable text, and find them again by job and date.
- I can upload a resume and get it split into roles and bullets without retyping it.
- I can see older versions of a document and bring one back.
- I can tell which documents went out, because they are locked.

**Utilities**

- I can see what the AI calls cost, which actions spend the most, and which calls fail.
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
| 4a | Library, editor and export, career record, fit score | **Library, editor and export done**; **career record built** (resumes, Profile, LinkedIn and cover letters, review, grouping, browse and edit, editor panel); fit score not started |
| 4 | Writing: resume, cover letter, cold email | **Resume built** (written on request from a job, in the editor); cover letter and cold email not started |
| 5 | Learning from past resumes | **Replaced** by the career record: resumes are no longer embedded; the record is what writing will draw on |
| 6 | Match score and gap analysis | Not started |
| 7a | Email settings and Gmail connection | Done |
| 7b | Outreach: find people, find emails, compose, attach, send | Done (on `stage-emails`, not yet merged) |
| 8 | Discover: new openings from Fortune 500 and YC | Not started (page is a placeholder) |
| 9 | Global search, more filters, follow-ups, browser extension | Not started |
| 10 | Analytics | Not started |
| 11 | Later: interview prep, reply detection, salary data | Not started |
| Extra | Quick links, Ask Claude, Markdown export, job editing, AI usage page and call tracing | Done |

Stages were not built in number order: outreach (7) came before writing (4) because sending was the immediate need.

## 8. Roadmap: what comes next

### Stage 4a: Career library, editor, career record, fit score (library and career record built, fit score next)

Groundwork for writing. Plan and build notes: [STAGE-4A-CAREER-LIBRARY.md](STAGE-4A-CAREER-LIBRARY.md). The **Library**, **editor**
and **export** (first and last bullets) are built; the career record and fit score are next, in that order.

- **Library (built):** every resume, cover letter and email stored as text, versioned, editable in the editor, exportable.
- **Career record (built):** one "mega resume" of every employer, role, fact and wording across all your resumes,
  including the same job framed differently (PM in one resume, engineer in another). Merges are proposed and reviewed,
  never silent. **Built:** the record and its versions, merging resumes, cover letters, the Profile and a LinkedIn print
  with review, framings, AI grouping of reworded bullets, browsing and hand edits, choosing which documents go in (with
  a free summary of what each adds, and a one-click add from the editor), and a panel in the editor to reuse its wording. **Not yet:** the Profile still reads its own
  experience (it becomes "the default selection from the career record" once the record is trusted).
- **Fit score:** how well a resume matches a job and its company, with missing keywords split into "you have it, this
  resume does not show it" and "real gap".
- **Editor (built):** a Notion-like editor on a real A4 page, with one-page PDF, Word, Markdown and text export from the
  same layout.

### Stage 4: Writing (resume built, cover letter and cold email next)

The **resume** is built (see "Writing a resume for a job" above). Next, the same path for the other two documents, always on
request from a job, with the company profile counted as part of the job:

- A **cover letter**, written from your career record's stories and reasons for applying.
- A **cold email** (short subject, 80 to 150 words) that drafts straight into the Outreach composer.
- The **match score and Fix with AI** panel next to the resume (Stage 6, below): a match percentage with why it matches and
  what is missing, a weighted keyword list including obvious inferred ones, and one click to work a gap or keyword into the
  resume, updating the score. It reuses the requirements already stored with each generated resume.

User stories: *As a job seeker, I can generate a tailored resume for a job in a few minutes, see how it matches what the job
asks for, edit it, and write it again when I have added to my career record.*

Spec: [generate-resume.md](generate-resume.md), [PLAN.md](PLAN.md) (Stage 4), [cold-email.md](cold-email.md).

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

1. **Confirm the two unchecked Prospeo calls** with a live key (see
   [STAGE-7B-OUTREACH.md](STAGE-7B-OUTREACH.md#unconfirmed-against-prospeo)).
2. **The score panel with Fix with AI**, beside the resume you just got: match percentage, gaps, weighted keywords, one-click
   fixes. Then the **cold email** (the composer is ready to receive a draft) and the **cover letter**.
3. **Stage 6 match score for jobs.** It reuses the same requirement matching, and is needed before Discover, because Discover
   ranks by score.
4. **Stage 8 Discover.** Decide the first sources in a dedicated discussion first.
5. **Follow-ups (from Stage 9)**, since outreach without follow-ups leaves replies on the table.

## 10. Open questions

1. **Resume template:** answered for resumes: the editor's one page, with limits from your Profile's instructions.
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
| [STAGE-4A-CAREER-LIBRARY.md](STAGE-4A-CAREER-LIBRARY.md) | Library, editor and export (built), career record, fit score (planned) |
| [RESUME-LIBRARY.md](RESUME-LIBRARY.md) | Earlier note on the Resumes page and master resume (replaced by Stage 4a) |
| [cold-email.md](cold-email.md) | How cold emails should be written and sent |
| [ai-models-for-jso.md](ai-models-for-jso.md) | Choice of AI models |
| [LLM-LOGGING.md](LLM-LOGGING.md) | How AI calls are recorded and traced, and the AI usage page |
| [prospeo.md](prospeo.md) | Prospeo API reference |
| [mcp-jobsearchos.md](mcp-jobsearchos.md) | MCP ideas |
