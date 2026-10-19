import { and, desc, eq, isNull } from "drizzle-orm";
import { db as defaultDb, type Db } from "@/lib/db";
import { jobs, jobSnapshots } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { putFile } from "@/lib/storage/local";
import { extractJob } from "./extract";
import { fetchJob } from "./fetch";
import { FetchError, type FetchedPosting } from "./fetch/types";
import { currentFields, writeJobFields } from "./service";
import type { JobExtraction } from "./schema";
import type { DeletedState } from "./types";

/**
 * Where a refetch reads the posting from. "auto" fetches the job's link again, except for a job that was pasted (its
 * site could not be read, so the saved text is all there is). "saved-text" reads the text saved last time again, for
 * when the posting is gone or the extraction changed.
 */
export type RefetchFrom = "auto" | "saved-text";

/** What Undo needs to put a refetched job back: its fields before, and the snapshot to make current again if one was added. */
export type RefetchUndo = { fields: JobExtraction; restoreSnapshotId: string | null };

export type RefetchOutcome =
  | { type: "updated"; source: "site" | "saved-text"; removedCompanies: DeletedState["companies"]; undo: RefetchUndo }
  | { type: "fetch-failed"; message: string; canUseSavedText: boolean };

export type RefetchDeps = {
  fetchJob: typeof fetchJob;
  extractJob: typeof extractJob;
  putFile: (bytes: Buffer, meta: { mime: string; originalName?: string }) => Promise<{ id: string }>;
};

/** Fetch methods that read a job board's API, where a posting that is not found has been taken down. */
const ATS_METHODS = new Set(["greenhouse", "lever", "ashby", "workday", "smartrecruiters", "workable"]);

const defaultDeps: RefetchDeps = { fetchJob, extractJob, putFile };

/**
 * Gets a saved job's posting again and replaces the job's details with a fresh extraction. A newly fetched posting is
 * kept as a new snapshot; status, notes, documents and the company profile are left as they are. A site that cannot be
 * fetched is an outcome, not an error, so the caller can offer the saved text instead.
 */
export async function refetchJob(
  jobId: string,
  from: RefetchFrom = "auto",
  db: Db = defaultDb(),
  deps: RefetchDeps = defaultDeps,
): Promise<RefetchOutcome> {
  const [job] = await db
    .select({ canonicalUrl: jobs.canonicalUrl, applicationUrl: jobs.applicationUrl, company: jobs.company, title: jobs.title })
    .from(jobs)
    .where(and(eq(jobs.id, jobId), isNull(jobs.deletedAt)));
  if (!job) throw new Error("Job not found");
  const [snap] = await db
    .select({ id: jobSnapshots.id, fetchMethod: jobSnapshots.fetchMethod, rawText: jobSnapshots.rawText })
    .from(jobSnapshots)
    .where(eq(jobSnapshots.jobId, jobId))
    .orderBy(desc(jobSnapshots.fetchedAt))
    .limit(1);
  const savedText = snap?.rawText.trim() ? snap.rawText : null;

  const fromSite = from === "auto" && job.canonicalUrl !== null && snap?.fetchMethod !== "paste";
  if (!fromSite && !savedText) {
    throw new Error(job.canonicalUrl ? "This job has no saved posting text to read again" : "This job has no link to fetch");
  }

  let fetched: { posting: FetchedPosting; rawFileId: string } | null = null;
  if (fromSite) {
    try {
      const posting = await deps.fetchJob(job.canonicalUrl!, { goneIsFinal: ATS_METHODS.has(snap?.fetchMethod ?? "") });
      const raw = await deps.putFile(Buffer.from(posting.raw.body), { mime: posting.raw.mime, originalName: posting.sourceUrl });
      fetched = { posting, rawFileId: raw.id };
    } catch (err) {
      if (!(err instanceof FetchError)) throw err;
      return { type: "fetch-failed", message: err.message, canUseSavedText: savedText !== null };
    }
  }

  const posting = fetched?.posting;
  const { extraction } = await deps.extractJob(posting?.text ?? savedText!, posting?.hints ?? {});
  const fields = {
    ...extraction,
    // A reply missing the name or title would otherwise blank them; the ones already saved are better than none.
    company: extraction.company.trim() || job.company,
    title: extraction.title.trim() || job.title,
    applicationUrl: extraction.applicationUrl || posting?.applicationUrl || job.applicationUrl || "",
  };
  const snapshot = fetched && {
    sourceUrl: job.canonicalUrl,
    fetchMethod: fetched.posting.method,
    rawFileId: fetched.rawFileId,
    rawText: fetched.posting.text,
    normalized: extraction,
    model: env().EXTRACTION_MODEL,
  };
  const before = await currentFields(jobId, db);
  const { removedCompanies } = await writeJobFields(jobId, fields, db, snapshot ?? undefined);
  return {
    type: "updated",
    source: fromSite ? "site" : "saved-text",
    removedCompanies,
    undo: { fields: before, restoreSnapshotId: snapshot && snap ? snap.id : null },
  };
}

/**
 * Puts a refetched job's fields back. Snapshots cannot be removed, so when the refetch added one, a copy of the one
 * before it is added again to make it the current one (what "read the saved text again" and the panel use).
 */
export async function undoRefetch(jobId: string, undo: RefetchUndo, db: Db = defaultDb()): Promise<{ removedCompanies: DeletedState["companies"] }> {
  let snapshot: Parameters<typeof writeJobFields>[3];
  if (undo.restoreSnapshotId) {
    const [old] = await db
      .select({
        sourceUrl: jobSnapshots.sourceUrl,
        fetchMethod: jobSnapshots.fetchMethod,
        rawFileId: jobSnapshots.rawFileId,
        rawText: jobSnapshots.rawText,
        normalized: jobSnapshots.normalized,
        model: jobSnapshots.model,
      })
      .from(jobSnapshots)
      .where(and(eq(jobSnapshots.id, undo.restoreSnapshotId), eq(jobSnapshots.jobId, jobId)));
    snapshot = old;
  }
  return writeJobFields(jobId, undo.fields, db, snapshot);
}
