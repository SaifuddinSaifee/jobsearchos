# Stage 7b: Outreach (contacts and sending)

A page per job to see who the email goes to, find the right person, edit the email and send it from your Gmail.

Status: built. The email text itself still comes from your own workflow; this stage handles the recipient and the sending. Generation inside the app is Stage 4.

Open it from a job: **Email a contact** in the job slide-over, or go to `/jobs/<id>/outreach`.

---

## The page

- **Header:** the job, and which Gmail address mail will be sent from (a warning link to Settings when Gmail is not connected).
- **Who to email (left):** ranked people with their title, role in hiring, email address and how trustworthy it is, why they were ranked there, and where they came from. Click one to make them the recipient.
- **Email (right):** From, To, Subject and body like a real message, a Write and Preview toggle, a live word count, and a list of checks. Pasting a whole email whose first line is `Subject: ...` fills the subject for you. The draft saves itself, one per job, and is still there after a reload.
- **Sent for this job:** every email sent from here, expandable, with "Use as a new draft" to adapt one for someone else.
- **Send** opens a confirmation showing exactly who gets what, from which address, and any warnings.

## Finding people

**Find people** runs in the background, the same way adding jobs does ([STAGE-2B-QUEUE.md](STAGE-2B-QUEUE.md)). The click queues a search and returns at once; the app's worker does the rest, so changing page or closing the tab does not stop it.

- **On the page:** a step list shows the posting, web search, Prospeo and ranking as they run. When it finishes, the people appear without a reload, and a line under the buttons says what the last search found, with any notes.
- **Elsewhere in the app:** the sidebar shows a "Finding people" card with the job and the current step, and a toast tells you when it finishes (with an Open button), unless you are already on that job's page.
- **One at a time per job:** a second click, or a second tab, joins the running search instead of starting another. Two searches for different jobs can run together (two at a time, separate from job extractions, so neither waits for the other).
- **Recovery:** a running search sends a heartbeat every 20 s. One silent for 90 s (the server died) is requeued, and failed after 3 interruptions. A search has a 3 minute limit. Only the latest result per job is kept.
- **The three sources run at the same time**, then their results are merged in a fixed order, so the outcome does not depend on which answers first.
- **Restart note:** the worker starts with the server. After updating, restart `npm run dev` once, or searches wait in the queue.

It collects candidates from three places, then ranks them against the role:

1. **The posting:** people it names as a recruiter, hiring manager or contact (a named person beats any lookup result).
2. **Web search (Tavily):** LinkedIn results and the company's own team pages. The model may only list people whose name and company appear in the results, each citing the result it came from.
3. **Prospeo:** search by company website (or name) and job titles aimed at the role: head of, director of, manager of the function, recruiters, founders.

The model then ranks everyone (hiring manager, then founder at a small company, team lead, technical recruiter, recruiter) and writes a one-line reason each. Shared inboxes (`careers@` and similar) are dropped. Each source that fails only adds a note; the others still show. People you add by hand are never touched by a new search.

**Emails:**
- Prospeo's search does not return addresses. **Find email** (see below) fetches one for the person you pick, free sources first.
- For anyone else, type the address in. With the company's website set, the editor suggests the common formats (`first.last@`, `flast@`, ...). These are guesses and stay **Unverified** until you check one and press **Mark as verified**.
- Statuses: Verified, Risky (the server accepts anything, delivery cannot be confirmed), Unverified, Invalid, No email.

### Where people come from, most trusted first

1. **The company's Y Combinator page** (for jobs on workatastartup.com or ycombinator.com): the founders with their **full name, title, LinkedIn URL and bio**, plus the company's real website and team size. Free, one request. This is what turns "Intro call with Ray" in a posting into **Ray Fitzgerald**. The website found here fills in the company's website when it is empty (and never overwrites one you set), so the other sources search the exact domain.
2. **The posting:** people it names as a recruiter, hiring manager or contact. A first name alone ("Ray") is matched to the one person with that first name from the other sources; if two people share it, they stay separate rather than guessing.
3. **Web search (Tavily):** LinkedIn results and team pages. The model may only list people whose name and company appear in the results, each citing the result it came from.
4. **Prospeo:** search by the company's exact website (name only when no website is known) and job titles aimed at the role.

The same person from different sources is merged into one card. The model then ranks everyone, told how each person is known ("founder listed on the company's Y Combinator page", "named in the job posting: ...") and that a team of a handful means a founder is the hiring manager. Each card shows the person's bio and where they came from.

### Finding the email: cheapest source first, stop at the first answer

"Find email" on a card, and the automatic lookup below, try these in order:

1. **Your saved contacts** (free): the same person (same LinkedIn URL, or same name at the same company domain) already has an address on another job.
2. **A public web search** (a Tavily call): addresses the person has published (company pages, GitHub commits, talks, press). Only an address at the company's own domain counts, and only when it looks like the person's name or their name is right next to it. Shown as Unverified with the page it was seen on.
3. **Prospeo** (one credit, charged only when a verified address is found): tried by search id, then LinkedIn URL, then name plus website. A lookup that finds nothing is free.
4. **Format guesses** (free, never saved as facts): `first.last@`, `flast@`, and so on, led by the format already in use at that company (learned from the addresses you hold there). A toast offers "Use this guess"; it stays Unverified.

Each saved address records where it came from (Prospeo, Seen publicly at ..., Saved from another job, Added by you, Written in the posting), and the toast says what it cost. If every source found nothing and Prospeo itself failed (key, credits, rate limit), that error is shown instead of silent guesses.

**Automatic lookup:** after a search, the single best match's email is looked up (Settings, Email, "Find the best match's email automatically", on by default). It runs only when the identity is solid: named in the posting, a Y Combinator founder, or ranked 85 or higher; and only with a full name. At most one person per search, so at most one credit. It is skipped when the person already has an address, or when there is no company website, LinkedIn URL or search id to go on.

## Rules enforced before sending

Checked on every keystroke in the page and again on the server, so a stale page or a hand-made request cannot skip them.

**Blocks sending:** no recipient, no email address, an Invalid address, a person marked **Do not contact** (on any job), no subject or body, an unfilled `[placeholder]`, Gmail not connected or needing a reconnect, or the daily limit reached.

**Warns, and must be acknowledged in the confirmation:** an unverified or risky address, emailing the same person again about the same job, and sending outside your usual days and hours.

**Advice shown beside the editor:** length outside your range, template phrases and long dashes, bullet lists, more than two links, a long subject. Your extra banned phrases from Settings are included.

Sending claims the draft first, so a double click cannot send twice. If Gmail fails, the draft stays with the error. Message and thread IDs are stored for each sent email.

## Setup

Add to `.env`, then restart:

- `PROSPEO_API_KEY` ([prospeo.io](https://prospeo.io)): optional, enables the company search and the paid step of Find email.
- `TAVILY_API_KEY`: optional, enables the web search (already used for company research).
- Gmail: see "Setup: Gmail" in the README.

Settings, Email tab, has **Check key** for Prospeo.

## Data

Migrations `0010_outreach`, `0011_prospeo`, `0012_contact_searches` and `0013_contact_about_email_source`: `contacts` (per job, with rank, reason, source, the finder's id, do-not-contact), `outreach_emails` (one working draft per job, then the sent record with Gmail ids) and `contact_searches` (the background searches, with step progress, result count and notes).

## Not built yet

- Generating the email text in the app (Stage 4) and retrieval from past resumes (Stage 5).
- Follow-ups in the same Gmail thread, and reading replies (the read permission is already granted).
- Scheduling a send for the recipient's morning; the page only warns.
- Apollo or Hunter as extra sources (the finder takes one lookup function, so a second source is a small addition).

## Unconfirmed against Prospeo

Built from the parts of Prospeo's API docs in `docs/prospeo.md`. Not confirmed with a live key: that Enrich Person accepts `data.person_id`, and the `GET /account-information` path used by Check key. If either fails, the message shown is Prospeo's own error.
