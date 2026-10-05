# Cold email: best practices

How jobsearchos should write, address and send cold emails about a job. This is the spec behind Stage 7 (contact discovery and sending) and the cold-email part of Stage 4 (generation). The prompt the writer model receives is derived from this document, so rules here should be concrete enough to check.

Status: draft, to be refined. The writing rules start from the cold-email section of [SKILL.md](../SKILL.md) and add what the app needs: inputs, recipient types, sending, follow-ups and measurement.

---

## Contents

1. [What a cold email is for](#1-what-a-cold-email-is-for)
2. [Inputs the app provides](#2-inputs-the-app-provides)
3. [Choosing the recipient](#3-choosing-the-recipient)
4. [Choosing the angle](#4-choosing-the-angle)
5. [Structure](#5-structure)
6. [Subject line](#6-subject-line)
7. [Voice and banned phrases](#7-voice-and-banned-phrases)
8. [Personalization without faking it](#8-personalization-without-faking-it)
9. [Using past material (retrieval)](#9-using-past-material-retrieval)
10. [Accuracy rules](#10-accuracy-rules)
11. [Variants by recipient](#11-variants-by-recipient)
12. [Follow-ups](#12-follow-ups)
13. [Sending: timing, volume and deliverability](#13-sending-timing-volume-and-deliverability)
14. [Ethics and limits](#14-ethics-and-limits)
15. [Measuring what works](#15-measuring-what-works)
16. [Self-check](#16-self-check)
17. [Examples](#17-examples)
18. [Open questions](#18-open-questions)

---

## 1. What a cold email is for

A cold email has one job: **earn a reply**. It does not make the full case for the candidate; the resume and cover letter do that.

- The reader is busy, reads on a phone, and decides in about 15 seconds.
- People reply to email that is about **them** (their product, their team's problem) from someone who has **visibly done something**.
- The most common failure is a shrunken cover letter: same story, same proof points, same order, fewer words. The cold email gets its own angle.
- Applying through the portal and emailing a person are complementary. The email gets the application looked at; it does not replace it.

---

## 2. Inputs the app provides

The generator receives these, in this priority order. Anything not listed is not available, and the model must not invent it.

| Input | Source | Used for |
| --- | --- | --- |
| Job: title, team, responsibilities, requirements, keywords | `jobs`, `job_keywords` (Stage 2) | The problem the role exists to solve; the role's top need |
| Profile: experience, achievements with numbers, projects, links | latest `profile_version` (Stage 1) | Proof points, sign-off links |
| Company profile: what they do, mission/values, culture, user notes | `companies` (Stage 3b) | At most one personal touch |
| Recipient: name, title, type (founder, hiring manager, team lead, recruiter, engineer), why they were picked | `contacts` (Stage 7) | Variant, greeting, ask |
| Retrieved references: relevant achievements and past emails | retrieval (Stage 5) | Choosing proof points; style reference only |
| Generated cover letter (if any) | `documents` (Stage 4) | Only to **avoid** reusing its hook |
| User instructions: angle, artifact link, things to emphasize | generation form | Override defaults |
| Application state: applied or not, date | `applications` (Stage 3) | The "I've applied" clause |

---

## 3. Choosing the recipient

The right person matters more than the wording. In order of preference:

1. **Hiring manager for that team** (the person the role reports to)
2. **Founder or CEO** at small startups (roughly under 50 people), who is usually the hiring manager
3. **Team lead or senior engineer on the team** (good for a referral or an informed question)
4. **Technical recruiter** for that function
5. **General recruiter or talent partner**

Never send to shared inboxes (`info@`, `careers@`, `jobs@`, `hr@`).

Rules for the contact finder:

- A person named in the posting beats any lookup result.
- Prefer a **verified** address. A guessed pattern (`first.last@`) is a last resort and must be shown to the user as unverified.
- Show **why** each candidate was ranked where it is, so the user can overrule it.
- One person per company per job at a time. Emailing three people at once on the same team makes the candidate look like a mass mailer, and they talk to each other.
- If the first contact does not reply after the follow-up, the next candidate may be emailed, ideally two weeks later.

---

## 4. Choosing the angle

Pick the highest angle the user's material honestly supports.

1. **Proof of work with their product.** The user built something with the company's product, API or SDK, or did a concrete teardown (timed the signup, mocked a fix, wrote an integration). The hook is the artifact, one link and one real observation. Strongest by far; nearly mandatory for dev tools, DevRel and product roles.
2. **Value-first offer.** Offer a small, concrete slice of the job: an audit of one flow, one pipeline for one report, an early take on their take-home. The ask becomes a one-word reply. Only offer what the user can deliver in about a week.
3. **Sharp question or observation.** One specific, informed observation about their product or the problem behind the role, then one line on why the user is worth answering.
4. **Plain direct intro.** Who the user is, why they are writing, why the reader should care, with one or two concrete proof points. Plain beats clever.

The app never invents an artifact, snag or result. If the best angle needs work the user has not done yet, generate it with marked placeholders (`[link]`, `[real snag you hit]`) labelled "send after you build it", plus a second email on an angle that can be sent today. The Send button stays disabled while any placeholder remains.

---

## 5. Structure

- **Length:** 60 to 120 words in the body. Three or four very short paragraphs.
- **Format:** plain prose. No bullets, bold, labels ("What I'd bring:"), images or attachments.
- **First sentence** is about them or a thing: their product, their problem, an artifact. Never "My name is", never the sender's title, never excitement.
- **Why care:** one or two proof points with numbers, folded into a sentence, chosen because they map to the role's top need.
- **Applied clause** (if applied): one clause, for example "I've applied for the Data Engineer role."
- **One ask**, specific and easy to say yes to: a 15-minute call, a one-word choice, or a real question. Never two asks, never "let me know your thoughts".
- **An out** when the reader might be the wrong person: "If you're not the right person, who is?"
- **Sign-off:** first name, then one link (LinkedIn, GitHub or portfolio). At most two links in the whole email.

---

## 6. Subject line

- Generate **two options**, 2 to 6 words, lowercase or sentence case.
- The best look like an internal email or name the artifact or offer: "your onboarding, timed", "one report, on me", "question about search ranking".
- Avoid resume headlines ("Experienced engineer with 8 years"), form titles ("Application for SWE role"), clickbait, all caps, emojis and "Re:" or "Fwd:" tricks.
- Follow-ups reply in the same thread, so they keep the original subject.

---

## 7. Voice and banned phrases

- A sharp professional talking to a peer: plain words, short sentences, the concrete thing instead of the abstraction ("cut support tickets 36%", not "drove impact").
- Personality comes from the specific observation or artifact, not from a tacked-on joke.
- Never use em dashes. Use commas, colons, periods or parentheses.
- Do not paraphrase JD responsibilities into "I do X" sentences.

**Banned phrases** (the code should check for these and flag them, not just ask the model to avoid them):

> I hope this finds you well, My name is, I am writing to, I came across, reaching out, I'd love to connect, Worth a quick chat?, perfect fit, I'm a huge fan, passionate, excited, thrilled, I believe, aligns with, leverage, fast-paced, make an impact, end to end, I am confident that, I know you're busy, pick your brain, Looking forward, I look forward to hearing from you, just checking in, bumping this, circling back

---

## 8. Personalization without faking it

- Use **at most one** company detail, as the hook or inside it. One clause is often enough.
- Pick the detail that connects to the user's experience, not the most impressive-sounding one.
- Never quote their marketing copy or flatter ("your visionary mission").
- No fake familiarity ("I saw your post on LinkedIn!") unless the user confirms it is true.
- If the company profile is empty, personalize from the JD (what the team builds, the problem the role solves). A specific line about the role beats an invented line about the company.
- **Swap test:** delete the company and role names. If the email could go to another company unchanged, it is not personalized enough.

---

## 9. Using past material (retrieval)

What the cold email needs from retrieval is different from what the resume needs. The resume wants phrasing that worked for similar JDs. The cold email wants the **two or three strongest proof points for this role's top need**, plus examples of emails that got replies.

Retrieve, in this order:

1. **Profile achievements and project results** (chunked one per achievement), ranked against the JD and its expanded keywords. These are the facts the email may state.
2. **Past resume bullets** written for similar jobs, as a hint at which achievements were picked before. Facts still come from the profile.
3. **Past sent emails that got a reply** (once Stage 7 has history), as a style reference only. Never copy their hook; the angle must come from this job.

Retrieved items are marked in the prompt as references, not instructions. The document shows "References used" so the user can see what the model drew on.

---

## 10. Accuracy rules

- Every number, employer, title, project and result must trace back to the profile or to something the user typed for this email.
- Arithmetic restatements are fine if exact ("36% fewer tickets" can become "over a third fewer tickets").
- The accuracy pass (Stage 4) runs on cold emails too: it lists each factual claim and flags any it cannot trace.
- Placeholders in square brackets block sending until filled.

---

## 11. Variants by recipient

The recipient type, stored on the contact, changes the email:

| Recipient | Lead with | Ask |
| --- | --- | --- |
| Founder or CEO | Their product or market; what the user would ship | 15-minute call, or a one-word choice on an offer |
| Hiring manager | The team's problem from the JD; the closest proof point | 15-minute call about the role |
| Team lead or engineer | A specific technical observation or question | Their take on the question, or who owns hiring |
| Technical recruiter | Fit for the exact role, in plain terms; that the user has applied | Whether the application can be flagged for the hiring manager |
| General recruiter | The role title and requisition link; two proof points | Who the right recruiter or hiring manager is |

Recruiters get more direct, less clever emails. Engineers should never be asked for a referral in the first email.

---

## 12. Follow-ups

- **One follow-up**, two at most. More reads as spam.
- Send 4 to 5 business days after the first email, in the **same Gmail thread** (stored `thread_id`).
- Under 50 words, and it must **add something new**: a shipped link, a second finding, a short result. Never "just checking in".
- Stop the sequence as soon as any reply arrives, including an out-of-office with a return date (reschedule) or a "not me" (move to the suggested person).
- Generate the follow-up together with the first email so the user approves both, but send each only on an explicit click (Stage 9 adds reminders).

---

## 13. Sending: timing, volume and deliverability

The app sends from the user's own Gmail through the Gmail API (`gmail.send`), so the user's real reputation is at stake.

- **Timing:** Tuesday to Thursday, morning in the **recipient's** time zone (inferred from the company or job location). If the user clicks Send outside that window, offer "schedule for Tue 9:00 their time" alongside "Send now".
- **Volume:** keep it low and steady, around 20 to 30 personalized emails a day at most, and far below Gmail's daily recipient cap. A sudden burst from a personal account looks like spam.
- **Format:** plain text (or minimal HTML that mirrors it). No tracking pixels, no link shorteners, no attachments; all three hurt deliverability and trust.
- **Links:** full, readable URLs to the user's own profiles. At most two.
- **One recipient per email.** No CC or BCC lists.
- **Verified addresses only** by default. Bounces hurt the sender's reputation; an unverified address needs an extra confirmation.
- **Never automatic.** Every send, including follow-ups, is an explicit click after a preview.

---

## 14. Ethics and limits

- These are personal, one-to-one emails about a specific job, not marketing. Keep them honest and easy to ignore.
- If someone asks not to be contacted, mark the contact `do_not_contact` and never email them again, including for other jobs at that company.
- Contact data from Hunter or Apollo is used only to email that person about that job, and is stored locally.
- No pretexting: never imply a referral, a mutual connection or a prior conversation that did not happen.

---

## 15. Measuring what works

Store enough to learn from (feeds Stage 10 analytics and section 9 retrieval):

- Per email: angle, recipient type, subject, word count, sent time (and recipient local time), follow-up sent or not, reply received, time to reply, outcome (call, referral, "not me", rejection).
- Compare reply rates by angle and by recipient type once there are about 30 sends per group; smaller groups are noise.
- Feed emails that got positive replies back into retrieval as style references.

---

## 16. Self-check

The app runs the mechanical checks in code and shows failures next to the editor. The model runs the judgement checks before returning.

**In code:**

- Body is 60 to 120 words; follow-up under 50
- No banned phrase, no em dash, no bullets
- Only one ask (flag more than one question in the closing paragraph)
- At most two links; no attachments
- No unfilled `[placeholder]`
- Recipient name matches the selected contact

**Model:**

- Does it read like a shrunken cover letter? Rewrite around a different angle.
- Is the first sentence about them, their product or an artifact?
- Swap test: could it go to another company unchanged?
- Read aloud: does any line sound like a template or LinkedIn?
- Is every fact traceable to the profile?

---

## 17. Examples

Illustrative, different domains. Do not copy.

**Proof of work**

> Subject: your onboarding, timed
>
> Hi Priya,
>
> I signed up for Ledgerly last week and timed it: 11 minutes to my first invoice, and 6 of those went to connecting a bank. I mocked a version that moves that step after the first invoice: [link]
>
> I've applied for the Growth PM role. At my last company I rebuilt a checkout flow and completed purchases doubled in a month.
>
> Could I walk you through the mock in 15 minutes? If you're not the right person, who is?
>
> Sam
> linkedin.com/in/...

**Value-first offer**

> Subject: one report, on me
>
> Hi Marco,
>
> Your Data Engineer posting mentions untangling the reporting pipeline. Send me one report your team still rebuilds by hand every week, and I'll come back in five days with a working pipeline for it.
>
> For context: at my last job I moved 40 manual reports onto scheduled pipelines, and the analytics team's Monday went from six hours to one.
>
> Which report would you pick?
>
> Sam
> github.com/...

**Recruiter, plain intro**

> Subject: Automation Engineer, applied today
>
> Hi Dana,
>
> I applied today for the Automation Engineer role (req 4821). I've spent the last two years building n8n and Zapier workflows for a 60-person ops team, and the biggest one replaced a 3-hour daily reconciliation with a 5-minute check.
>
> Could you flag my application for the hiring manager? If another recruiter covers this team, who should I write to?
>
> Sam
> linkedin.com/in/...

**Follow-up (same thread)**

> Hi Priya, a quick addition: I built the reordered flow into a clickable prototype, and 4 of 5 friends I tested it on reached an invoice in under 4 minutes. [link]
>
> Sam

---

## 18. Open questions

- Should the generator produce one email per recipient type, or one email that is regenerated when the contact changes?
- Where does the user record artifacts for angle 1 (a field on the job, or a reusable "portfolio" list on the profile)?
- Do we infer the recipient's time zone from the company HQ or the job location?
- Is a daily send cap enforced in code, or only shown as a warning?
