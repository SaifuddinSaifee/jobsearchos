import { sql } from "drizzle-orm";
import { db as defaultDb, type Db } from "@/lib/db";
import { documents, files, outreachAttachments, pastResumes, profileVersions } from "@/lib/db/schema";

/** Resume file kinds the app accepts (the same two the upload checks allow). */
export const RESUME_MIMES = ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"];

/** A name for a stored file, for showing and for the attachment: the uploaded name, or one made from its type. */
export function fileDisplayName(f: { originalName: string | null; mime: string }): string {
  if (f.originalName?.trim()) return f.originalName.trim();
  return f.mime === "application/pdf" ? "resume.pdf" : "resume.docx";
}

/**
 * Whether a stored file is a resume the app knows about: a base resume (any version of the profile), a library
 * resume that kept its file, a past or uploaded resume, or something attached to an email (including a file uploaded only
 * for that email). The download route and the attach step use this so they never hand out or send an arbitrary stored file.
 */
export async function isKnownResumeFile(fileId: string, db: Db = defaultDb()): Promise<boolean> {
  const [row] = await db
    .select({ id: files.id })
    .from(files)
    .where(
      sql`${files.id} = ${fileId} and (
        exists (select 1 from ${profileVersions} where ${profileVersions.baseResumeFileId} = ${files.id})
        or exists (select 1 from ${pastResumes} where ${pastResumes.fileId} = ${files.id})
        or exists (select 1 from ${documents} where ${documents.sourceFileId} = ${files.id} and ${documents.deletedAt} is null)
        or exists (select 1 from ${outreachAttachments} where ${outreachAttachments.fileId} = ${files.id})
      )`,
    );
  return Boolean(row);
}

