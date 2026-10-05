import type { EmailStatus } from "./types";

const BASE = "https://api.prospeo.io";

/** A failure with a message safe to show: it says what to do, and never contains the key. `code` is Prospeo's error code. */
export class ProspeoError extends Error {
  constructor(
    message: string,
    readonly code = "",
  ) {
    super(message);
  }
}

type Json = Record<string, unknown>;

async function call(method: "GET" | "POST", path: string, key: string, body?: unknown): Promise<Json> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "X-KEY": key, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const json = (await res.json().catch(() => ({}))) as Json;
  if (res.ok && json.error !== true) return json;

  const code = typeof json.error_code === "string" ? json.error_code : res.status === 429 ? "RATE_LIMIT" : "";
  switch (code) {
    case "INVALID_API_KEY":
      throw new ProspeoError("Prospeo rejected the API key. Check PROSPEO_API_KEY in .env.", code);
    case "INSUFFICIENT_CREDITS":
      throw new ProspeoError("Your Prospeo credits are used up. Wait for the renewal or upgrade the plan.", code);
    case "RATE_LIMIT":
      throw new ProspeoError("Prospeo's rate limit was hit. Wait a few seconds and try again.", code);
    case "SERVICE_TEMPORARILY_UNAVAILABLE":
      throw new ProspeoError("Prospeo is temporarily unavailable. Try again in a moment.", code);
    case "PLAN_REQUIRED":
    case "INVALID_FILTERS":
    case "INVALID_REQUEST":
      throw new ProspeoError(`Prospeo rejected the request (${code}${typeof json.filter_error === "string" ? `: ${json.filter_error}` : ""}).`, code);
    default:
      // NO_RESULTS and NO_MATCH are normal outcomes; callers decide what they mean.
      throw new ProspeoError(code || `Prospeo request failed (${res.status})`, code);
  }
}

/** `acme.com` from "https://www.acme.com/careers", or null when it is not a usable domain. */
export function normalizeDomain(website: string): string | null {
  const raw = website.trim();
  if (!raw) return null;
  try {
    const host = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`).hostname.toLowerCase().replace(/^www\./, "");
    return host.includes(".") ? host : null;
  } catch {
    return null;
  }
}

const LEVEL_WORDS = new Set(["senior", "sr", "staff", "principal", "junior", "jr", "lead", "founding", "associate", "intern", "i", "ii", "iii", "iv", "v"]);
const BUILDER_WORDS = new Set(["engineer", "engineers", "developer", "developers", "programmer", "programmers", "swe"]);
/** "Developer Advocate" is a developer-relations role, not an engineering one. */
const NOT_ENGINEERING = /\b(advocate|relations|evangelist|experience)\b/i;

/** The function a role belongs to, e.g. "Senior Data Engineer" gives "data engineering". Used to aim the title search. */
export function functionTerm(jobTitle: string): string {
  const words = jobTitle
    .toLowerCase()
    .replace(/[^a-z0-9+#/\s-]/g, " ")
    .split(/[\s/-]+/)
    .filter((w) => w && !LEVEL_WORDS.has(w) && !/^\d+$/.test(w));
  if (NOT_ENGINEERING.test(jobTitle)) return words.join(" ") || "engineering";
  const mapped = words.map((w) => (BUILDER_WORDS.has(w) ? "engineering" : w));
  return mapped.filter((w, i) => w !== mapped[i - 1]).join(" ") || "engineering";
}

/** Titles of the people who could own this hiring decision, for a "title contains any of these" search. */
export function searchTitles(jobTitle: string): string[] {
  const f = functionTerm(jobTitle);
  return [`head of ${f}`, `director of ${f}`, `${f} manager`, `vp of ${f}`, "recruiter", "talent acquisition", "founder", "ceo"];
}

export type ProspeoPerson = {
  personId: string;
  firstName: string;
  lastName: string;
  fullName: string;
  title: string;
  linkedinUrl: string | null;
};

const str = (v: unknown) => (typeof v === "string" ? v : "");

/**
 * People at a company whose current title matches, newest data first (one credit per page of 25, free when repeated
 * within 30 days). Emails are not returned by search; `enrichPerson` reveals one.
 */
export async function searchPeople(
  target: { domain?: string | null; company: string; titles: string[] },
  key: string,
): Promise<ProspeoPerson[]> {
  const company = target.domain ? { websites: { include: [target.domain] } } : { names: { include: [target.company] } };
  let json: Json;
  try {
    json = await call("POST", "/search-person", key, {
      page: 1,
      filters: { person_job_title: { include: target.titles, match_mode: "CONTAINS" }, company },
    });
  } catch (err) {
    if (err instanceof ProspeoError && err.code === "NO_RESULTS") return [];
    throw err;
  }
  const results = Array.isArray(json.results) ? (json.results as { person?: Json }[]) : [];
  return results
    .map((r) => r.person ?? {})
    .filter((p) => str(p.person_id) && (str(p.full_name) || str(p.first_name)))
    .map((p) => ({
      personId: str(p.person_id),
      firstName: str(p.first_name),
      lastName: str(p.last_name),
      fullName: str(p.full_name) || `${str(p.first_name)} ${str(p.last_name)}`.trim(),
      title: str(p.current_job_title),
      linkedinUrl: str(p.linkedin_url) || null,
    }));
}

/**
 * Reveals one person's verified work email (one credit, only charged when one is found). The strongest identifier
 * is tried first (the id from a search, then their LinkedIn URL), then their name with the company's website. A
 * lookup that finds nothing is free, so falling through the list costs nothing extra.
 */
export async function enrichPerson(
  target: { personId?: string | null; linkedinUrl?: string | null; firstName?: string; lastName?: string; domain?: string | null },
  key: string,
): Promise<{ email: string; status: EmailStatus } | null> {
  const attempts: Record<string, string>[] = [];
  if (target.personId) attempts.push({ person_id: target.personId });
  if (target.linkedinUrl) attempts.push({ linkedin_url: target.linkedinUrl });
  if (target.firstName && target.lastName && target.domain) {
    attempts.push({ first_name: target.firstName, last_name: target.lastName, company_website: target.domain });
  }

  for (const data of attempts) {
    let json: Json;
    try {
      json = await call("POST", "/enrich-person", key, { only_verified_email: true, enrich_mobile: false, data });
    } catch (err) {
      // No match, or this kind of identifier was not accepted: try the next one. Anything else (key, credits) stops here.
      if (err instanceof ProspeoError && ["NO_MATCH", "INVALID_REQUEST", "INVALID_FILTERS"].includes(err.code)) continue;
      throw err;
    }
    const email = ((json.person as Json | undefined)?.email ?? {}) as Json;
    const address = str(email.email).toLowerCase();
    // An unrevealed address comes back masked ("eoghan.*****@intercom.com").
    if (address && !address.includes("*")) return { email: address, status: str(email.status).toUpperCase() === "VERIFIED" ? "verified" : "unverified" };
  }
  return null;
}

/** Confirms the key works (free). */
export async function accountInfo(key: string): Promise<void> {
  await call("GET", "/account-information", key);
}
