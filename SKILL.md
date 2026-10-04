---
name: "job-application-kit"
description: Tailor a resume to a job description, write a cover letter, and write a short punchy cold email to a recruiter or hiring manager. Use this skill whenever the user shares a resume and/or a job description (JD) and asks for a tailored ATS-optimized resume, a cover letter, a cold email, outreach message, or any combination of these. Also trigger when they say things like "curate my resume for this role", "make my resume fit this JD", "write me a cover letter", "draft a cold email for this job", or paste a JD along with their resume, even if they don't name every deliverable.
---

# Job Application Kit

Turns two inputs (the user's resume and a job description) into up to three deliverables: a tailored resume, a cover letter, and a cold email. The user decides which ones they want.

## Inputs

1. **Resume**: usually an uploaded PDF or DOCX, sometimes pasted text. Read it fully before doing anything. If it is a file, extract the text and also note the visual structure (section order, headings, bullet style, date placement).
2. **Job description**: pasted text, file, or a URL (fetch it if a URL is given).
3. **Company details (optional):** sometimes the user adds what the company does, its products, vision, mission, values, or recent news. Often they won't. See "Using company details" below.
4. **Extra instructions** in the prompt: target company, recipient name, tone tweaks, things to emphasize or drop. These override the defaults below.

If the resume or JD is missing, ask for the missing one in a single short sentence. Don't start writing without both (exception: a cold email can be written from the resume plus a company/role name if that's all the user has).

## Deliver only what was asked

This is the most important behavioral rule. Match the request exactly:

- "resume" only → only the resume
- "cover letter" only → only the cover letter
- "cold email" only → only the cold email
- any combination, or "all three" / "the full kit" → those, in this order: Resume, Cover Letter, Cold Email

Do not volunteer extra deliverables, and don't end with "want me to also write a cover letter?". If the request is genuinely unclear about which deliverables are wanted, default to all three.

## Output medium

Write everything **directly in the chat as Markdown**. No artifacts, no files, no PDF, no DOCX, no code blocks wrapping the whole thing. The user copies the text back into their own document, so it must be clean and paste-ready. Use a simple `## Resume`, `## Cover Letter`, `## Cold Email` heading to separate deliverables when more than one is returned.

Style rule for all output: **never use em dashes (—)**. Use commas, colons, periods, or parentheses instead.

## Using company details

The only purpose of company details is to make the documents feel personalized, as if written for this company and no other. Use a light touch: a reader should sense the fit, not feel lectured about their own company.

**When details are provided:**
- **Resume:** at most a subtle nudge. If a summary exists, it can echo the company's domain or mission in a few words ("building AI for small business finances"). Bullets can favor wording that matches the company's world (e.g., "consumers" vs "enterprises"). Never quote the mission statement and never name the company in the resume body.
- **Cover letter:** the "Why this company" part draws on one or two specific details, tied to something the user has done or cares about. One or two sentences total, not a paragraph of praise.
- **Cold email:** use at most one detail, as the unique touch or inside the hook. One clause is often enough.
- Pick the detail that connects best to the user's experience, not the most impressive-sounding one. Skip the rest.
- Don't repeat the company's own marketing language back to them word for word, and don't flatter ("your visionary mission...").

**When details are not provided:** don't ask for them and don't search for them unprompted. Personalize from the JD alone (what the team is building, the problem the role exists to solve). Never invent facts about the company; a short, specific line about the role beats a made-up line about the company.

---

## 1. Tailored resume

### The format is locked

The user's resume format is fixed. Reproduce it faithfully in Markdown and change only the wording inside it. Specifically, keep:

- The same sections, in the same order, with the same heading names
- The same header block (name, contact line, links) exactly as written
- The same layout of each entry: title / company / location / dates in the same order and same date format
- Bullets where the original has bullets, paragraphs where it has paragraphs
- Roughly the same number of bullets per role (±1), and roughly the same overall length, because the original fits a page budget
- The same tense and voice conventions (e.g., past tense for past roles)
- Skills section in the same shape (comma list stays a comma list, grouped categories stay grouped)

Do not add new sections (no surprise "Summary" or "Key Achievements" if the original lacks one). Do not remove sections. If a section genuinely should change, say so in one line in the notes below instead of doing it.

Map the original formatting to Markdown sensibly: name as `#`, section headings as `##` or bold (match how prominent they look), role lines in bold, bullets as `-`.

### What to change

The goal is that a recruiter skimming for 6 seconds, and an ATS matching keywords, both see a clear fit with the JD.

- **Mirror JD language** where the user's real experience supports it. If the JD says "cross-functional stakeholder alignment" and the resume says "worked with other teams", rewrite toward the JD's phrasing.
- **Reorder bullets** within a role so the most JD-relevant ones come first.
- **Sharpen bullets** into action + what + measurable result. Keep every number the user provided; never invent one.
- **Reorder skills** so JD-matching ones come first; add a skill only if the resume elsewhere clearly shows it.
- **Tune the summary/objective** (only if one already exists) to the specific role.

### Assume the applicant meets every requirement

The user meets all requirements in the JD. Their resume is often shorter than their real experience because of space and other constraints, so a requirement missing from the resume is not a gap. It is experience that hasn't been written down yet.

- Do not question fit, flag misalignment, or list "requirements the resume doesn't show". The user will say so explicitly if something doesn't apply; only then leave it out.
- Cover every JD requirement (skills, tools, domains, responsibilities, soft skills) somewhere in the resume, placed in the role or section where it most naturally belongs given that role's work.
- Express it by extending real bullets or adding bullets in the existing roles, within the length budget.

What stays fixed, because it can be checked by a background check or reference: employer names, job titles, dates, degrees, certifications, and specific numbers. Keep every number the user provided; when a newly covered requirement has no number from the user, describe the work and its outcome qualitatively instead of inventing a figure. Never add a certification or degree the user didn't list.

### Make it ATS-proof (top priority)

Applicant tracking systems score resumes on how well they match the JD's terms. The goal is a high match that still reads naturally to a human.

1. **Extract keywords first.** Before writing, pull from the JD: hard skills and tools, domain terms, job title variants, responsibility phrases, methodologies, and soft skills. Note which appear repeatedly or in "required" sections; those weigh most.
2. **Use the JD's exact wording.** ATS matching is literal. If the JD says "stakeholder management", use "stakeholder management", not "worked with stakeholders". Match spelling, plurals, and capitalization of tool names.
3. **Cover acronyms both ways** the first time: "Search Engine Optimization (SEO)", "Large Language Models (LLMs)".
4. **Place keywords meaningfully.** Every keyword sits inside a sentence that says what was done with it and why it mattered, e.g. "Led A/B testing of onboarding flows, improving activation" rather than a bare keyword. Never keyword-stuff, never list JD terms in hidden or white text, never repeat the same term unnaturally.
5. **Hit high-value spots.** Put the most important keywords in the summary (if one exists), the first bullet of each recent role, and the skills section. Repeat the top 3 to 5 keywords 2 to 3 times across the resume, in different contexts.
6. **Mirror the target title** where honest and natural, such as in the summary line ("Product Manager with 8 years in AI platforms...").
7. **Keep it parseable.** Standard section names the original already uses, no tables, columns, icons, or special characters in the Markdown output, plain `-` bullets.

### After the resume

Add a short **Notes** block (3 lines max): the top JD keywords you worked in, and which bullets you added or extended to cover requirements, so the user can check them quickly. No fit warnings. Keep it brief; the resume is the product.

---

## 2. Cover letter

The cover letter is the only place the reader hears the applicant's voice. The resume already lists the facts, so a letter that restates them in sentence form is the most common failure: it reads like a desperate student or like AI. The bar is simple: a hiring manager reads the first two lines and wants to read the rest.

Length: 250 to 350 words, 3 to 5 short paragraphs.

### Before writing: find the thread

Pick ONE story from the resume that is the best proof for this role, ideally with a problem, an insight, and a result. The strongest angle is usually where the user's past work is a smaller version of the team's actual problem (a RAG search over docs for a Search role, a billing migration for a payments role, an onboarding redesign for a growth role). That parallel is the spine of the letter. Everything else supports it.

### Structure

1. **Hook (first 1 to 3 sentences):** open inside the story or with a sharp, specific observation: a concrete situation, a surprising number, a claim someone could disagree with. Never open with the role, the applicant's name, or their excitement.
2. **The bridge:** connect the story to this team's problem, and name the exact job title here as a consequence of the hook (e.g., "That's the smallest version of the problem Search solves all day, and it's why I'm applying for Software Engineer, Search.").
3. **The insight:** what they noticed, what they did, why that approach. Show judgment, not just activity.
4. **Supporting proof:** 2 to 3 other results chosen because they map to the JD's top needs, written as quick concrete beats with numbers. Not JD responsibility lines turned into first person.
5. **Why this company + close:** one or two sentences tied to the thread (one company detail at most, see "Using company details"), then one or two short, confident closing lines. Calling back the hook works well.

### Voice rules

- Write like a sharp professional talking to a peer they respect: plain words, short sentences mixed with longer ones, an occasional opinion.
- Concrete beats abstract: "engineers type a question in plain English and get back a working log query" beats "streamlined query generation".
- **Never paraphrase JD responsibilities into "I do X" sentences** ("I write product and system development code", "I manage project priorities, deadlines, and deliverables", "I own solutions end to end"). This is the number one tell of a weak letter. Show those qualities through examples instead.
- **Banned phrases (AI and student tells):** "I am writing to", "I'm applying for" as the opener, "excited", "thrilled", "passionate", "I believe", "aligns with", "where all of this comes together", "the combination of X and Y", "end to end", "the work I enjoy most", "next stage of my career", "make an impact", "fast-paced", "leverage", "I am confident that", "I'd welcome the opportunity", "I look forward to hearing from you". No strings of three adjectives. Don't start consecutive paragraphs with "At [Company], I...".
- No groveling, no hedging, no explaining a requirement away.
- Personality in small doses: one vivid detail or one line of dry humor, never cute.
- Framing a real result as a story is good; inventing events, colleagues, quotes, or numbers is not. Any figure in the letter must come from the resume or follow arithmetically from it (a 36% ticket drop from a docs bot means over a third of tickets were already answered in the docs).

### ATS, lightly

Keyword scoring matters less for cover letters than for resumes, and stuffing is exactly what makes a letter read like AI. Include the exact job title, work in the 4 to 6 most important JD terms only where they fit naturally inside the story, and expand acronyms once. Anything that doesn't fit naturally belongs in the resume, not here. Same assume-qualified rule: no hedging about missing requirements.

Use the recipient's name if given, otherwise "Dear Hiring Manager" or "Dear [Team] team". Sign off with the user's name as it appears on the resume (or as they ask).

### Self-check before sending

- Read the first two sentences cold. Could they open a letter to any other company or role? Rewrite.
- Would the reader remember one specific thing from this letter tomorrow? If not, the thread is too weak.
- Count JD phrases used verbatim. More than about 6 means it has become a keyword list.
- Scan for every banned phrase and for em dashes.

---

## 3. Cold email

A busy recruiter or hiring manager reads this in 15 seconds on their phone, between other things. It has to read like a note from a sharp person, not a pitch. If it looks like it could be mass-sent with the name swapped, it gets ignored, so the whole email must be impossible to send to any other company.

### Shape

- **60 to 110 words**, 3 or 4 very short paragraphs. Plain prose. **No bullets and no labels** ("What I'd bring:", "Highlights:") by default: those are what make it look like a template. Use bullets only if the user asks for them.
- **Paragraph 1, the hook (1 to 3 sentences):** one specific story or observation from the resume, ideally the same "smaller version of your problem" thread as the cover letter (see section 2). Start in the middle of it. The first sentence should make the reader want the second.
- **Paragraph 2, the bridge and proof (1 to 2 sentences):** connect the story to this team, name the role, and add at most 1 or 2 more numbers, folded into a sentence.
- **Paragraph 3, the ask (1 to 2 sentences):** specific, human, low-friction, with an easy out. E.g., "If you're the one hiring for this, I'd love 15 minutes. If not, who should I talk to?" The out makes it easy to reply even when they aren't the right person.
- **Sign-off:** first name, plus one line with LinkedIn/GitHub/portfolio if the resume has them.

### Subject line

Offer 2 options, under 8 words. They should create curiosity from the story itself, the way a good headline does ("A third of our tickets were a search problem"), not read like a resume headline ("Engineer with 500K events/day experience") or a form ("Application for SWE role"). Sentence case or lowercase is fine; no clickbait, no emojis.

### Voice rules

- Same voice rules and banned phrases as the cover letter, plus these cold-email tells: "I hope this finds you well", "My name is", "I came across", "reaching out", "I'd love to connect", "Worth a quick chat?" (as a stock line), "perfect fit", "I'm a huge fan", "Looking forward".
- The unique touch comes from the story, not from a tacked-on personality line ("I still get excited when...") or a list of awards. Mention an award only if it directly serves the hook.
- Don't repeat the cover letter's sentences verbatim; same thread, fresh wording.
- Never use em dashes.

### Example shape (illustrative, different domain, don't copy)

Subject: the refund form nobody finished

Hi Priya,

Last year 40% of our refund requests died halfway through the form. I cut it to three taps, and completed refunds doubled in a month.

Your Payments PM role reads like that problem with a few more zeros. I've also run the unglamorous parts: pricing experiments, and the billing migration nobody wanted to own.

If you're the one hiring for this, I'd love 15 minutes. If not, who should I talk to?

Name
linkedin.com/in/...

### Self-check

- Delete the company and role names. Does it still work for another company? Rewrite.
- Read it aloud. Does it sound like a person or a template? Any line that sounds like LinkedIn goes.
- Is the first sentence about something that happened, not about the sender?
- Under 110 words, no bullets, one ask, no banned phrases.

---


## Final check before sending

- Only the requested deliverables are present
- Resume structure matches the original section-for-section
- Every JD requirement is covered in the resume, each in a meaningful sentence
- Cover letter is built on one story with a real hook, passes its self-check, and contains no banned phrases
- Cold email is plain prose, under 110 words, hooks on a story, has one ask with an out, and passes its self-check
- Exact JD keywords used (not synonyms), acronyms expanded once, no stuffing
- Company details (if given) used lightly: one or two touches, nothing invented if not given
- No fit warnings or hedging about missing requirements
- No invented employers, titles, dates, degrees, certifications, or numbers
- No em dashes anywhere
- Output is plain Markdown in chat, not a file or artifact