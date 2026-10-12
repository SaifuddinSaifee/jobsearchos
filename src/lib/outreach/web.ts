import { z } from "zod";
import { SearchError, type SearchResult, type WebSearchProvider } from "@/lib/companies/search";
import { chatStructured } from "@/lib/llm/structured";
import { CONTACT_KINDS, type ContactKind } from "./types";

export type WebPerson = { name: string; title: string; linkedinUrl: string | null; kind: ContactKind; sourceUrl: string };

const Schema = z.object({
  people: z.array(
    z.object({
      name: z.string(),
      title: z.string(),
      kind: z.enum(CONTACT_KINDS),
      sourceUrl: z.string(),
    }),
  ),
});

/** The part of the job title that names the function, e.g. "Senior Data Engineer" -> "data engineering". Kept simple: the title itself. */
function queries(company: string, jobTitle: string, domain: string | null): { q: string; includeDomains?: string[] }[] {
  const out: { q: string; includeDomains?: string[] }[] = [
    { q: `${company} engineering manager OR director OR head of OR hiring manager ${jobTitle}`, includeDomains: ["linkedin.com"] },
    { q: `${company} technical recruiter OR talent acquisition OR recruiter`, includeDomains: ["linkedin.com"] },
  ];
  if (domain) out.push({ q: `${company} leadership team founders about us`, includeDomains: [domain] });
  return out;
}

/**
 * People at the company found through web search (LinkedIn result titles and the company's own team pages). The model
 * may only list people whose name and company appear in the search results, and each must cite the result it came
 * from. No email addresses come from here.
 */
export async function findPeopleOnWeb(
  target: { company: string; jobTitle: string; domain: string | null },
  search: WebSearchProvider,
): Promise<WebPerson[]> {
  const results: SearchResult[] = [];
  let failed: SearchError | null = null;
  await Promise.all(
    queries(target.company, target.jobTitle, target.domain).map(async ({ q, includeDomains }) => {
      try {
        results.push(...(await search.search(q, { maxResults: 6, includeDomains })));
      } catch (err) {
        if (err instanceof SearchError) failed = err;
        else throw err;
      }
    }),
  );
  if (results.length === 0) {
    if (failed) throw failed;
    return [];
  }

  const seen = new Set<string>();
  const unique = results.filter((r) => !seen.has(r.url) && seen.add(r.url)).slice(0, 18);
  const urls = new Set(unique.map((r) => r.url));

  const out = await chatStructured(
    Schema,
    {
      system: `You list real people who work at ${target.company}, using only the search results given. The applicant wants to email someone about the "${target.jobTitle}" role.
Rules:
- Include a person only if a result shows their name AND that they work (or worked most recently) at ${target.company}. LinkedIn result titles look like "Name - Title - Company | LinkedIn".
- Skip people who left the company, people at other companies with similar names, and results that are not about a person.
- "title" is exactly what the result says. "sourceUrl" must be one of the result URLs given.
- Prefer people who could own this hiring decision: heads or managers of the relevant function, founders at small companies, and recruiters. Skip unrelated functions.
- Never invent a name or title. If no one qualifies, return an empty list.`,
      user: JSON.stringify(unique.map((r) => ({ url: r.url, title: r.title, snippet: r.content.slice(0, 500) }))),
    },
    { maxTokens: 3000 },
  );

  const names = new Set<string>();
  return out.people
    .filter((p) => p.name.trim().split(/\s+/).length >= 2 && urls.has(p.sourceUrl))
    .filter((p) => !names.has(p.name.trim().toLowerCase()) && names.add(p.name.trim().toLowerCase()))
    .map((p) => ({
      name: p.name.trim(),
      title: p.title.trim(),
      kind: p.kind,
      sourceUrl: p.sourceUrl,
      linkedinUrl: /linkedin\.com\/in\//i.test(p.sourceUrl) ? p.sourceUrl : null,
    }));
}
