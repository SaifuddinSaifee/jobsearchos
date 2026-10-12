import { SearchError, type WebSearchProvider } from "@/lib/companies/search";
import { isGenericInbox } from "./checks";
import { nameParts } from "./patterns";

export type PublicEmail = { email: string; url: string };

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Every address at the company's own domain in a piece of text. */
export function extractAddresses(text: string, domain: string): string[] {
  const re = new RegExp(`[A-Za-z0-9._%+-]+@${escape(domain)}(?![A-Za-z0-9-])`, "gi");
  return [...new Set((text.match(re) ?? []).map((a) => a.toLowerCase().replace(/^[.%+-]+/, "")))];
}

const clean = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");

/** Whether the part before the @ plausibly belongs to this person (ray, ray.fitzgerald, rfitzgerald, ...). */
export function localMatchesName(local: string, fullName: string): boolean {
  const p = nameParts(fullName);
  if (!p) return false;
  const l = clean(local);
  return l === p.first || l === p.first + p.last || l === p.last || l === p.first[0] + p.last || l === p.first + p.last[0] || (p.last.length >= 4 && l.includes(p.last));
}

/**
 * Looks for an address the person has published themselves (company pages, GitHub commits, talks, press). Only an
 * address at the company's domain counts, and only when it is tied to this person: either it looks like their name,
 * or their name appears right next to it. Anything else is ignored rather than guessed.
 */
export async function findPublicEmail(person: { name: string }, domain: string, search: WebSearchProvider): Promise<PublicEmail | null> {
  const queries = [
    { q: `"${person.name}" "@${domain}"` },
    { q: `"@${domain}" "${person.name}" email`, includeDomains: ["github.com"] },
  ];
  const results = (
    await Promise.allSettled(queries.map(({ q, includeDomains }) => search.search(q, { maxResults: 6, includeDomains })))
  );
  const hits = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  if (hits.length === 0) {
    const failed = results.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
    if (failed) throw failed.reason instanceof SearchError ? failed.reason : new SearchError("The web search failed");
    return null;
  }

  const name = person.name.toLowerCase();
  let near: PublicEmail | null = null;
  for (const hit of hits) {
    const text = `${hit.title}\n${hit.content}`;
    for (const email of extractAddresses(text, domain)) {
      if (isGenericInbox(email)) continue;
      if (localMatchesName(email.split("@")[0], person.name)) return { email, url: hit.url };
      const at = text.toLowerCase().indexOf(email);
      const around = text.toLowerCase().slice(Math.max(0, at - 120), at + email.length + 120);
      if (!near && around.includes(name)) near = { email, url: hit.url };
    }
  }
  return near;
}
