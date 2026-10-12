# Stage 3b: Company directory

## Why

A posting often says a lot about the employer, and good applications use it. Storing it per job repeats work and loses what you learn (e.g. Google's principles). So there is one shared profile per company that every job links to, that you can edit, and that is included in exports.

## Data

- `companies`: `name`, `normalized_name` (unique), `website`, Markdown `about`, `principles`, `culture`, `notes`, `provenance` (per field: `posting` | `web` | `user`), `sources` (url + title), `researched_at`
- `company_aliases`: other names that resolve to the same company (unique normalized alias)
- `jobs.company_id` (links to the company; backfilled on first visit to Companies for older jobs) and `jobs.about_company` (what that posting says about the employer)

## Rules

- **Matching:** `normalizeCompanyName` (the same normalizer used for job dedup). Name or alias match links silently; concurrent saves create one company; a rename or alias that collides with another company is refused with a pointer to Merge
- **Ownership:** editing `about` / `principles` / `culture` marks the field `user`; automated writes skip `user` fields and never blank existing text; clearing a field removes the lock
- **Seeding:** a job's `aboutCompany` fills an empty company `about` (marked `posting`)
- **Merge:** moves jobs and aliases, keeps the old name as an alias, fills empty fields, appends notes, deletes the source (one transaction)

## Research (`src/lib/companies/research.ts`): cheapest source first, company-owned sources only for values

The paid search is the last resort, and never runs more than twice.

1. **Directory:** a company already researched or fully filled in is skipped entirely
2. **The posting's own text** about the employer (`aboutCompany`): free context for the model, never a reason to search by itself
3. **The company's own site** (free): `companySiteBase` takes the website from the directory, else a job URL whose host looks like the company (ATS, job boards and recruiter sites are ignored); for a group, its brands' job URLs count too. It fetches `/about`, `/about-us`, `/company` and `/values`; a thin page that loaded (JS shell) is rendered with Playwright, at most twice and never for a 404. One page of 800+ readable characters is enough: **no search is made**
4. **Web search** only if step 3 was thin: **one** combined query (`<company> company about mission values culture`, 6 results)
5. **Follow-up search** (second and last): only if mission/values are still empty (or culture, after a search), and only restricted to the company's own domains (`include_domains`), so it is cheap and precise
6. **One `chatStructured` call per pass** over numbered sources

### Source quality rules

- **Excluded entirely:** job boards and ATS pages, social and video sites (any `youtube.com/watch`, `/shorts`, `/@channel`, Vimeo, TikTok), and review/survey aggregators (Comparably, Glassdoor, Zippia, AmbitionBox, Payscale, Trustpilot, Kununu, Blind and similar). A host that merely contains the company name is not "official": a YouTube video is not YouTube's mission statement
- **Each page is labelled company-owned or third-party.** Owned pages rank first, best About-style paths (`/about`, `/mission`, `/values`, `/culture`, an `about.` subdomain) first; at most four pages, third-party ones only fill gaps (one when owned pages are plentiful)
- **Mission/values and culture come only from company-owned sources.** The prompt says so, and the code enforces it: if no company-owned source was used, those sections are discarded. Third-party text may inform "what they do" only
- **No trivia:** acquisition prices, funding, valuation, survey statistics and ratings are excluded by the prompt
- Without a search key, steps 1 to 3 still work; if they are thin the review screen says so and nothing is searched

### Transparency

Every run stores a log on the company: which tier answered (`company-site` or `web-search`), the exact queries (with the domain restriction), and every page read with its owned/third-party label. The company page shows it under "How this was researched"; the review screen shows the sources and queries before you save.

The same function backs **Research / Refresh from web** on the company page. Research output is labelled "Web research: check it" because it is model-written from web pages. It never blocks saving a job.

## Parent companies

`companies.parent_id` lets a brand belong to a group (YouTube is part of Google). The parent's profile is added to the child's exports under "Parent company", the job panel links to it, the group's page lists its brands, and the group's own site is found from its brands' job URLs. Loops and self-parenting are refused; merging moves brands to the target. The parent is not mixed into the child's research: each profile stays about one company.

## UI

- Sidebar **Companies**: searchable directory (jobs, which sections are filled, last researched), New company
- Company page: edit all fields, provenance badges, aliases, website, Research / Refresh, Merge, Copy / Download Markdown, sources, job list
- Brand/group: a "Part of" selector and a list of brands; research log and Owned/Third-party badges on sources
- Job panel: Company section; review screen: "About the company" field and a research preview
- Markdown export (job): "About the company" section before the full posting text

## Not done

Live Tavily calls are deliberately untested (each search costs money): the provider is covered with a fake `fetch`, and every research test uses a fake search that fails the test if called when it should not be. The free tier was run once against real pages with the real model. Re-extracting `aboutCompany` for jobs saved before this change is not automatic; their full posting text is still in the snapshot and in exports.
