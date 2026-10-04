import { FetchError, type FetchMethodName } from "./types";

const TRACKING = /^(utm_|gclid$|fbclid$|ref$|ref_|source$|src$|gh_src$|lever-source)/i;
const BLOCKED_HOSTS = /(^|\.)(linkedin\.com|indeed\.com|glassdoor\.com)$/i;

export function parseJobUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new FetchError("invalid_url", "That is not a valid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new FetchError("invalid_url", "Only http(s) URLs are supported");
  }
  return url;
}

/** https, lowercase host, no tracking params / fragment / trailing slash, sorted query. */
export function canonicalizeUrl(input: string): string {
  const url = parseJobUrl(input);
  url.protocol = "https:";
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING.test(key)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString();
}

export function isBlockedHost(input: string): boolean {
  return BLOCKED_HOSTS.test(parseJobUrl(input).hostname);
}

export type AtsMatch =
  | { ats: "greenhouse"; board: string; id: string }
  | { ats: "lever"; company: string; id: string; host: string }
  | { ats: "ashby"; org: string; id: string }
  | { ats: "workday"; host: string; tenant: string; site: string; path: string }
  | { ats: "smartrecruiters"; company: string; id: string }
  | { ats: "workable"; account: string; shortcode: string };

/** Recognizes a posting URL on a known ATS. Returns null for anything else. */
export function detectSource(input: string): AtsMatch | null {
  const url = parseJobUrl(input);
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split("/").filter(Boolean);

  if (/(^|\.)greenhouse\.io$/.test(host) && !host.startsWith("boards-api")) {
    // boards.greenhouse.io/{board}/jobs/{id} and job-boards.greenhouse.io/{board}/jobs/{id}
    const id = parts[1] === "jobs" ? parts[2] : url.searchParams.get("gh_jid");
    if (parts[0] && id && /^\d+$/.test(id)) return { ats: "greenhouse", board: parts[0], id };
    return null;
  }

  if (host === "jobs.lever.co" || host === "jobs.eu.lever.co") {
    if (parts.length >= 2) {
      return { ats: "lever", company: parts[0], id: parts[1], host: host.includes(".eu.") ? "api.eu.lever.co" : "api.lever.co" };
    }
    return null;
  }

  if (host === "jobs.ashbyhq.com") {
    if (parts.length >= 2) return { ats: "ashby", org: parts[0], id: parts[1] };
    return null;
  }

  const wd = host.match(/^([^.]+)\.wd\d+\.myworkdayjobs\.com$/);
  if (wd) {
    const rest = /^[a-z]{2}-[A-Z]{2}$/.test(parts[0] ?? "") ? parts.slice(1) : parts;
    const jobIdx = rest.indexOf("job");
    if (rest.length >= 3 && jobIdx >= 1) {
      return {
        ats: "workday",
        host,
        tenant: wd[1],
        site: rest[0],
        path: rest.slice(jobIdx + 1).join("/"),
      };
    }
    return null;
  }

  if (host === "jobs.smartrecruiters.com" || host === "careers.smartrecruiters.com") {
    if (parts.length >= 2) return { ats: "smartrecruiters", company: parts[0], id: parts[1].split("-")[0] };
    return null;
  }

  if (host === "apply.workable.com") {
    const idx = parts.indexOf("j");
    if (parts.length >= 3 && idx === 1) return { ats: "workable", account: parts[0], shortcode: parts[2] };
    return null;
  }

  return null;
}

/**
 * Companies embed Greenhouse on their own domain (stripe.com/jobs/search?gh_jid=123), so the
 * board is not in the URL. The board token is usually the company's domain label; try it.
 */
export function guessGreenhouse(input: string): Extract<AtsMatch, { ats: "greenhouse" }> | null {
  const url = parseJobUrl(input);
  const id = url.searchParams.get("gh_jid");
  if (!id || !/^\d+$/.test(id)) return null;
  const labels = url.hostname.toLowerCase().split(".");
  const board = labels.length >= 2 ? labels[labels.length - 2] : "";
  return board ? { ats: "greenhouse", board, id } : null;
}

export function sourceMethod(ats: AtsMatch["ats"]): FetchMethodName {
  return ats;
}
