import { eq, or } from "drizzle-orm";
import { db as defaultDb, type Db } from "@/lib/db";
import {
  applications,
  jobKeywords,
  jobs,
  jobSnapshots,
  statusEvents,
  type JobRow,
} from "@/lib/db/schema";
import { env } from "@/lib/env";
import { applyResearch, resolveCompany } from "@/lib/companies/service";
import { dedupKey } from "./dedup";
import { canonicalizeUrl } from "./fetch/url";
import { safeHref } from "./links";
import { JobDraftSchema } from "./schema";

export type SaveResult =
  | { ok: true; jobId: string; applicationId: string }
  | { ok: false; duplicate: Pick<JobRow, "id" | "company" | "title"> };

export type DuplicateLookup = { canonicalUrl?: string | null; dedupKey?: string };

export async function findDuplicate(
  { canonicalUrl, dedupKey: key }: DuplicateLookup,
  db: Db = defaultDb(),
) {
  const conditions = [
    canonicalUrl ? eq(jobs.canonicalUrl, canonicalUrl) : undefined,
    key ? eq(jobs.dedupKey, key) : undefined,
  ].filter((c) => c !== undefined);
  if (!conditions.length) return null;
  const match = or(...conditions);
  const [row] = await db
    .select({ id: jobs.id, company: jobs.company, title: jobs.title })
    .from(jobs)
    .where(match)
    .limit(1);
  return row ?? null;
}

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === "23505" || e?.cause?.code === "23505";
}

function cleanKeywords(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of list) {
    const t = k.trim();
    if (t && !seen.has(t.toLowerCase())) {
      seen.add(t.toLowerCase());
      out.push(t);
    }
  }
  return out.slice(0, 40);
}

/**
 * Saves a reviewed draft: job + immutable snapshot + keywords + application + first status event,
 * in one transaction. A duplicate (same canonical URL or company/title/location) returns the existing job.
 */
export async function saveJob(input: unknown, db: Db = defaultDb()): Promise<SaveResult> {
  const draft = JobDraftSchema.parse(input);
  const canonicalUrl = draft.sourceUrl ? canonicalizeUrl(draft.sourceUrl) : null;
  const key = dedupKey(draft);

  const existing = await findDuplicate({ canonicalUrl, dedupKey: key }, db);
  if (existing) return { ok: false, duplicate: existing };

  try {
    return await db.transaction(async (tx) => {
      // Every job belongs to a directory entry; the posting's own "about us" text seeds an empty entry.
      const company = await resolveCompany({ name: draft.company, aboutFromPosting: draft.aboutCompany }, tx);
      if (draft.companyResearch) await applyResearch(company.id, draft.companyResearch, tx);

      const [job] = await tx
        .insert(jobs)
        .values({
          canonicalUrl,
          // applicationUrl is model output: keep it only if it is a real http(s) link.
          applicationUrl: safeHref(draft.applicationUrl) ?? canonicalUrl,
          ats: draft.ats,
          atsJobId: draft.atsJobId,
          company: draft.company.trim(),
          companyId: company.id,
          aboutCompany: draft.aboutCompany.trim(),
          title: draft.title.trim(),
          location: draft.location.trim(),
          remoteType: draft.remoteType,
          employmentType: draft.employmentType || null,
          salaryMin: draft.salaryMin === null ? null : Math.round(draft.salaryMin),
          salaryMax: draft.salaryMax === null ? null : Math.round(draft.salaryMax),
          salaryCurrency: draft.salaryCurrency || null,
          salaryPeriod: draft.salaryPeriod || null,
          postedAt: /^\d{4}-\d{2}-\d{2}$/.test(draft.postedAt) ? draft.postedAt : null,
          responsibilities: draft.responsibilities,
          requirements: draft.requirements,
          technologies: draft.technologies,
          origin: "manual",
          status: "saved",
          dedupKey: key,
        })
        .returning({ id: jobs.id });

      await tx.insert(jobSnapshots).values({
        jobId: job.id,
        sourceUrl: canonicalUrl,
        fetchMethod: draft.fetchMethod,
        rawFileId: draft.rawFileId,
        rawText: draft.rawText,
        normalized: draft.normalized,
        model: env().EXTRACTION_MODEL,
      });

      const keywords = cleanKeywords(draft.keywords);
      if (keywords.length) {
        await tx
          .insert(jobKeywords)
          .values(keywords.map((keyword) => ({ jobId: job.id, keyword, kind: "extracted" as const })))
          .onConflictDoNothing();
      }

      const [app] = await tx
        .insert(applications)
        .values({ jobId: job.id, status: "saved", applicationUrl: safeHref(draft.applicationUrl) ?? canonicalUrl })
        .returning({ id: applications.id });
      await tx.insert(statusEvents).values({ applicationId: app.id, fromStatus: null, toStatus: "saved" });

      return { ok: true as const, jobId: job.id, applicationId: app.id };
    });
  } catch (err) {
    // Lost a race with another save of the same job.
    if (isUniqueViolation(err)) {
      const dup = await findDuplicate({ canonicalUrl, dedupKey: key }, db);
      if (dup) return { ok: false, duplicate: dup };
    }
    throw err;
  }
}
