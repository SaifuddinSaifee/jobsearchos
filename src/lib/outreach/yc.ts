// Reads a company's public Y Combinator page: who the founders are (full name, title, LinkedIn, bio) and the real
// website. Free, one request, and it names exactly the people a startup posting means by "Intro call with Ray".

export type YcFounder = { name: string; title: string; linkedinUrl: string | null; bio: string };
export type YcCompany = {
  slug: string;
  name: string;
  website: string | null;
  teamSize: number | null;
  batch: string | null;
  founders: YcFounder[];
};

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

const HEADERS = {
  // The pages refuse requests that do not look like a browser.
  "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
  Accept: "text/html,application/xhtml+xml",
  "Accept-Language": "en-US,en;q=0.9",
};

/** The YC page to read for a job, from any of its URLs, or null when it is not a Y Combinator job. */
export function ycTarget(urls: (string | null | undefined)[]): string | null {
  for (const raw of urls) {
    if (!raw) continue;
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      continue;
    }
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const path = u.pathname;
    if (host === "workatastartup.com" && /^\/(jobs|companies)\/[^/]+/.test(path)) return `https://www.workatastartup.com${path.split("/").slice(0, 3).join("/")}`;
    const m = host === "ycombinator.com" ? /^\/companies\/([^/]+)/.exec(path) : null;
    if (m) return `https://www.ycombinator.com/companies/${m[1]}`;
  }
  return null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&#x27;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** Both page layouts (workatastartup.com and ycombinator.com) carry their data as JSON in a `data-page` attribute. */
export function parseYcHtml(html: string): YcCompany | null {
  const m = /data-page="([^"]*)"/.exec(html);
  if (!m) return null;
  let company: Record<string, unknown> | undefined;
  try {
    company = (JSON.parse(decodeEntities(m[1])) as { props?: { company?: Record<string, unknown> } }).props?.company;
  } catch {
    return null;
  }
  if (!company || !Array.isArray(company.founders)) return null;

  const founders: YcFounder[] = (company.founders as Record<string, unknown>[])
    .filter((f) => f.is_active !== false)
    .map((f) => ({
      name: str(f.name) || str(f.full_name),
      title: str(f.title) || "Founder",
      linkedinUrl: str(f.linkedin) || str(f.linkedin_url) || null,
      bio: str(f.bio || f.founder_bio).replace(/\s+/g, " ").slice(0, 280),
    }))
    .filter((f) => f.name.split(/\s+/).length >= 2);

  const size = company.teamSize ?? company.team_size;
  return {
    slug: str(company.slug),
    name: str(company.name),
    website: str(company.url) || str(company.website) || null,
    teamSize: typeof size === "number" ? size : null,
    batch: str(company.batch) || null,
    founders,
  };
}

/** Fetches and reads the YC page for a job. Returns null when it is not a YC job; throws when the page cannot be read. */
export async function fetchYcCompany(urls: (string | null | undefined)[], fetcher: Fetcher = (u, i) => fetch(u, i)): Promise<YcCompany | null> {
  const target = ycTarget(urls);
  if (!target) return null;
  const res = await fetcher(target, { headers: HEADERS, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`The Y Combinator page could not be read (HTTP ${res.status}).`);
  const company = parseYcHtml(await res.text());
  if (!company) throw new Error("The Y Combinator page did not have the expected company data.");
  return company;
}
