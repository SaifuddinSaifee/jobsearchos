/** Only http(s) URLs may be rendered as links; job data (incl. LLM output) is untrusted. */
export function safeHref(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.trim());
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

const EMAIL = /^[^\s@<>()"]+@[^\s@<>()"]+\.[a-z]{2,}$/i;

/** Where an apply note's link goes: a mailto for an email address, an http(s) URL, or nowhere. */
export function applyNoteHref(link: string): { href: string; email: boolean } | null {
  const t = link.trim().replace(/^mailto:/i, "");
  if (EMAIL.test(t)) return { href: `mailto:${t}`, email: true };
  const href = safeHref(t);
  return href ? { href, email: false } : null;
}

const SOURCES: Record<string, string> = {
  greenhouse: "Greenhouse",
  lever: "Lever",
  ashby: "Ashby",
  workday: "Workday",
  smartrecruiters: "SmartRecruiters",
  workable: "Workable",
  jsonld: "Page",
  html: "Page",
  playwright: "Page",
  paste: "Pasted",
};

export function sourceLabel(source: string | null | undefined): string {
  return (source && SOURCES[source]) || "Page";
}
