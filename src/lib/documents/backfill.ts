import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { findCompanyByName } from "@/lib/companies/service";
import { db as defaultDb, type Db } from "@/lib/db";
import { documents, files, outreachEmails, pastResumes, profileVersions, resumeIndexes } from "@/lib/db/schema";
import type { Profile } from "@/lib/profile/schema";
import type { DocJSON } from "./build";
import { keepCustomSections } from "./convert/keep-custom";
import { profileToDoc } from "./convert/profile-to-doc";
import { textToDoc } from "./convert/text-to-doc";
import { createDocument, type DbOrTx } from "./service";
import { createSentEmailDocument } from "./sent-email";

// Moves what the app stored before the library existed into the library: past resumes, the base resume and sent
// emails. It is safe to run any number of times: each source row is tied to its document, and it only fills gaps.

/** Any number; held for the length of the run so two servers sharing a database do not both import. */
const LOCK_KEY = 4_815_162_342;

const hasContent = (p: Profile) => p.summary.trim() !== "" || p.experience.length > 0 || p.projects.length > 0 || p.education.length > 0 || p.skills.length > 0;
const dateOnly = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/** One bad row must not stop the rest, and must not make every server start fail the same way: log it and go on. */
async function attempt<T>(what: string, run: () => Promise<T>): Promise<T | null> {
  try {
    return await run();
  } catch (err) {
    console.error(`[library] could not import ${what}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

async function importPastResumes(tx: DbOrTx): Promise<number> {
  const rows = await tx
    .select({ past: pastResumes, file: files })
    .from(pastResumes)
    .innerJoin(files, eq(files.id, pastResumes.fileId))
    .leftJoin(documents, eq(documents.legacyPastResumeId, pastResumes.id))
    .where(isNull(documents.id))
    .orderBy(pastResumes.createdAt);

  let imported = 0;
  for (const { past, file } of rows) {
    // The old index kept the model's reading of the resume; use it, and keep the text of anything it had no place for.
    const [index] = await tx
      .select({ parsed: resumeIndexes.parsed })
      .from(resumeIndexes)
      .where(and(eq(resumeIndexes.fileId, past.fileId), eq(resumeIndexes.status, "ready")));
    const fromText = textToDoc(past.extractedText);
    const content: DocJSON = index?.parsed && hasContent(index.parsed) ? keepCustomSections(profileToDoc(index.parsed), fromText) : fromText;

    const company = past.company ? await findCompanyByName(past.company, tx) : null;
    const made = await attempt(`past resume ${past.id}`, () => createDocument(
      {
        kind: "resume",
        origin: "uploaded",
        title: past.title,
        content,
        jobId: past.jobId,
        companyId: company?.id ?? null,
        companyName: past.company,
        targetRole: past.role,
        writtenOn: dateOnly(past.appliedAt),
        jdText: past.jdText,
        jdUrl: past.jdUrl,
        sourceName: file.originalName,
        sourceMime: file.mime,
        sourceSha256: file.sha256,
        sourceFileId: file.id,
        legacyPastResumeId: past.id,
        reason: "migrated",
        createdAt: past.createdAt,
      },
      tx,
    ));
    if (made) imported++;
  }
  return imported;
}

async function importBaseResume(tx: DbOrTx): Promise<boolean> {
  const [existing] = await tx.select({ id: documents.id }).from(documents).where(and(eq(documents.isBase, true), isNull(documents.deletedAt)));
  if (existing) return false;

  const [latest] = await tx.select().from(profileVersions).orderBy(desc(profileVersions.version)).limit(1);
  if (!latest || !hasContent(latest.profile)) return false;

  const [file] = latest.baseResumeFileId ? await tx.select().from(files).where(eq(files.id, latest.baseResumeFileId)) : [];
  await createDocument(
    {
      kind: "resume",
      origin: file ? "uploaded" : "blank",
      title: "Base resume",
      content: profileToDoc(latest.profile),
      isBase: true,
      sourceName: file?.originalName ?? null,
      sourceMime: file?.mime ?? null,
      sourceSha256: file?.sha256 ?? null,
      sourceFileId: file?.id ?? null,
      reason: "migrated",
    },
    tx,
  );
  return true;
}

async function importSentEmails(tx: DbOrTx): Promise<number> {
  const rows = await tx
    .select({ email: outreachEmails })
    .from(outreachEmails)
    .leftJoin(documents, eq(documents.outreachEmailId, outreachEmails.id))
    .where(and(eq(outreachEmails.status, "sent"), isNull(documents.id)))
    .orderBy(outreachEmails.sentAt);
  let imported = 0;
  for (const { email } of rows) if (await attempt(`sent email ${email.id}`, () => createSentEmailDocument(email, tx))) imported++;
  return imported;
}

export type BackfillResult = { pastResumes: number; baseResume: boolean; sentEmails: number; skipped: boolean };

/** Imports whatever is missing. Returns what it did; `skipped` is true when another run holds the lock. */
export async function backfillDocuments(db: Db = defaultDb()): Promise<BackfillResult> {
  return db.transaction(async (tx) => {
    const [{ got }] = await tx.execute<{ got: boolean }>(sql`SELECT pg_try_advisory_xact_lock(${LOCK_KEY}) AS got`);
    if (!got) return { pastResumes: 0, baseResume: false, sentEmails: 0, skipped: true };
    // Past resumes first, so the base resume is only built from the profile when no import already set one.
    const pastResumesImported = await importPastResumes(tx);
    const baseResume = await importBaseResume(tx);
    const sentEmails = await importSentEmails(tx);
    return { pastResumes: pastResumesImported, baseResume, sentEmails, skipped: false };
  });
}
