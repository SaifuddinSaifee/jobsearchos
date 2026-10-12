import { ProspeoError } from "./prospeo";
import { suggestEmails, type PatternId } from "./patterns";
import type { EmailStatus } from "./types";

export type EmailTarget = { name: string; linkedinUrl: string | null; providerId: string | null; domain: string | null };

export type EmailResult =
  | {
      kind: "found";
      email: string;
      status: EmailStatus;
      /** Where the address came from, for display: "Prospeo", "Saved from another job", "Seen publicly at ...". */
      source: string;
      /** Paid credits spent (0 for free sources). */
      cost: number;
    }
  | { kind: "guess"; guesses: string[] };

/** One link in the chain; each returns null when it has nothing, or throws when it could not look. */
export type EmailSteps = {
  /** Free: an address already saved for this person on any job. */
  known: (t: EmailTarget) => Promise<{ email: string; status: EmailStatus } | null>;
  /** Cheap: an address the person has published, found through web search. Null when search is not set up. */
  publicSearch: ((t: EmailTarget) => Promise<{ email: string; url: string } | null>) | null;
  /** One credit, only charged when a verified address is found. Null when no key is set. */
  prospeo: ((t: EmailTarget) => Promise<{ email: string; status: EmailStatus } | null>) | null;
  /** Formats already seen at this company, to order the guesses. */
  learned: () => Promise<PatternId[]>;
};

/** Reports which source answered, so the page can say what it cost. */
export type EmailTrace = (step: "known" | "public" | "prospeo", outcome: "found" | "none" | "error") => void;

/**
 * Finds a work email by trying the cheapest source first and stopping at the first answer:
 * saved contacts (free), public web search (a search call), Prospeo (one credit), then format guesses.
 * Guesses are never saved as facts; they come back as suggestions. If nothing answered and Prospeo itself failed
 * (key, credits, rate limit), that error is raised so the user knows why.
 */
export async function resolveEmail(
  t: EmailTarget,
  steps: EmailSteps,
  opts: { paid?: boolean; trace?: EmailTrace } = {},
): Promise<EmailResult> {
  const trace = opts.trace ?? (() => {});
  let prospeoError: ProspeoError | null = null;

  try {
    const known = await steps.known(t);
    trace("known", known ? "found" : "none");
    if (known) return { kind: "found", ...known, source: "Saved from another job", cost: 0 };
  } catch {
    trace("known", "error");
  }

  if (steps.publicSearch && t.domain) {
    try {
      const pub = await steps.publicSearch(t);
      trace("public", pub ? "found" : "none");
      if (pub) {
        let host = pub.url;
        try {
          host = new URL(pub.url).hostname.replace(/^www\./, "");
        } catch {
          // keep the raw value
        }
        return { kind: "found", email: pub.email, status: "unverified", source: `Seen publicly at ${host}`, cost: 0 };
      }
    } catch {
      trace("public", "error");
    }
  }

  if (steps.prospeo && opts.paid !== false) {
    try {
      const found = await steps.prospeo(t);
      trace("prospeo", found ? "found" : "none");
      if (found) return { kind: "found", ...found, source: "Prospeo", cost: 1 };
    } catch (err) {
      trace("prospeo", "error");
      if (err instanceof ProspeoError) prospeoError = err;
      else throw err;
    }
  }

  if (prospeoError) throw prospeoError;
  const guesses = t.domain ? suggestEmails(t.name, t.domain, await steps.learned()) : [];
  return { kind: "guess", guesses };
}
