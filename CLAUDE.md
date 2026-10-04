@AGENTS.md

# Code style: no symbol characters, use icons

Never put arrows, check marks, crosses, bullets-as-symbols, emoji or other pictographic Unicode characters in code, UI text, strings or comments. Examples of what to avoid: `←` `→` `↑` `↓` `↗` `✓` `✗` `★` `•`. This project already has icon libraries for this:

- **UI:** use `lucide-react` icons (`ArrowRight`, `ChevronLeft`, `Check`, `X`, ...), sized with Tailwind (`className="size-4"`), with `aria-hidden` on decorative ones and a real label (`aria-label` or `sr-only` text) when the icon carries meaning.
- **Plain text, strings and comments:** use words ("to", "then", "from X to Y", "Down arrow").
- Ordinary punctuation is fine (`-`, `...`, quotes). The ESLint rule `no-restricted-syntax` in `eslint.config.mjs` rejects these characters in string literals, template strings and JSX text, so `npm run lint` will catch them.
- Do not "fix" recorded third-party data in `tests/fixtures/`.
