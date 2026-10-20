import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { db as defaultDb, type Db } from "@/lib/db";
import { applicationQueue, discoveredJobs, jobs } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { assertPublicUrl, type Resolver } from "@/lib/jobs/fetch/guard";
import { canonicalizeUrl, parseJobUrl } from "@/lib/jobs/fetch/url";
import { enqueueUrls } from "@/lib/queue/service";
import { kickWorker } from "@/lib/queue/worker";

/**
 * "Saved to JSOS" on the Daily Job Shortlist (a claude.ai artifact) calls the `save_job` MCP tool, which lands here.
 * The pick joins the normal URL queue, so it is fetched, extracted and saved like any pasted link; the shortlist's
 * reasoning rides along as notes on the application, and the pick is listed on Discover with source "Claude.ai".
 * Fast on purpose: it never waits for the worker.
 */

/** How picks from the Daily Job Shortlist are labelled on Discover. */
export const SHORTLIST_SOURCE = "Claude.ai";

const text = (max: number) => z.string().trim().max(max).optional();

export const SaveJobInput = z.object({
  url: z.string().trim().min(1).max(2_000).describe("The job posting URL (http or https)"),
  title: text(300),
  company: text(200),
  location: text(200),
  mode: text(50).describe("Remote, Hybrid or On-site"),
  pay: text(200),
  posted: text(20).describe("YYYY-MM-DD, or empty"),
  track: text(50).describe("For example AI/LLM, Full-stack, Backend"),
  fit: z.number().int().min(0).max(100).optional().describe("Fit score, 0 to 100"),
  why: text(2_000).describe("Why it fits, and the main risk"),
  leadWith: text(2_000).describe("Which story to open with"),
  applyHow: text(1_000).describe("How to apply"),
  shortlistId: text(200).describe("The shortlist row id"),
});
export type SaveJobInput = z.infer<typeof SaveJobInput>;

export type SaveJobResult =
  | { state: "queued"; queueId: string; appUrl: string }
  | { state: "in_jobs"; jobId: string; appUrl: string }
  | { state: "not_added"; reason: string; appUrl: string };

export type SaveJobDeps = { db?: Db; kick?: () => void; resolve?: Resolver };

const ACTIVE = ["queued", "running", "needs_review"] as const;

/** The notes written on the application, one labelled line per field the shortlist sent. */
export function shortlistNotes(input: SaveJobInput): string {
  const about = [input.fit != null ? `fit ${input.fit}%` : "", input.track ?? ""].filter(Boolean).join(", ");
  const lines = [
    `From the Daily Job Shortlist${about ? ` (${about})` : ""}`,
    input.leadWith ? `Lead with: ${input.leadWith}` : "",
    input.applyHow ? `Apply: ${input.applyHow}` : "",
    input.why ? `Why: ${input.why}` : "",
    input.pay ? `Pay: ${input.pay}` : "",
  ];
  return lines.filter(Boolean).join("\n");
}

function appLink(path: string): string {
  return new URL(path, env().APP_URL).toString();
}

function notAdded(reason: string): SaveJobResult {
  return { state: "not_added", reason, appUrl: appLink("/new") };
}

async function activeQueueId(canonical: string, db: Db): Promise<string | null> {
  const rows = await db
    .select({ id: applicationQueue.id, input: applicationQueue.input, sourceUrl: applicationQueue.sourceUrl, kind: applicationQueue.kind })
    .from(applicationQueue)
    .where(inArray(applicationQueue.status, [...ACTIVE]));
  for (const r of rows) {
    const u = r.kind === "url" ? r.input : r.sourceUrl;
    try {
      if (u && canonicalizeUrl(u) === canonical) return r.id;
    } catch {
      // an old row with an unparseable URL cannot match
    }
  }
  return null;
}

/** Remembers the pick for Discover. The latest send of the same posting refreshes its fields. */
async function recordPick(input: SaveJobInput, canonicalUrl: string, result: SaveJobResult, db: Db) {
  const fields = {
    url: input.url,
    source: SHORTLIST_SOURCE,
    externalId: input.shortlistId || null,
    title: input.title ?? "",
    company: input.company ?? "",
    location: input.location ?? "",
    mode: input.mode ?? "",
    pay: input.pay ?? "",
    posted: input.posted ?? "",
    track: input.track ?? "",
    fit: input.fit ?? null,
    why: input.why ?? "",
    leadWith: input.leadWith ?? "",
    applyHow: input.applyHow ?? "",
    notAddedReason: result.state === "not_added" ? result.reason : null,
    updatedAt: new Date(),
    ...(result.state === "queued" ? { queueId: result.queueId } : {}),
  };
  await db
    .insert(discoveredJobs)
    .values({ canonicalUrl, ...fields })
    .onConflictDoUpdate({ target: discoveredJobs.canonicalUrl, set: fields });
}

/** Puts a shortlist pick into the queue, or says where it already is. Calling it twice is safe. */
export async function saveShortlistJob(raw: unknown, deps: SaveJobDeps = {}): Promise<SaveJobResult> {
  const db = deps.db ?? defaultDb();
  const input = SaveJobInput.parse(raw);

  let canonical: string;
  try {
    parseJobUrl(input.url);
    await assertPublicUrl(input.url, deps.resolve);
    canonical = canonicalizeUrl(input.url);
  } catch (err) {
    // Invalid and private URLs are refused without a trace on Discover.
    return notAdded(err instanceof Error ? err.message : "Not a valid URL");
  }

  const result = await addToQueue(input, canonical, db, deps);
  await recordPick(input, canonical, result, db);
  return result;
}

async function addToQueue(input: SaveJobInput, canonical: string, db: Db, deps: SaveJobDeps): Promise<SaveJobResult> {
  const [job] = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.canonicalUrl, canonical), isNull(jobs.deletedAt)))
    .limit(1);
  if (job) return { state: "in_jobs", jobId: job.id, appUrl: appLink(`/jobs?job=${job.id}`) };

  const existing = await activeQueueId(canonical, db);
  if (existing) return { state: "queued", queueId: existing, appUrl: appLink("/new") };

  let result: Awaited<ReturnType<typeof enqueueUrls>>;
  try {
    result = await enqueueUrls([input.url], db);
  } catch (err) {
    return notAdded(err instanceof Error ? err.message : "Could not add it to the queue");
  }
  const queueId = result.queued[0];
  if (!queueId) return notAdded(result.skipped[0]?.reason ?? "Could not add it to the queue");

  await db.update(applicationQueue).set({ notes: shortlistNotes(input) }).where(eq(applicationQueue.id, queueId));
  (deps.kick ?? kickWorker)();
  return { state: "queued", queueId, appUrl: appLink("/new") };
}
