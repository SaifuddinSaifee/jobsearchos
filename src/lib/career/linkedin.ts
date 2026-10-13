import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db as defaultDb } from "@/lib/db";
import { careerSources } from "@/lib/db/schema";
import type { DbOrTx } from "@/lib/documents/service";
import { PRIORITY, enqueueSource, type EnqueueOutcome } from "./queue";

// A LinkedIn profile saved as a PDF from the browser's print dialog. Only its text is kept, never the file.

/** Whole lines of page furniture and buttons that LinkedIn prints around the profile. */
const NOISE_LINES = new Set(
  [
    "skip to search",
    "skip to main content",
    "close jump menu",
    "home",
    "my network",
    "jobs",
    "messaging",
    "notifications",
    "me",
    "for business",
    "try premium for free",
    "retry premium free",
    "message",
    "connect",
    "follow",
    "following",
    "more",
    "contact info",
    "open to",
    "open to work",
    "add profile section",
    "enhance profile",
    "resources",
    "private to you",
    "show more",
    "show less",
    "see more",
    "see less",
    "endorse",
    "anyone on linkedin",
    "linkedin",
  ].map((l) => l.toLowerCase()),
);

/** Lines that are noise whatever they contain around the pattern. */
const NOISE_PATTERNS: RegExp[] = [
  /^page \d+ of \d+$/i,
  /^\d+\s*\/\s*\d+$/,
  // The browser's print header and footer: a date and time, or the address of the page with its page number.
  /^\d{1,2}\/\d{1,2}\/\d{2,4},?\s+\d{1,2}:\d{2}(\s*[AP]M)?(\s+.*)?$/i,
  /^https?:\/\/\S+(\s+\d+\s*\/\s*\d+)?$/i,
  // The page title the browser prints in its header: "(3) Jane Doe - Product Manager | LinkedIn".
  /^(\(\d+\)\s*)?.+\s\|\s*LinkedIn$/i,
  /^(\d[\d,]*\+?\s+)?(followers?|connections?|mutual connections?|profile views?|post impressions?|search appearances?)$/i,
  /^[\d,]+\+?\s+(followers?|connections?)\b.*$/i,
  /^show all\b.*$/i,
  /^[.…]*\s*(see|show) more$/i,
  /^endorsed by\b.*$/i,
  /^[\d,]+\s+endorsements?$/i,
  /^\d+ (mutual )?connections? in common$/i,
];

const looksLikeNoise = (line: string) => NOISE_LINES.has(line.toLowerCase()) || NOISE_PATTERNS.some((re) => re.test(line));

/**
 * Takes the print furniture out of text read from a LinkedIn PDF: navigation, buttons, counts, endorsements and the
 * browser's page headers. LinkedIn also prints much of its text twice (a visible copy and a hidden one for screen
 * readers), so a line repeated straight after itself is kept once. The rest is left word for word.
 */
export function cleanLinkedInText(text: string): string {
  const out: string[] = [];
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.replace(/[ \t]+/g, " ").trim();
    if (!line) {
      if (out.length > 0 && out[out.length - 1] !== "") out.push("");
      continue;
    }
    if (looksLikeNoise(line)) continue;
    if (out.length > 0 && out[out.length - 1] === line) continue;
    out.push(line);
  }
  while (out.length > 0 && out[out.length - 1] === "") out.pop();
  return out.join("\n");
}

/** Shortest cleaned text that can be a profile. Anything shorter is a wrong file, not a profile. */
export const MIN_LINKEDIN_CHARS = 200;

export class LinkedInError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LinkedInError";
  }
}

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

/** "LinkedIn profile, Oct 2026": says which print it is when there are several. */
export const linkedInLabel = (now: Date = new Date()) =>
  `LinkedIn profile, ${now.toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" })}`;

/**
 * Registers a LinkedIn print (its cleaned text) as a source and queues a proposal for it. The same text twice gives the
 * same source: it is skipped when it is already in the record or was left out, and not queued twice when it is open.
 */
export async function addLinkedInSource(
  rawText: string,
  db: DbOrTx = defaultDb(),
  now: Date = new Date(),
): Promise<EnqueueOutcome> {
  const text = cleanLinkedInText(rawText);
  if (text.length < MIN_LINKEDIN_CHARS) {
    throw new LinkedInError("There is not enough text in that file to be a LinkedIn profile. Save the profile page as a PDF from the print dialog.");
  }
  const contentSha256 = sha256(text);
  const [existing] = await db
    .select({ id: careerSources.id })
    .from(careerSources)
    .where(and(eq(careerSources.kind, "linkedin"), eq(careerSources.contentSha256, contentSha256)))
    .orderBy(desc(careerSources.createdAt))
    .limit(1);
  return enqueueSource(
    { kind: "linkedin", text, contentSha256, label: linkedInLabel(now) },
    PRIORITY.linkedin,
    db,
    existing?.id,
  );
}
