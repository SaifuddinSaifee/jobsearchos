import { and, desc, eq, inArray, isNull, ne, or } from "drizzle-orm";
import { db as defaultDb, type Db } from "@/lib/db";
import {
  applications,
  companies,
  jobKeywords,
  jobs,
  jobSnapshots,
  statusEvents,
  type JobRow,
} from "@/lib/db/schema";
import { env } from "@/lib/env";
import { applyResearch, removeCompaniesWithoutJobs, resolveCompany } from "@/lib/companies/service";
import { dedupKey } from "./dedup";
import { canonicalizeUrl } from "./fetch/url";
import { safeHref } from "./links";
import { extractAdditionalDetails } from "./extract";
import { JobDraftSchema, JobEditSchema, type AdditionalDetail } from "./schema";
import type { DeletedState } from "./types";

export type SaveResult =
  | { ok: true; jobId: string; applicationId: string }
  | { ok: false; duplicate: Pick<JobRow, "id" | "company" | "title"> };

export type DuplicateLookup = { canonicalUrl?: string | null; dedupKey?: string; exceptId?: string };

/** A saved (not deleted) job with the same URL or company/title/location. */
export async function findDuplicate(
  { canonicalUrl, dedupKey: key, exceptId }: DuplicateLookup,
  db: Db | Tx = defaultDb(),
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
    .where(and(match, isNull(jobs.deletedAt), exceptId ? ne(jobs.id, exceptId) : undefined))
    .limit(1);
  return row ?? null;
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === "23505" || e?.cause?.code === "23505";
}

/** Trims headings and items, drops empty items and groups left with nothing in them. */
export function cleanDetails(list: AdditionalDetail[]): AdditionalDetail[] {
  return list
    .map((d) => ({ heading: d.heading.trim() || "Other details", items: d.items.map((i) => i.trim()).filter(Boolean) }))
    .filter((d) => d.items.length > 0);
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
          additionalDetails: cleanDetails(draft.additionalDetails),
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

/**
 * Saves the user's edits to a job. The immutable snapshot keeps what was originally fetched. Moving the
 * job to another company removes the old company if it has no jobs left.
 */
export async function updateJob(
  jobId: string,
  input: unknown,
  db: Db = defaultDb(),
): Promise<{ removedCompanies: DeletedState["companies"] }> {
  const edit = JobEditSchema.parse(input);
  const key = dedupKey(edit);
  try {
    return await db.transaction(async (tx) => {
      const [job] = await tx
        .select()
        .from(jobs)
        .where(and(eq(jobs.id, jobId), isNull(jobs.deletedAt)))
        .for("update");
      if (!job) throw new Error("Job not found");

      const dup = await findDuplicate({ dedupKey: key, exceptId: jobId }, tx);
      if (dup) throw new Error(`"${dup.title}" at ${dup.company} is already saved with this title and location`);

      const company = await resolveCompany({ name: edit.company, aboutFromPosting: edit.aboutCompany }, tx);
      const applicationUrl = safeHref(edit.applicationUrl) ?? job.canonicalUrl;

      await tx
        .update(jobs)
        .set({
          company: edit.company,
          companyId: company.id,
          aboutCompany: edit.aboutCompany.trim(),
          title: edit.title,
          location: edit.location.trim(),
          remoteType: edit.remoteType,
          employmentType: edit.employmentType.trim() || null,
          salaryMin: edit.salaryMin === null ? null : Math.round(edit.salaryMin),
          salaryMax: edit.salaryMax === null ? null : Math.round(edit.salaryMax),
          salaryCurrency: edit.salaryCurrency.trim() || null,
          salaryPeriod: edit.salaryPeriod.trim() || null,
          postedAt: /^\d{4}-\d{2}-\d{2}$/.test(edit.postedAt) ? edit.postedAt : null,
          applicationUrl,
          responsibilities: edit.responsibilities,
          requirements: edit.requirements,
          additionalDetails: cleanDetails(edit.additionalDetails),
          technologies: edit.technologies,
          dedupKey: key,
          updatedAt: new Date(),
        })
        .where(eq(jobs.id, jobId));
      await tx.update(applications).set({ applicationUrl, updatedAt: new Date() }).where(eq(applications.jobId, jobId));

      // The form shows every keyword, so the edited list replaces all of them.
      await tx.delete(jobKeywords).where(eq(jobKeywords.jobId, jobId));
      const keywords = cleanKeywords(edit.keywords);
      if (keywords.length) {
        await tx
          .insert(jobKeywords)
          .values(keywords.map((keyword) => ({ jobId, keyword, kind: "extracted" as const })))
          .onConflictDoNothing();
      }

      const removedCompanies =
        job.companyId && job.companyId !== company.id ? await removeCompaniesWithoutJobs([job.companyId], tx) : [];
      return { removedCompanies };
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new Error("Another saved job already has this company, title and location");
    throw err;
  }
}

/**
 * Soft-deletes jobs. A company left without any jobs is deleted with them. Returns what was deleted so
 * Undo can bring it back.
 */
export async function deleteJobs(jobIds: string[], db: Db = defaultDb()): Promise<DeletedState> {
  const ids = [...new Set(jobIds)];
  if (!ids.length) return { jobIds: [], companies: [] };
  return db.transaction(async (tx) => {
    const deleted = await tx
      .update(jobs)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(inArray(jobs.id, ids), isNull(jobs.deletedAt)))
      .returning({ id: jobs.id, companyId: jobs.companyId });
    if (deleted.length !== ids.length) throw new Error("Job not found");
    const removed = await removeCompaniesWithoutJobs(
      deleted.map((d) => d.companyId).filter((id): id is string => id !== null),
      tx,
    );
    return { jobIds: deleted.map((d) => d.id), companies: removed };
  });
}

/**
 * Undo for a delete. Brings back the jobs and the companies deleted with them. When a company or job
 * with the same name or URL was added in the meantime, that one wins: restored jobs join the new
 * company, and a job that was saved again stays deleted.
 */
export async function restoreDeleted(
  state: DeletedState,
  db: Db = defaultDb(),
): Promise<{ restored: number; skipped: number }> {
  return db.transaction(async (tx) => {
    // Old company id to the live company that now stands for it.
    const revived = new Map<string, string>();
    async function revive(id: string): Promise<string> {
      const known = revived.get(id);
      if (known) return known;
      const [c] = await tx.select().from(companies).where(eq(companies.id, id)).for("update");
      let live = id;
      if (c?.deletedAt) {
        const [taken] = await tx
          .select({ id: companies.id })
          .from(companies)
          .where(and(eq(companies.normalizedName, c.normalizedName), isNull(companies.deletedAt)));
        if (taken) live = taken.id;
        else await tx.update(companies).set({ deletedAt: null, updatedAt: new Date() }).where(eq(companies.id, id));
      }
      revived.set(id, live);
      return live;
    }

    let restored = 0;
    let skipped = 0;
    const owners = new Set<string | null>();
    for (const id of state.jobIds) {
      const [job] = await tx.select().from(jobs).where(eq(jobs.id, id)).for("update");
      if (!job || !job.deletedAt) continue;
      owners.add(job.companyId);
      if (await findDuplicate({ canonicalUrl: job.canonicalUrl, dedupKey: job.dedupKey }, tx)) {
        skipped++;
        continue;
      }
      const companyId = job.companyId ? await revive(job.companyId) : null;
      await tx.update(jobs).set({ deletedAt: null, companyId, updatedAt: new Date() }).where(eq(jobs.id, id));
      restored++;
    }
    // A company deleted without jobs of its own comes back too; one whose jobs were all saved again stays deleted.
    for (const { id } of state.companies) {
      if (!owners.has(id)) await revive(id);
    }
    return { restored, skipped };
  });
}

/**
 * Fills a saved job's additional details from the posting text kept when it was saved. Overwrites what
 * is there, so the panel only offers it while the section is empty.
 */
export async function fillAdditionalDetails(
  jobId: string,
  db: Db = defaultDb(),
  extract: (text: string) => Promise<AdditionalDetail[]> = extractAdditionalDetails,
): Promise<AdditionalDetail[]> {
  const [snap] = await db
    .select({ rawText: jobSnapshots.rawText })
    .from(jobSnapshots)
    .innerJoin(jobs, eq(jobs.id, jobSnapshots.jobId))
    .where(and(eq(jobSnapshots.jobId, jobId), isNull(jobs.deletedAt)))
    .orderBy(desc(jobSnapshots.fetchedAt))
    .limit(1);
  if (!snap) throw new Error("No saved posting text for this job");
  const details = cleanDetails(await extract(snap.rawText));
  await db.update(jobs).set({ additionalDetails: details, updatedAt: new Date() }).where(eq(jobs.id, jobId));
  return details;
}
