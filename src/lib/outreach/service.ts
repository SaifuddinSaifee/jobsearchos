import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { updateCompany } from "@/lib/companies/service";
import { SearchError, webSearch, type WebSearchProvider } from "@/lib/companies/search";
import { db as defaultDb, type Db } from "@/lib/db";
import { companies, contacts, jobs, jobSnapshots, outreachEmails, type ContactRow } from "@/lib/db/schema";
import { connectedAccount, sendEmail, type OutgoingEmail, type SentMessage } from "@/lib/email/gmail";
import { getColdEmailSettings } from "@/lib/email/settings";
import { env } from "@/lib/env";
import { checkEmail, isGenericInbox, sendWarnings, type SendWarning } from "./checks";
import { extractPostingPeople } from "./posting";
import { latestSearchForJob } from "./searches";
import { resolveEmail, type EmailResult, type EmailTrace } from "./email-finder";
import { detectPatterns, type PatternId } from "./patterns";
import { findPublicEmail } from "./public-email";
import { fetchYcCompany, ycTarget, type YcCompany } from "./yc";
import { enrichPerson, normalizeDomain, ProspeoError, searchPeople, searchTitles } from "./prospeo";
import { findPeopleOnWeb } from "./web";
import { rankCandidates, type Candidate } from "./rank";
import {
  CONTACT_KINDS,
  MAX_BODY,
  MAX_SUBJECT,
  type SearchItem,
  type SearchStepName,
  type SearchStepState,
  type ContactDTO,
  type ContactKind,
  type DraftDTO,
  type EmailStatus,
  type SentDTO,
} from "./types";

/** A failure with a message for the user. `needs` lists warnings that must be acknowledged before sending. */
export class OutreachError extends Error {
  constructor(
    message: string,
    readonly code: "invalid" | "not_found" | "not_connected" | "blocked" | "needs_ack" | "busy" | "send_failed",
    readonly needs?: SendWarning[],
  ) {
    super(message);
  }
}

const lower = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

// ---------------------------------------------------------------- contacts

export function toContactDTO(c: ContactRow, sentCount: number): ContactDTO {
  return {
    id: c.id,
    name: c.name,
    title: c.title,
    email: c.email,
    emailStatus: c.emailStatus,
    confidence: c.confidence,
    source: c.source,
    linkedinUrl: c.linkedinUrl,
    hasLookupId: Boolean(c.providerId),
    about: c.about,
    emailSource: c.emailSource,
    kind: c.kind,
    rank: c.rank,
    reason: c.reason,
    doNotContact: c.doNotContact,
    sentCount,
  };
}

async function sentCounts(jobId: string, db: Db): Promise<Map<string, number>> {
  const rows = await db
    .select({ contactId: outreachEmails.contactId, n: sql<number>`count(*)::int` })
    .from(outreachEmails)
    .where(and(eq(outreachEmails.jobId, jobId), eq(outreachEmails.status, "sent"), isNotNull(outreachEmails.contactId)))
    .groupBy(outreachEmails.contactId);
  return new Map(rows.map((r) => [r.contactId!, r.n]));
}

export async function listContacts(jobId: string, db: Db = defaultDb()): Promise<ContactDTO[]> {
  const [rows, counts] = await Promise.all([
    db
      .select()
      .from(contacts)
      .where(and(eq(contacts.jobId, jobId), isNull(contacts.deletedAt)))
      .orderBy(sql`${contacts.rank} asc nulls last`, asc(contacts.createdAt)),
    sentCounts(jobId, db),
  ]);
  return rows.map((c) => toContactDTO(c, counts.get(c.id) ?? 0));
}

async function getContact(id: string, db: Db): Promise<ContactRow> {
  const [c] = await db.select().from(contacts).where(and(eq(contacts.id, id), isNull(contacts.deletedAt)));
  if (!c) throw new OutreachError("That contact no longer exists.", "not_found");
  return c;
}

/** Emails marked do-not-contact on any job: once someone asks not to be emailed, they are never emailed again. */
async function blockedEmails(emails: string[], db: Db): Promise<Set<string>> {
  const list = emails.map(lower).filter(Boolean);
  if (list.length === 0) return new Set();
  const rows = await db
    .select({ email: contacts.email })
    .from(contacts)
    .where(and(eq(contacts.doNotContact, true), inArray(sql`lower(${contacts.email})`, list)));
  return new Set(rows.map((r) => lower(r.email)));
}

const ContactInput = z.object({
  name: z.string().trim().min(1, "Enter a name").max(200),
  title: z.string().trim().max(200).default(""),
  email: z
    .string()
    .trim()
    .max(320)
    .transform((v) => v.toLowerCase())
    .pipe(z.union([z.literal(""), z.email("Enter a valid email address")]))
    .default(""),
  kind: z.enum(CONTACT_KINDS).default("other"),
  linkedinUrl: z
    .string()
    .trim()
    .max(500)
    .pipe(z.union([z.literal(""), z.url("Enter a full URL starting with https://")]))
    .default(""),
});
export type ContactInput = z.input<typeof ContactInput>;

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === "23505" || e?.cause?.code === "23505";
}

export async function addContact(jobId: string, input: ContactInput, db: Db = defaultDb()): Promise<ContactDTO> {
  const v = ContactInput.parse(input);
  const email = v.email || null;
  const blocked = email ? await blockedEmails([email], db) : new Set<string>();
  try {
    const [row] = await db
      .insert(contacts)
      .values({
        jobId,
        name: v.name,
        title: v.title,
        email,
        emailStatus: email ? "unverified" : "none",
        emailSource: email ? "Added by you" : null,
        source: "manual",
        kind: v.kind,
        linkedinUrl: v.linkedinUrl || null,
        doNotContact: blocked.size > 0,
      })
      .returning();
    return toContactDTO(row, 0);
  } catch (err) {
    if (isUniqueViolation(err)) throw new OutreachError("Someone with that email is already in the list.", "invalid");
    throw err;
  }
}

export async function updateContact(id: string, input: ContactInput, db: Db = defaultDb()): Promise<ContactDTO> {
  const v = ContactInput.parse(input);
  const current = await getContact(id, db);
  const email = v.email || null;
  const changed = lower(email) !== lower(current.email);
  try {
    const [row] = await db
      .update(contacts)
      .set({
        name: v.name,
        title: v.title,
        email,
        kind: v.kind,
        linkedinUrl: v.linkedinUrl || null,
        ...(changed ? { emailStatus: (email ? "unverified" : "none") as EmailStatus, emailSource: email ? "Added by you" : null, confidence: null } : {}),
        updatedAt: new Date(),
      })
      .where(eq(contacts.id, id))
      .returning();
    return toContactDTO(row, 0);
  } catch (err) {
    if (isUniqueViolation(err)) throw new OutreachError("Someone with that email is already in the list.", "invalid");
    throw err;
  }
}

export async function removeContact(id: string, db: Db = defaultDb()): Promise<void> {
  await db.update(contacts).set({ deletedAt: new Date() }).where(eq(contacts.id, id));
  // A draft addressed to a removed contact must not silently go to someone else.
  await db.update(outreachEmails).set({ contactId: null }).where(and(eq(outreachEmails.contactId, id), eq(outreachEmails.status, "draft")));
}

/** Applies to every job: the person is never emailed again. */
export async function setDoNotContact(id: string, value: boolean, db: Db = defaultDb()): Promise<void> {
  const c = await getContact(id, db);
  const where = c.email ? sql`lower(${contacts.email}) = ${lower(c.email)}` : eq(contacts.id, id);
  await db.update(contacts).set({ doNotContact: value, updatedAt: new Date() }).where(where);
}

/** Prospeo errors carry a message written for the user; anything else is passed through as a generic failure. */
async function viaProspeo<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ProspeoError) throw new OutreachError(err.message, "blocked");
    throw err;
  }
}

/** The user confirmed the address themselves (for example by checking it exists), so it counts as verified. */
export async function markVerified(id: string, db: Db = defaultDb()): Promise<void> {
  const c = await getContact(id, db);
  if (!c.email) throw new OutreachError("Add an email address first.", "invalid");
  await db.update(contacts).set({ emailStatus: "verified", updatedAt: new Date() }).where(eq(contacts.id, id));
}

type JobContext = {
  job: typeof jobs.$inferSelect;
  company: typeof companies.$inferSelect | null;
  rawText: string;
  /** Every URL this posting is known by, for recognising Y Combinator jobs. */
  urls: (string | null)[];
};

async function jobContext(jobId: string, db: Db): Promise<JobContext> {
  const [job] = await db.select().from(jobs).where(and(eq(jobs.id, jobId), isNull(jobs.deletedAt)));
  if (!job) throw new OutreachError("That job no longer exists.", "not_found");
  const [company] = job.companyId ? await db.select().from(companies).where(eq(companies.id, job.companyId)) : [];
  const [snap] = await db
    .select({ rawText: jobSnapshots.rawText, sourceUrl: jobSnapshots.sourceUrl })
    .from(jobSnapshots)
    .where(eq(jobSnapshots.jobId, jobId))
    .orderBy(desc(jobSnapshots.fetchedAt))
    .limit(1);
  return { job, company: company ?? null, rawText: snap?.rawText ?? "", urls: [job.canonicalUrl, job.applicationUrl, snap?.sourceUrl ?? null] };
}

export type RevealDeps = {
  enrich?: typeof enrichPerson;
  /** Web search for a published address; defaults to Tavily when TAVILY_API_KEY is set. */
  search?: WebSearchProvider | null;
  publicEmail?: typeof findPublicEmail;
  /** Reports which source answered (used by the background search to show progress). */
  trace?: EmailTrace;
};

/** Address formats already in use at a company, learned from the addresses we hold for its people. Most used first. */
export async function learnedPatterns(domain: string | null, db: Db = defaultDb()): Promise<PatternId[]> {
  if (!domain) return [];
  const rows = await db
    .select({ name: contacts.name, email: contacts.email })
    .from(contacts)
    .where(and(isNull(contacts.deletedAt), sql`lower(${contacts.email}) like ${`%@${domain.toLowerCase()}`}`));
  const counts = new Map<PatternId, number>();
  for (const r of rows) for (const id of detectPatterns(r.name, r.email ?? "")) counts.set(id, (counts.get(id) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}

/**
 * Finds a person's work email, cheapest source first (see `resolveEmail`): an address already saved for them,
 * a public web search, then Prospeo (one credit, charged only when a verified address is found). A found address is
 * saved with where it came from. If only format guesses are possible, nothing is saved and the guesses are returned.
 */
export async function revealContactEmail(id: string, deps: RevealDeps = {}, db: Db = defaultDb()): Promise<EmailResult> {
  const c = await getContact(id, db);
  const { company } = await jobContext(c.jobId, db);
  const domain = normalizeDomain(company?.website ?? "");
  const parts = c.name.trim().split(/\s+/);
  if (!c.providerId && !c.linkedinUrl && !domain) throw new OutreachError("Add the company's website first, so the address can be found.", "blocked");
  if (!c.providerId && !c.linkedinUrl && parts.length < 2) throw new OutreachError("A first and last name are needed to find an address.", "invalid");

  const key = env().PROSPEO_API_KEY ?? null;
  const search = deps.search === undefined ? webSearch() : deps.search;

  const result = await viaProspeo(() =>
    resolveEmail(
      { name: c.name, linkedinUrl: c.linkedinUrl, providerId: c.providerId, domain },
      {
        known: async (t) => {
          const same = [t.linkedinUrl ? sql`lower(${contacts.linkedinUrl}) = ${t.linkedinUrl.toLowerCase()}` : undefined, domain ? and(sql`lower(${contacts.name}) = ${t.name.toLowerCase()}`, sql`lower(${contacts.email}) like ${`%@${domain}`}`) : undefined].filter((x) => x !== undefined);
          if (same.length === 0) return null;
          const [row] = await db
            .select({ email: contacts.email, status: contacts.emailStatus })
            .from(contacts)
            .where(and(isNull(contacts.deletedAt), isNotNull(contacts.email), sql`${contacts.id} <> ${id}`, or(...same)))
            .orderBy(sql`(${contacts.emailStatus} = 'verified') desc`)
            .limit(1);
          return row?.email ? { email: row.email, status: row.status } : null;
        },
        publicSearch: search && domain ? (t) => (deps.publicEmail ?? findPublicEmail)({ name: t.name }, domain, search) : null,
        prospeo: key
          ? (t) => (deps.enrich ?? enrichPerson)({ personId: t.providerId, linkedinUrl: t.linkedinUrl, firstName: parts[0], lastName: parts.slice(1).join(" "), domain: t.domain }, key)
          : null,
        learned: () => learnedPatterns(domain, db),
      },
      { trace: deps.trace },
    ),
  );

  if (result.kind === "found") {
    try {
      await db
        .update(contacts)
        .set({ email: result.email, emailStatus: result.status, emailSource: result.source, confidence: null, updatedAt: new Date() })
        .where(eq(contacts.id, id));
    } catch (err) {
      if (isUniqueViolation(err)) throw new OutreachError("Someone with that email is already in the list.", "invalid");
      throw err;
    }
  }
  return result;
}

/** Saves the company's website (used to find people) and returns the domain used to search for people. */
export async function setJobCompanyWebsite(jobId: string, website: string, db: Db = defaultDb()): Promise<string | null> {
  const { job } = await jobContext(jobId, db);
  if (!job.companyId) throw new OutreachError("This job has no company profile to save the website on.", "invalid");
  const domain = normalizeDomain(website);
  if (website.trim() && !domain) throw new OutreachError("Enter a website such as acme.com.", "invalid");
  await updateCompany(job.companyId, { website: domain ? `https://${domain}` : "" }, db);
  return domain;
}

// ------------------------------------------------------------ find contacts

type Found = {
  name: string;
  title: string;
  email: string | null;
  emailStatus: EmailStatus;
  /** Where the address came from, when there is one. */
  emailSource: string | null;
  confidence: number | null;
  source: "posting" | "yc" | "web" | "prospeo";
  /** The finder's id for this person, kept so their email can be revealed later. */
  providerId: string | null;
  linkedinUrl: string | null;
  /** A short bio (for a Y Combinator founder, their own words). */
  about: string;
  kind: ContactKind;
  department: string;
  seniority: string;
  fromPosting: boolean;
  /** Facts about how we know this person, handed to the ranking model (never shown as the reason). */
  note: string;
  score: number;
  reason: string;
};

const MAX_KEPT = 12;
const words = (n: string) => n.trim().toLowerCase().split(/\s+/).filter(Boolean);

/** Same person: equal names, or a first name alone ("Ray") matching the first name of a full one ("Ray Fitzgerald"). */
function sameName(a: string, b: string): boolean {
  const x = words(a);
  const y = words(b);
  if (x.join(" ") === y.join(" ")) return true;
  if (x.length === 1 && y.length > 1) return x[0] === y[0];
  if (y.length === 1 && x.length > 1) return y[0] === x[0];
  return false;
}

/** The one candidate this name refers to; none when it matches nobody or is ambiguous (two people called Ray). */
function findSame(list: Found[], name: string): Found | undefined {
  const m = list.filter((f) => sameName(f.name, name));
  return m.length === 1 ? m[0] : undefined;
}

/** Folds what a second source knows about the same person into the first entry, never overwriting what it has. */
function mergeInto(into: Found, from: Found): void {
  if (words(into.name).length === 1 && words(from.name).length > 1) into.name = from.name;
  into.title ||= from.title;
  into.linkedinUrl ||= from.linkedinUrl;
  into.about ||= from.about;
  into.providerId ||= from.providerId;
  if (!into.email && from.email) {
    into.email = from.email;
    into.emailStatus = from.emailStatus;
    into.emailSource = from.emailSource;
  }
  if (into.kind === "other") into.kind = from.kind;
  into.fromPosting ||= from.fromPosting;
  if (from.note && !into.note.includes(from.note)) into.note = [into.note, from.note].filter(Boolean).join("; ");
}

export type FindResult = { found: number; notes: string[] };

export type FindDeps = {
  /** People search at the company; defaults to Prospeo when PROSPEO_API_KEY is set. */
  lookup?: typeof searchPeople;
  /** Web search; defaults to Tavily when TAVILY_API_KEY is set. */
  search?: WebSearchProvider | null;
  web?: typeof findPeopleOnWeb;
  posting?: typeof extractPostingPeople;
  rank?: typeof rankCandidates;
  /** Reads the company's Y Combinator page; defaults to fetching it. */
  yc?: typeof fetchYcCompany;
  /** Overrides for the automatic email lookup of the best match. */
  reveal?: RevealDeps;
  /** Called as each step starts and finishes, so a background search can show its progress. */
  onStep?: (name: SearchStepName, state: SearchStepState) => void;
};

/**
 * Finds the people who could hire for a job and ranks them. Sources, in order of how much they are trusted:
 * the company's Y Combinator page (founders with their full names, LinkedIn and bio, free), the people the posting
 * names, a web search, and Prospeo's people at the company's exact website. The same person from different sources
 * is merged, so "Ray" in the posting becomes "Ray Fitzgerald" from the YC page. The model then ranks everyone, and
 * the best match's email is looked up if the settings say so. People added by hand are never touched, and a failing
 * source only adds a note.
 */
export async function findContacts(jobId: string, deps: FindDeps = {}, db: Db = defaultDb()): Promise<FindResult> {
  const { job, company, rawText, urls } = await jobContext(jobId, db);
  const settings = await getColdEmailSettings(db);
  const notes: string[] = [];
  const step = deps.onStep ?? (() => {});
  const list: Found[] = [];
  const add = (f: Found) => {
    const same = findSame(list, f.name);
    if (same) mergeInto(same, f);
    else list.push(f);
  };
  const blank = {
    emailStatus: "none" as EmailStatus,
    emailSource: null as string | null,
    confidence: null,
    providerId: null as string | null,
    linkedinUrl: null as string | null,
    about: "",
    department: "",
    seniority: "",
    note: "",
    score: 0,
    reason: "",
  };

  // 1. The company's Y Combinator page: free, one request, and it gives the real website the other sources need.
  let yc: YcCompany | null = null;
  if (!ycTarget(urls)) {
    step("yc", { status: "skipped", detail: "Not a Y Combinator job" });
  } else {
    step("yc", { status: "running" });
    try {
      yc = await (deps.yc ?? fetchYcCompany)(urls);
      step("yc", { status: "done", detail: `${yc?.founders.length ?? 0} founders` });
    } catch (err) {
      step("yc", { status: "failed" });
      notes.push(err instanceof Error ? err.message : "The Y Combinator page could not be read.");
    }
  }
  let website = company?.website ?? "";
  if (yc?.website && !normalizeDomain(website)) {
    website = yc.website;
    if (company) await updateCompany(company.id, { website }, db);
    notes.push(`Set the company website to ${normalizeDomain(website)} from its Y Combinator page.`);
  }
  for (const f of yc?.founders ?? []) {
    add({ ...blank, name: f.name, title: f.title, email: null, source: "yc", linkedinUrl: f.linkedinUrl, about: f.bio, kind: "founder", fromPosting: false, note: "founder listed on the company's Y Combinator page" });
  }

  const apiKey = env().PROSPEO_API_KEY;
  const domain = normalizeDomain(website);
  const search = deps.search === undefined ? webSearch() : deps.search;

  // 2. The three other sources do not depend on each other, so they run at the same time. Their results are merged in
  // a fixed order afterwards, so the outcome never depends on which one answered first.
  const track = async <T,>(name: SearchStepName, run: () => Promise<T[]>): Promise<T[]> => {
    step(name, { status: "running" });
    try {
      const out = await run();
      step(name, { status: "done", detail: out.length === 1 ? "1 person" : `${out.length} people` });
      return out;
    } catch (err) {
      step(name, { status: "failed" });
      throw err;
    }
  };
  if (!search) step("web", { status: "skipped", detail: "Not set up" });
  if (!apiKey) step("prospeo", { status: "skipped", detail: "Not set up" });
  const [postingRes, webRes, lookupRes] = await Promise.allSettled([
    track("posting", () => (deps.posting ?? extractPostingPeople)(rawText)),
    search ? track("web", () => (deps.web ?? findPeopleOnWeb)({ company: job.company, jobTitle: job.title, domain }, search)) : Promise.resolve([]),
    apiKey ? track("prospeo", () => (deps.lookup ?? searchPeople)({ domain, company: job.company, titles: searchTitles(job.title) }, apiKey)) : Promise.resolve([]),
  ]);

  if (postingRes.status === "fulfilled") {
    for (const p of postingRes.value) {
      add({
        ...blank,
        name: p.name,
        title: p.title,
        email: p.email,
        emailStatus: p.email ? "unverified" : "none",
        emailSource: p.email ? "Written in the posting" : null,
        source: "posting",
        kind: p.kind,
        fromPosting: true,
        note: `named in the job posting${p.evidence ? `: "${p.evidence}"` : ""}`,
      });
    }
  } else notes.push("Could not read names from the posting.");

  if (webRes.status === "fulfilled") {
    for (const p of webRes.value) add({ ...blank, name: p.name, title: p.title, email: null, source: "web", linkedinUrl: p.linkedinUrl, kind: p.kind, fromPosting: false });
  } else notes.push(webRes.reason instanceof SearchError ? webRes.reason.message : "The web search failed. Try again in a moment.");
  if (!search) notes.push("Web search is not set up. Add TAVILY_API_KEY to .env to search for people at the company.");

  if (lookupRes.status === "fulfilled") {
    for (const h of lookupRes.value) {
      add({ ...blank, name: h.fullName, title: h.title, email: null, source: "prospeo", providerId: h.personId, linkedinUrl: h.linkedinUrl, kind: "other", fromPosting: false });
    }
  } else notes.push(lookupRes.reason instanceof ProspeoError ? lookupRes.reason.message : "The company lookup failed. Try again in a moment.");
  if (!search && !apiKey && !yc) notes.push("Without a search or lookup key, only names from the posting can be found. You can still add people by hand.");

  // 3. Rank everyone against the role.
  let ranked = list.filter((f) => !(f.email && isGenericInbox(f.email) && settings.excludeGenericInboxes));
  if (ranked.length === 0) step("rank", { status: "skipped", detail: "No one to rank" });
  if (ranked.length > 0) {
    step("rank", { status: "running" });
    const indexed: Candidate[] = ranked.map((f, id) => ({
      id,
      name: f.name,
      title: f.title,
      department: f.department,
      seniority: f.seniority,
      fromPosting: f.fromPosting,
      note: f.note,
    }));
    const context = yc
      ? [`Y Combinator${yc.batch ? ` ${yc.batch}` : ""} startup`, ...(yc.teamSize ? [`team of ${yc.teamSize} people`] : [])]
      : [];
    try {
      const out = await (deps.rank ?? rankCandidates)(
        { title: job.title, company: job.company, responsibilities: job.responsibilities, context },
        indexed,
      );
      for (const r of out) {
        const f = ranked[r.id];
        if (f) Object.assign(f, { kind: r.kind, score: r.score, reason: r.reason });
      }
    } catch {
      notes.push("Could not rank the people automatically. They are listed with the posting's names first.");
      ranked.forEach((f) => (f.score = f.fromPosting ? 60 : f.source === "yc" ? 50 : 30));
    }
    step("rank", { status: "done" });
    ranked = ranked.sort((a, b) => b.score - a.score).filter((f, i) => i < MAX_KEPT || f.fromPosting);
  }

  // 4. Save them.
  const blocked = await blockedEmails(ranked.map((f) => f.email ?? ""), db);
  await db.transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(contacts)
      .where(and(eq(contacts.jobId, jobId), isNull(contacts.deletedAt)));
    // The same person is recognised by address or by name: a contact whose address was revealed earlier must still match
    // a fresh result that has no address yet, or its address would be lost and paid for again.
    const byEmail = new Map(existing.filter((c) => c.email).map((c) => [lower(c.email), c]));
    const byName = new Map(existing.map((c) => [lower(c.name), c]));
    const used = new Set<string>();

    for (const [i, f] of ranked.entries()) {
      const match = (f.email ? byEmail.get(lower(f.email)) : undefined) ?? byName.get(lower(f.name));
      used.add(match?.id ?? "");
      const values = {
        title: f.title,
        emailStatus: f.emailStatus,
        emailSource: f.emailSource,
        confidence: f.confidence,
        linkedinUrl: f.linkedinUrl,
        providerId: f.providerId,
        about: f.about,
        kind: f.kind,
        rank: i + 1,
        reason: f.reason,
        updatedAt: new Date(),
      };
      if (match) {
        // Keep what a person typed or revealed (name, address, a manual verification) when the same person is found again.
        const keepsOwn = match.source === "manual" || Boolean(match.email);
        await tx
          .update(contacts)
          .set(
            match.source === "manual"
              ? { rank: i + 1, reason: f.reason, kind: match.kind, updatedAt: new Date() }
              : keepsOwn
                ? { ...values, emailStatus: match.emailStatus, emailSource: match.emailSource, confidence: match.confidence }
                : values,
          )
          .where(eq(contacts.id, match.id));
      } else {
        await tx.insert(contacts).values({
          jobId,
          name: f.name,
          email: f.email,
          source: f.source,
          doNotContact: Boolean(f.email && blocked.has(lower(f.email))),
          ...values,
        });
      }
    }

    // Earlier automatic results that did not come back are removed unless an email was already sent to them.
    const stale = existing.filter((c) => c.source !== "manual" && !used.has(c.id));
    if (stale.length > 0) {
      const sentTo = new Set(
        (await tx.select({ id: outreachEmails.contactId }).from(outreachEmails).where(and(eq(outreachEmails.jobId, jobId), eq(outreachEmails.status, "sent")))).map((r) => r.id),
      );
      const drop = stale.filter((c) => !sentTo.has(c.id) && !c.doNotContact).map((c) => c.id);
      const keep = stale.filter((c) => !drop.includes(c.id)).map((c) => c.id);
      if (drop.length) await tx.update(contacts).set({ deletedAt: new Date() }).where(inArray(contacts.id, drop));
      if (keep.length) await tx.update(contacts).set({ rank: null }).where(inArray(contacts.id, keep));
    }
  });

  // 5. The best match's email, when the settings ask for it and we are sure who they are.
  const best = ranked[0];
  const sure = best && (best.fromPosting || best.source === "yc" || best.score >= 85) && words(best.name).length >= 2;
  if (!settings.autoRevealBest) step("email", { status: "skipped", detail: "Turned off in Settings" });
  else if (!best) step("email", { status: "skipped", detail: "No one to look up" });
  else if (!sure) step("email", { status: "skipped", detail: "Not sure enough who to look up" });
  else {
    const [row] = await db
      .select()
      .from(contacts)
      .where(and(eq(contacts.jobId, jobId), isNull(contacts.deletedAt), eq(contacts.rank, 1)));
    if (!row || row.doNotContact) step("email", { status: "skipped", detail: "No one to look up" });
    else if (row.email) step("email", { status: "skipped", detail: "Already has an email" });
    else if (!domain && !row.providerId && !row.linkedinUrl) step("email", { status: "skipped", detail: "Needs the company website" });
    else {
      step("email", { status: "running" });
      try {
        // The lookup reuses this run's search provider unless it was told otherwise.
        const res = await revealContactEmail(row.id, { search: deps.search, ...deps.reveal }, db);
        if (res.kind === "found") {
          step("email", { status: "done", detail: `${res.email}, ${res.source}${res.cost ? ` (${res.cost} credit)` : ""}` });
          notes.push(`Found ${row.name}'s email: ${res.email} (${res.source}${res.cost ? `, ${res.cost} Prospeo credit` : ", free"}).`);
        } else {
          step("email", { status: "done", detail: "No verified address found" });
          notes.push(`No verified email found for ${row.name}. Open the menu on their card to see likely addresses.`);
        }
      } catch (err) {
        step("email", { status: "failed" });
        notes.push(err instanceof OutreachError ? err.message : `Could not look up ${row.name}'s email.`);
      }
    }
  }

  if (ranked.length === 0 && notes.length === 0) notes.push("No one was found for this company. Add a contact by hand.");
  return { found: ranked.length, notes };
}

// ------------------------------------------------------------------- drafts

const DraftInput = z.object({
  subject: z.string().max(MAX_SUBJECT, "The subject is too long"),
  body: z.string().max(MAX_BODY, "The email is too long"),
});

function toDraftDTO(d: typeof outreachEmails.$inferSelect): DraftDTO {
  return { id: d.id, contactId: d.contactId, subject: d.subject, body: d.body, updatedAt: d.updatedAt.toISOString() };
}

export async function getDraft(jobId: string, db: Db = defaultDb()): Promise<DraftDTO | null> {
  const [d] = await db
    .select()
    .from(outreachEmails)
    .where(and(eq(outreachEmails.jobId, jobId), eq(outreachEmails.status, "draft")));
  return d ? toDraftDTO(d) : null;
}

/** `contactId`: leave out to keep the current recipient, null to clear it. */
export async function saveDraft(
  jobId: string,
  input: { subject: string; body: string; contactId?: string | null },
  db: Db = defaultDb(),
): Promise<DraftDTO> {
  const v = DraftInput.parse({ subject: input.subject, body: input.body });
  if (input.contactId) {
    const c = await getContact(input.contactId, db);
    if (c.jobId !== jobId) throw new OutreachError("That contact belongs to a different job.", "invalid");
  }
  const [row] = await db
    .insert(outreachEmails)
    .values({ jobId, subject: v.subject, body: v.body, contactId: input.contactId ?? null })
    .onConflictDoUpdate({
      target: outreachEmails.jobId,
      targetWhere: sql`${outreachEmails.status} = 'draft'`,
      set: {
        subject: v.subject,
        body: v.body,
        ...(input.contactId !== undefined ? { contactId: input.contactId } : {}),
        updatedAt: new Date(),
      },
    })
    .returning();
  return toDraftDTO(row);
}

// --------------------------------------------------------------------- sent

export async function listSent(jobId: string, db: Db = defaultDb()): Promise<SentDTO[]> {
  const rows = await db
    .select({ e: outreachEmails, contactName: contacts.name })
    .from(outreachEmails)
    .leftJoin(contacts, eq(contacts.id, outreachEmails.contactId))
    .where(and(eq(outreachEmails.jobId, jobId), eq(outreachEmails.status, "sent")))
    .orderBy(desc(outreachEmails.sentAt));
  return rows.map(({ e, contactName }) => ({
    id: e.id,
    contactId: e.contactId,
    contactName: contactName ?? e.toEmail ?? "Unknown",
    toEmail: e.toEmail ?? "",
    subject: e.subject,
    body: e.body,
    threadId: e.gmailThreadId,
    sentAt: (e.sentAt ?? e.createdAt).toISOString(),
  }));
}

/** Emails sent since midnight (machine time), across all jobs; compared with the daily limit. */
export async function sentToday(db: Db = defaultDb(), now = new Date()): Promise<number> {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(outreachEmails)
    .where(and(eq(outreachEmails.status, "sent"), gte(outreachEmails.sentAt, start)));
  return r?.n ?? 0;
}

/** Copies a sent email into the working draft (without a recipient), to adapt it for someone else. */
export async function reuseAsDraft(jobId: string, sentId: string, db: Db = defaultDb()): Promise<DraftDTO> {
  const [e] = await db.select().from(outreachEmails).where(and(eq(outreachEmails.id, sentId), eq(outreachEmails.jobId, jobId)));
  if (!e) throw new OutreachError("That email no longer exists.", "not_found");
  return saveDraft(jobId, { subject: e.subject, body: e.body, contactId: null }, db);
}

export type SendDeps = { send?: (m: OutgoingEmail) => Promise<SentMessage>; now?: Date };

/**
 * Sends the job's draft to its selected contact. Every rule is checked here, not only in the UI: no recipient,
 * invalid or do-not-contact addresses, unfilled placeholders, the daily limit, and each warning the user must
 * acknowledge (`acknowledge` lists the warning codes they confirmed).
 */
export async function sendDraft(
  jobId: string,
  opts: { acknowledge?: string[] } = {},
  deps: SendDeps = {},
  db: Db = defaultDb(),
): Promise<SentDTO> {
  const now = deps.now ?? new Date();
  const [draft] = await db
    .select()
    .from(outreachEmails)
    .where(and(eq(outreachEmails.jobId, jobId), eq(outreachEmails.status, "draft")));
  if (!draft) throw new OutreachError("There is no draft to send.", "not_found");
  if (!draft.contactId) throw new OutreachError("Choose who to send this to.", "invalid");

  const contact = await getContact(draft.contactId, db);
  if (!contact.email) throw new OutreachError(`${contact.name} has no email address yet.`, "invalid");
  if (contact.emailStatus === "invalid") throw new OutreachError(`${contact.email} is not a working address. Fix it or choose someone else.`, "blocked");
  if (contact.doNotContact || (await blockedEmails([contact.email], db)).size > 0) {
    throw new OutreachError(`${contact.name} is marked do not contact.`, "blocked");
  }

  const settings = await getColdEmailSettings(db);
  const errors = checkEmail({ subject: draft.subject, body: draft.body }, settings).filter((c) => c.level === "error");
  if (errors.length > 0) throw new OutreachError(errors[0].message, "invalid");

  const account = await connectedAccount(db);
  if (!account) throw new OutreachError("Connect Gmail in Settings first.", "not_connected");
  if (account.needsReconnect) throw new OutreachError("Gmail needs to be reconnected in Settings.", "not_connected");

  if ((await sentToday(db, now)) >= settings.dailyCap) {
    throw new OutreachError(`You have reached your daily limit of ${settings.dailyCap} emails. It resets at midnight, or change it in Settings.`, "blocked");
  }

  const sent = (await sentCounts(jobId, db)).get(contact.id) ?? 0;
  const acknowledged = new Set(opts.acknowledge ?? []);
  const needs = sendWarnings({ name: contact.name, emailStatus: contact.emailStatus, sentCount: sent }, settings, now).filter((w) => !acknowledged.has(w.code));
  if (needs.length > 0) throw new OutreachError("Confirm the warnings before sending.", "needs_ack", needs);

  // Claim the draft so a double click cannot send twice.
  const [claimed] = await db
    .update(outreachEmails)
    .set({ status: "sending", updatedAt: now })
    .where(and(eq(outreachEmails.id, draft.id), eq(outreachEmails.status, "draft")))
    .returning();
  if (!claimed) throw new OutreachError("This email is already being sent.", "busy");

  try {
    const message = await (deps.send ?? ((m) => sendEmail(m, db)))({
      to: contact.email,
      subject: draft.subject.trim(),
      body: draft.body.trim(),
      bcc: settings.bccSelf ? account.email : undefined,
    });
    const [row] = await db
      .update(outreachEmails)
      .set({
        status: "sent",
        toEmail: contact.email,
        gmailMessageId: message.messageId,
        gmailThreadId: message.threadId,
        sentAt: now,
        error: null,
        updatedAt: now,
      })
      .where(eq(outreachEmails.id, draft.id))
      .returning();
    return {
      id: row.id,
      contactId: contact.id,
      contactName: contact.name,
      toEmail: contact.email,
      subject: row.subject,
      body: row.body,
      threadId: row.gmailThreadId,
      sentAt: row.sentAt!.toISOString(),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sending failed";
    try {
      await db.update(outreachEmails).set({ status: "draft", error: message, updatedAt: new Date() }).where(eq(outreachEmails.id, draft.id));
    } catch {
      // The user saved a newer draft while this one was sending: keep this one as a failed record.
      await db.update(outreachEmails).set({ status: "failed", error: message }).where(eq(outreachEmails.id, draft.id));
    }
    throw new OutreachError(message, "send_failed");
  }
}

// ------------------------------------------------------------------ the page

export type OutreachData = {
  contacts: ContactDTO[];
  draft: DraftDTO | null;
  sent: SentDTO[];
  sentToday: number;
  /** Saved company website as a domain (to search the company and suggest address formats); null when unknown. */
  domain: string | null;
  canSaveWebsite: boolean;
  account: { email: string; needsReconnect: boolean } | null;
  settings: Awaited<ReturnType<typeof getColdEmailSettings>>;
  /** Which sources "Find people" can use, so the page can say what is missing. */
  sources: { posting: true; web: boolean; prospeo: boolean };
  /** The latest "find people" run for this job (working, or finished), so the page can pick up where it left off. */
  search: SearchItem | null;
  /** Address formats already seen at the company, to order the suggestions. */
  patterns: PatternId[];
};

export async function getOutreachData(jobId: string, db: Db = defaultDb()): Promise<OutreachData> {
  const { company, job } = await jobContext(jobId, db);
  const [contactList, draft, sent, today, settings, account, search] = await Promise.all([
    listContacts(jobId, db),
    getDraft(jobId, db),
    listSent(jobId, db),
    sentToday(db),
    getColdEmailSettings(db),
    connectedAccount(db),
    latestSearchForJob(jobId, db),
  ]);
  const e = env();
  return {
    contacts: contactList,
    draft,
    sent,
    sentToday: today,
    domain: normalizeDomain(company?.website ?? ""),
    canSaveWebsite: Boolean(job.companyId),
    account: account ? { email: account.email, needsReconnect: account.needsReconnect } : null,
    settings,
    sources: { posting: true, web: Boolean(e.TAVILY_API_KEY), prospeo: Boolean(e.PROSPEO_API_KEY) },
    search,
    patterns: await learnedPatterns(normalizeDomain(company?.website ?? ""), db),
  };
}

/** What the client needs refreshed after a change to contacts or sent mail. */
export async function snapshot(jobId: string, db: Db = defaultDb()) {
  const [contactList, sent, today] = await Promise.all([listContacts(jobId, db), listSent(jobId, db), sentToday(db)]);
  return { contacts: contactList, sent, sentToday: today };
}
