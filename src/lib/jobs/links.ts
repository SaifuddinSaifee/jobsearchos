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
