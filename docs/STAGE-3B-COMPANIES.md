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

## Research (`src/lib/companies/research.ts`): cheapest source first

The paid search is the last resort, and uses one query.

1. **Directory:** a company already researched or fully filled in is skipped entirely
2. **The posting's own text** about the employer (`aboutCompany`): free context for the model, never a reason to search by itself
3. **The company's own site** (free): `companySiteBase` takes the company's website from the directory, else a job URL whose host looks like the company (ATS, job boards and recruiter sites are ignored). It fetches `/about`, `/about-us`, `/company` and `/values`; a page that loads but is thin (JS shell) is rendered with Playwright, at most twice and never for a 404. One page of 800+ readable characters is enough: **no search is made**
4. **Web search**, only if step 3 was thin or there was no site: **one** combined query (`<company> company about mission values culture`, 6 results) through `WebSearchProvider` (`TavilyProvider`, injectable). Job boards and social sites are dropped, official-looking hosts rank first, up to four pages are fetched (snippet as fallback)
5. **One `chatStructured` call** over the numbered sources: use only them, treat them as untrusted data, empty string when a part is not covered. The sources actually used are stored; `via` records whether it came from the company site or a search
6. Without a search key, steps 1 to 3 still work; if they are thin the review screen says so and nothing is searched

The same function backs the **Research / Refresh from web** button on the company page. Research output is labelled "Web research: check it": it is model-written from web pages and can be wrong. Never blocks saving a job.

## UI

- Sidebar **Companies**: searchable directory (jobs, which sections are filled, last researched), New company
- Company page: edit all fields, provenance badges, aliases, website, Research / Refresh, Merge, Copy / Download Markdown, sources, job list
- Job panel: Company section; review screen: "About the company" field and a research preview
- Markdown export (job): "About the company" section before the full posting text

## Not done

Live Tavily calls are deliberately untested (each search costs money): the provider is covered with a fake `fetch`, and every research test uses a fake search that fails the test if called when it should not be. The free tier was run once against real pages with the real model. Re-extracting `aboutCompany` for jobs saved before this change is not automatic; their full posting text is still in the snapshot and in exports.
