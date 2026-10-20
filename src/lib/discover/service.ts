import { desc, eq, inArray, sql } from "drizzle-orm";
import { db as defaultDb, type Db } from "@/lib/db";
import { applicationQueue, applications, discoveredJobs, jobs } from "@/lib/db/schema";
import { saveShortlistJob, type SaveJobDeps, type SaveJobResult } from "@/lib/shortlist/save";
import { discoverState, type DiscoveredJob } from "./types";

/**
 * Discover: jobs that came from outside the app (today, picks from the Daily Job Shortlist on claude.ai), newest
 * first, each with where it is now. The job is found by its posting URL or through the queue item it was added as,
 * so a job saved under a slightly different URL, or as a duplicate of one already saved, still shows as in Jobs.
 */
export async function listDiscovered(db: Db = defaultDb()): Promise<DiscoveredJob[]> {
  const rows = await db
    .select({
      d: discoveredJobs,
      queueStatus: applicationQueue.status,
      queueError: applicationQueue.error,
      jobId: sql<string | null>`(select ${jobs.id} from ${jobs} where ${jobs.deletedAt} is null and (${jobs.canonicalUrl} = ${discoveredJobs.canonicalUrl} or ${jobs.id} = ${applicationQueue.jobId} or ${jobs.id} = ${applicationQueue.duplicateJobId}) limit 1)`,
    })
    .from(discoveredJobs)
    .leftJoin(applicationQueue, eq(applicationQueue.id, discoveredJobs.queueId))
    .orderBy(desc(discoveredJobs.createdAt));

  const jobIds = [...new Set(rows.map((r) => r.jobId).filter((id): id is string => !!id))];
  const statuses = new Map(
    jobIds.length
      ? (await db.select({ jobId: applications.jobId, status: applications.status }).from(applications).where(inArray(applications.jobId, jobIds))).map(
          (a) => [a.jobId, a.status],
        )
      : [],
  );

  return rows.map(({ d, queueStatus, queueError, jobId }) => {
    const state = discoverState({ jobId, queueStatus, notAddedReason: d.notAddedReason });
    return {
      id: d.id,
      url: d.url,
      source: d.source,
      title: d.title,
      company: d.company,
      location: d.location,
      mode: d.mode,
      pay: d.pay,
      posted: d.posted,
      track: d.track,
      fit: d.fit,
      why: d.why,
      leadWith: d.leadWith,
      applyHow: d.applyHow,
      createdAt: d.createdAt.toISOString(),
      state,
      reason: state === "not_added" ? d.notAddedReason : state === "review" || state === "failed" ? queueError : null,
      queueId: d.queueId,
      jobId,
      jobStatus: jobId ? (statuses.get(jobId) ?? null) : null,
    };
  });
}

/** Sends a discovered job through `save_job` again, with the fields it arrived with (after its job was removed). */
export async function addDiscoveredAgain(id: string, deps: SaveJobDeps = {}): Promise<SaveJobResult> {
  const db = deps.db ?? defaultDb();
  const [d] = await db.select().from(discoveredJobs).where(eq(discoveredJobs.id, id));
  if (!d) throw new Error("That job is no longer on Discover");
  return saveShortlistJob(
    {
      url: d.url,
      title: d.title || undefined,
      company: d.company || undefined,
      location: d.location || undefined,
      mode: d.mode || undefined,
      pay: d.pay || undefined,
      posted: d.posted || undefined,
      track: d.track || undefined,
      fit: d.fit ?? undefined,
      why: d.why || undefined,
      leadWith: d.leadWith || undefined,
      applyHow: d.applyHow || undefined,
      shortlistId: d.externalId ?? undefined,
    },
    { ...deps, db },
  );
}
