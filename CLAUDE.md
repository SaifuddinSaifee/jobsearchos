@AGENTS.md

# LLM usage: always logged in Postgres and Phoenix

Every LLM call you write or change must be logged in **both** our Postgres `llm_calls` table (which feeds the AI usage page) and the Arize Phoenix collector. The full rules are in AGENTS.md (imported above). In short: never call a model directly; go through `chatStructured` or `chatCompletion` in `src/lib/llm/`, pass a `step`, run inside `withLlmContext`, add new steps, actions and model prices to their tables, and never store prompt or reply text in our database. See `docs/LLM-LOGGING.md`.

# Writing for a job: the goal is the interview

Resumes, cover letters and cold emails exist to get the user to the interview. When writing or editing them for a job, assume the user is qualified for it. The career record is where to start, not a ceiling: the user knows things the record does not (a certification, a tool, a kind of client), often left out only for lack of space.

- **Keywords and gaps are the user's call.** Show the keywords and gaps a job calls for, including obvious inferred ones (AWS, Azure, GCP for "hands-on cloud"), with their weight. When the user picks one, or clicks Fix with AI on a gap, work it into the document (rewording existing experience where that is where it fits) and update the score.
- **Do not build guards against it.** No refusing, blocking, watering down, "real gap, nothing added" outcomes, or asking the user to prove a claim before writing it. The user is responsible for what they send.
- **This applies to writing, not to the record.** Bringing a document into the career record stays word for word from that document (`src/lib/career/`): the record never gets text no document had. Which documents go in is the user's choice, and that includes a generated resume they are happy with, added with one click.

# Code style: no symbol characters, use icons

Never put arrows, check marks, crosses, bullets-as-symbols, emoji or other pictographic Unicode characters in code, UI text, strings or comments. Examples of what to avoid: `←` `→` `↑` `↓` `↗` `✓` `✗` `★` `•`. This project already has icon libraries for this:

- **UI:** use `lucide-react` icons (`ArrowRight`, `ChevronLeft`, `Check`, `X`, ...), sized with Tailwind (`className="size-4"`), with `aria-hidden` on decorative ones and a real label (`aria-label` or `sr-only` text) when the icon carries meaning.
- **Plain text, strings and comments:** use words ("to", "then", "from X to Y", "Down arrow").
- Ordinary punctuation is fine (`-`, `...`, quotes). The ESLint rule `no-restricted-syntax` in `eslint.config.mjs` rejects these characters in string literals, template strings and JSX text, so `npm run lint` will catch them.
- Do not "fix" recorded third-party data in `tests/fixtures/`.
