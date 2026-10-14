import { and, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { db as defaultDb, type Db } from "@/lib/db";
import {
  companies,
  documentDrafts,
  documents,
  documentVersions,
  jobs,
  type DocumentDraftRow,
  type DocumentRow,
  type DocumentVersionRow,
} from "@/lib/db/schema";
import type { DocJSON } from "./build";
import { docToMarkdown } from "./convert/doc-to-markdown";
import { docToText } from "./convert/doc-to-text";
import { normalizeDoc } from "./convert/normalize";
import { hashContent, stableStringify } from "./hash";
import { parsePageSettings, type PageSettings } from "./page-settings";
import { assertValidDoc, validateDoc } from "./schema";
import { CONTENT_SCHEMA_VERSION, type DocumentKind, type DocumentOrigin, type VersionReason } from "./types";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;

export type DocumentErrorCode = "not_found" | "stale" | "invalid" | "blocked";

/** Something the caller can show to the user as is. `stale` carries the draft's current revision. */
export class DocumentError extends Error {
  constructor(
    readonly code: DocumentErrorCode,
    message: string,
    readonly detail?: { revision?: number },
  ) {
    super(message);
    this.name = "DocumentError";
  }
}

const now = () => new Date();

function derive(content: DocJSON) {
  return { markdown: docToMarkdown(content), plainText: docToText(content) };
}

const settingsChanged = (a: unknown, b: unknown) => stableStringify(parsePageSettings(a)) !== stableStringify(parsePageSettings(b));

const DEFAULT_REASON: Record<DocumentOrigin, VersionReason> = {
  uploaded: "upload",
  pasted: "upload",
  blank: "manual",
  copied: "manual",
  sent: "sent",
  generated: "manual",
};

async function insertVersion(
  tx: Tx,
  doc: Pick<DocumentRow, "id" | "pageSettings">,
  v: {
    content: DocJSON;
    subject: string;
    reason: VersionReason;
    note?: string | null;
    restoredFromVersionId?: string | null;
    lockedAt?: Date | null;
    lockedJobId?: string | null;
    createdAt?: Date;
  },
): Promise<DocumentVersionRow> {
  const [{ latest }] = await tx
    .select({ latest: sql<number>`coalesce(max(${documentVersions.version}), 0)::int` })
    .from(documentVersions)
    .where(eq(documentVersions.documentId, doc.id));
  const [row] = await tx
    .insert(documentVersions)
    .values({
      documentId: doc.id,
      version: latest + 1,
      content: v.content,
      contentSchema: CONTENT_SCHEMA_VERSION,
      subject: v.subject,
      ...derive(v.content),
      contentSha256: hashContent(v.content, v.subject),
      pageSettings: doc.pageSettings,
      reason: v.reason,
      note: v.note ?? null,
      restoredFromVersionId: v.restoredFromVersionId ?? null,
      lockedAt: v.lockedAt ?? null,
      lockedJobId: v.lockedJobId ?? null,
      ...(v.createdAt ? { createdAt: v.createdAt } : {}),
    })
    .returning();
  return row;
}

async function lockDocument(tx: Tx, id: string): Promise<DocumentRow> {
  const [doc] = await tx.select().from(documents).where(eq(documents.id, id)).for("update");
  if (!doc || doc.deletedAt) throw new DocumentError("not_found", "Document not found");
  return doc;
}

export type NewDocument = {
  kind: DocumentKind;
  origin: DocumentOrigin;
  title: string;
  content: DocJSON;
  subject?: string;
  jobId?: string | null;
  companyId?: string | null;
  companyName?: string | null;
  targetRole?: string | null;
  writtenOn?: string | null;
  jdText?: string | null;
  jdUrl?: string | null;
  isBase?: boolean;
  sourceName?: string | null;
  sourceMime?: string | null;
  sourceSha256?: string | null;
  sourceFileId?: string | null;
  pageSettings?: Partial<PageSettings>;
  legacyPastResumeId?: string | null;
  outreachEmailId?: string | null;
  /** Why the first version exists. Defaults from the origin. */
  reason?: VersionReason;
  /** Backdates the document and its first version (used when importing). */
  createdAt?: Date;
  /** Locks the first version straight away (a sent email). */
  lockedAt?: Date | null;
};

/**
 * Makes a document with its first version and its working draft. The content is repaired where it can be (missing
 * fields and ids) and must then be valid.
 */
export async function createDocument(
  input: NewDocument,
  db: DbOrTx = defaultDb(),
): Promise<{ document: DocumentRow; version: DocumentVersionRow }> {
  const content = assertValidDoc(normalizeDoc(input.content));
  const subject = input.subject ?? "";
  return db.transaction(async (tx) => {
    let companyId = input.companyId ?? null;
    let companyName = input.companyName ?? null;
    if (input.jobId && !companyId) {
      const [job] = await tx.select({ companyId: jobs.companyId, company: jobs.company }).from(jobs).where(eq(jobs.id, input.jobId));
      if (job) {
        companyId = job.companyId;
        companyName ??= job.company;
      }
    }
    if (input.isBase) {
      if (input.kind !== "resume") throw new DocumentError("blocked", "Only a resume can be the base resume");
      await tx.update(documents).set({ isBase: false, updatedAt: now() }).where(and(eq(documents.isBase, true), isNull(documents.deletedAt)));
    }

    const [document] = await tx
      .insert(documents)
      .values({
        kind: input.kind,
        origin: input.origin,
        title: input.title.trim() || "Untitled",
        jobId: input.jobId ?? null,
        companyId,
        companyName,
        targetRole: input.targetRole ?? null,
        writtenOn: input.writtenOn ?? null,
        jdText: input.jdText ?? null,
        jdUrl: input.jdUrl ?? null,
        isBase: input.isBase ?? false,
        sourceName: input.sourceName ?? null,
        sourceMime: input.sourceMime ?? null,
        sourceSha256: input.sourceSha256 ?? null,
        sourceFileId: input.sourceFileId ?? null,
        pageSettings: input.pageSettings ?? {},
        legacyPastResumeId: input.legacyPastResumeId ?? null,
        outreachEmailId: input.outreachEmailId ?? null,
        ...(input.createdAt ? { createdAt: input.createdAt, updatedAt: input.createdAt } : {}),
      })
      .returning();

    const version = await insertVersion(tx, document, {
      content,
      subject,
      reason: input.reason ?? DEFAULT_REASON[input.origin],
      lockedAt: input.lockedAt ?? null,
      createdAt: input.createdAt,
    });
    await tx.insert(documentDrafts).values({
      documentId: document.id,
      content,
      subject,
      revision: 1,
      baseVersionId: version.id,
      contentSha256: version.contentSha256,
    });
    return { document, version };
  });
}

export async function getDocument(id: string, db: DbOrTx = defaultDb()): Promise<DocumentRow | null> {
  const [row] = await db.select().from(documents).where(and(eq(documents.id, id), isNull(documents.deletedAt)));
  return row ?? null;
}

export async function getDraft(documentId: string, db: DbOrTx = defaultDb()): Promise<DocumentDraftRow | null> {
  const [row] = await db.select().from(documentDrafts).where(eq(documentDrafts.documentId, documentId));
  return row ?? null;
}

export async function getVersion(versionId: string, db: DbOrTx = defaultDb()): Promise<DocumentVersionRow | null> {
  const [row] = await db.select().from(documentVersions).where(eq(documentVersions.id, versionId));
  return row ?? null;
}

export async function latestVersion(documentId: string, db: DbOrTx = defaultDb()): Promise<DocumentVersionRow | null> {
  const [row] = await db
    .select()
    .from(documentVersions)
    .where(eq(documentVersions.documentId, documentId))
    .orderBy(desc(documentVersions.version))
    .limit(1);
  return row ?? null;
}

/**
 * Saves what the editor has now. `revision` is the one the editor last saw; if another tab saved since, nothing is
 * written and a `stale` error says what the current revision is.
 */
export async function saveDraft(
  documentId: string,
  input: { content: unknown; subject?: string; revision: number },
  db: DbOrTx = defaultDb(),
): Promise<{ revision: number; contentSha256: string }> {
  const check = validateDoc(input.content);
  if (!check.ok) throw new DocumentError("invalid", check.error);
  const subject = input.subject ?? "";
  const sha = hashContent(check.doc, subject);

  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(documentDrafts)
      .set({ content: check.doc, subject, contentSha256: sha, revision: sql`${documentDrafts.revision} + 1`, updatedAt: now() })
      .where(and(eq(documentDrafts.documentId, documentId), eq(documentDrafts.revision, input.revision)))
      .returning({ revision: documentDrafts.revision });
    if (!row) {
      const current = await getDraft(documentId, tx);
      if (!current) throw new DocumentError("not_found", "Document not found");
      throw new DocumentError("stale", "This document was changed somewhere else. Reload to see the latest.", { revision: current.revision });
    }
    await tx.update(documents).set({ updatedAt: now() }).where(eq(documents.id, documentId));
    return { revision: row.revision, contentSha256: sha };
  });
}

/**
 * Makes a version from the current draft. If nothing changed since the latest version (content, subject and page
 * settings), no new version is made and the latest one is returned with `created: false`.
 */
export async function createVersion(
  documentId: string,
  opts: { reason: VersionReason; note?: string | null },
  db: DbOrTx = defaultDb(),
): Promise<{ version: DocumentVersionRow; created: boolean }> {
  return db.transaction(async (tx) => {
    const doc = await lockDocument(tx, documentId);
    const draft = await getDraft(documentId, tx);
    if (!draft) throw new DocumentError("not_found", "Document not found");
    const latest = await latestVersion(documentId, tx);
    if (latest && latest.contentSha256 === draft.contentSha256 && !settingsChanged(latest.pageSettings, doc.pageSettings)) {
      return { version: latest, created: false };
    }
    const version = await insertVersion(tx, doc, { content: draft.content, subject: draft.subject, reason: opts.reason, note: opts.note });
    await tx.update(documentDrafts).set({ baseVersionId: version.id }).where(eq(documentDrafts.documentId, documentId));
    return { version, created: true };
  });
}

/** Puts an old version's content back as the draft and records that as a new version. History is never rewritten. */
export async function restoreVersion(documentId: string, versionId: string, db: DbOrTx = defaultDb()): Promise<DocumentVersionRow> {
  return db.transaction(async (tx) => {
    const doc = await lockDocument(tx, documentId);
    const old = await getVersion(versionId, tx);
    if (!old || old.documentId !== documentId) throw new DocumentError("not_found", "Version not found");
    const version = await insertVersion(tx, { id: doc.id, pageSettings: old.pageSettings }, {
      content: old.content,
      subject: old.subject,
      reason: "restore",
      note: `Restored from version ${old.version}`,
      restoredFromVersionId: old.id,
    });
    await tx.update(documents).set({ pageSettings: old.pageSettings, updatedAt: now() }).where(eq(documents.id, doc.id));
    await tx
      .update(documentDrafts)
      .set({
        content: old.content,
        subject: old.subject,
        contentSha256: old.contentSha256,
        revision: sql`${documentDrafts.revision} + 1`,
        baseVersionId: version.id,
        updatedAt: now(),
      })
      .where(eq(documentDrafts.documentId, doc.id));
    return version;
  });
}

/**
 * Replaces an unedited uploaded document with a structured version of it (made by the model from the same text).
 * Does nothing, and returns null, if the document has been edited, restored or versioned since `fromVersionId`: the
 * user's work always wins over the automatic step.
 */
export async function addStructuredVersion(documentId: string, fromVersionId: string, content: DocJSON, db: DbOrTx = defaultDb()): Promise<DocumentVersionRow | null> {
  const doc = await getDocument(documentId, db);
  if (!doc) return null;
  const valid = assertValidDoc(normalizeDoc(content));
  return db.transaction(async (tx) => {
    const locked = await lockDocument(tx, documentId);
    const draft = await getDraft(documentId, tx);
    const latest = await latestVersion(documentId, tx);
    if (!draft || !latest || latest.id !== fromVersionId) return null;
    if (draft.baseVersionId !== fromVersionId || draft.contentSha256 !== latest.contentSha256) return null;
    const version = await insertVersion(tx, locked, { content: valid, subject: draft.subject, reason: "structured" });
    await tx
      .update(documentDrafts)
      .set({ content: valid, contentSha256: version.contentSha256, revision: sql`${documentDrafts.revision} + 1`, baseVersionId: version.id, updatedAt: now() })
      .where(eq(documentDrafts.documentId, documentId));
    return version;
  });
}

/** Locks one version for good (it went out in an email, or with an application). A lock is never undone. */
export async function lockVersion(versionId: string, opts: { jobId?: string | null; at?: Date } = {}, db: DbOrTx = defaultDb()): Promise<void> {
  await db
    .update(documentVersions)
    .set({ lockedAt: opts.at ?? now(), lockedJobId: opts.jobId ?? null })
    .where(and(eq(documentVersions.id, versionId), isNull(documentVersions.lockedAt)));
}

/**
 * Called when a job is marked Applied. For each resume and cover letter linked to the job: saves unsaved edits as a
 * version (reason `applied`), then locks the latest version. Returns the versions it made, so the caller can index them.
 */
export async function lockForJob(tx: Tx, jobId: string): Promise<{ createdVersionIds: string[]; createdDocumentIds: string[]; lockedVersionIds: string[] }> {
  const docs = await tx
    .select()
    .from(documents)
    .where(and(eq(documents.jobId, jobId), isNull(documents.deletedAt), inArray(documents.kind, ["resume", "cover_letter"])))
    .for("update");
  const createdVersionIds: string[] = [];
  const createdDocumentIds: string[] = [];
  const lockedVersionIds: string[] = [];
  for (const doc of docs) {
    const draft = await getDraft(doc.id, tx);
    let latest = await latestVersion(doc.id, tx);
    if (draft && (!latest || latest.contentSha256 !== draft.contentSha256 || settingsChanged(latest.pageSettings, doc.pageSettings))) {
      latest = await insertVersion(tx, doc, { content: draft.content, subject: draft.subject, reason: "applied" });
      await tx.update(documentDrafts).set({ baseVersionId: latest.id }).where(eq(documentDrafts.documentId, doc.id));
      createdVersionIds.push(latest.id);
      createdDocumentIds.push(doc.id);
    }
    if (latest && !latest.lockedAt) {
      await lockVersion(latest.id, { jobId }, tx);
      lockedVersionIds.push(latest.id);
    }
  }
  return { createdVersionIds, createdDocumentIds, lockedVersionIds };
}

/** The one resume marked as the base, if any. */
export async function getBaseDocument(db: DbOrTx = defaultDb()): Promise<DocumentRow | null> {
  const [row] = await db.select().from(documents).where(and(eq(documents.isBase, true), isNull(documents.deletedAt)));
  return row ?? null;
}

export async function setBase(documentId: string, db: DbOrTx = defaultDb()): Promise<void> {
  await db.transaction(async (tx) => {
    const doc = await lockDocument(tx, documentId);
    if (doc.kind !== "resume") throw new DocumentError("blocked", "Only a resume can be the base resume");
    await tx.update(documents).set({ isBase: false, updatedAt: now() }).where(and(eq(documents.isBase, true), ne(documents.id, documentId), isNull(documents.deletedAt)));
    await tx.update(documents).set({ isBase: true, updatedAt: now() }).where(eq(documents.id, documentId));
  });
}

/** Soft delete. The base resume and anything that went out with an email or application cannot be deleted. */
export async function softDelete(documentId: string, db: DbOrTx = defaultDb()): Promise<void> {
  await db.transaction(async (tx) => {
    const doc = await lockDocument(tx, documentId);
    if (doc.isBase) throw new DocumentError("blocked", "This is your base resume. Make another resume the base first.");
    const [locked] = await tx
      .select({ id: documentVersions.id })
      .from(documentVersions)
      .where(and(eq(documentVersions.documentId, documentId), sql`${documentVersions.lockedAt} is not null`))
      .limit(1);
    if (locked) throw new DocumentError("blocked", "This document was sent or used in an application, so it is kept.");
    await tx.update(documents).set({ deletedAt: now(), updatedAt: now() }).where(eq(documents.id, documentId));
  });
}

export type DocumentMeta = {
  title?: string;
  jobId?: string | null;
  companyId?: string | null;
  companyName?: string | null;
  targetRole?: string | null;
  writtenOn?: string | null;
  jdText?: string | null;
  jdUrl?: string | null;
};

/** Details of a document. Linking it to a job also links that job's company, unless a company is given too. */
export async function updateMeta(documentId: string, meta: DocumentMeta, db: DbOrTx = defaultDb()): Promise<DocumentRow> {
  const patch: Partial<typeof documents.$inferInsert> = { updatedAt: now() };
  if (meta.title !== undefined) patch.title = meta.title.trim() || "Untitled";
  for (const key of ["jobId", "companyId", "companyName", "targetRole", "writtenOn", "jdText", "jdUrl"] as const) {
    if (meta[key] !== undefined) (patch as Record<string, unknown>)[key] = meta[key];
  }
  if (meta.jobId && meta.companyId === undefined) {
    const [job] = await db.select({ companyId: jobs.companyId, company: jobs.company }).from(jobs).where(eq(jobs.id, meta.jobId));
    if (!job) throw new DocumentError("invalid", "That job no longer exists");
    patch.companyId = job.companyId;
    if (meta.companyName === undefined) patch.companyName = job.company;
  }
  const [row] = await db.update(documents).set(patch).where(and(eq(documents.id, documentId), isNull(documents.deletedAt))).returning();
  if (!row) throw new DocumentError("not_found", "Document not found");
  return row;
}

export async function updatePageSettings(documentId: string, settings: unknown, db: DbOrTx = defaultDb()): Promise<PageSettings> {
  const parsed = parsePageSettings(settings);
  const [row] = await db.update(documents).set({ pageSettings: parsed, updatedAt: now() }).where(and(eq(documents.id, documentId), isNull(documents.deletedAt))).returning({ id: documents.id });
  if (!row) throw new DocumentError("not_found", "Document not found");
  return parsed;
}

/** A copy of the current draft as a new, unlinked document. */
export async function duplicateDocument(documentId: string, opts: { title?: string } = {}, db: DbOrTx = defaultDb()) {
  const doc = await getDocument(documentId, db);
  const draft = doc ? await getDraft(documentId, db) : null;
  if (!doc || !draft) throw new DocumentError("not_found", "Document not found");
  return createDocument(
    {
      kind: doc.kind,
      origin: "copied",
      title: opts.title ?? `${doc.title} (copy)`,
      content: draft.content,
      subject: draft.subject,
      targetRole: doc.targetRole,
      pageSettings: parsePageSettings(doc.pageSettings),
    },
    db,
  );
}

export type DocumentListItem = {
  id: string;
  kind: DocumentKind;
  origin: DocumentOrigin;
  title: string;
  isBase: boolean;
  jobId: string | null;
  jobTitle: string | null;
  companyName: string | null;
  targetRole: string | null;
  writtenOn: string | null;
  versionCount: number;
  latestVersionId: string | null;
  locked: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export async function listDocuments(opts: { kind?: DocumentKind } = {}, db: DbOrTx = defaultDb()): Promise<DocumentListItem[]> {
  const rows = await db
    .select({
      id: documents.id,
      kind: documents.kind,
      origin: documents.origin,
      title: documents.title,
      isBase: documents.isBase,
      jobId: documents.jobId,
      jobTitle: jobs.title,
      companyName: sql<string | null>`coalesce(${companies.name}, ${documents.companyName}, ${jobs.company})`,
      targetRole: documents.targetRole,
      writtenOn: documents.writtenOn,
      versionCount: sql<number>`(select count(*)::int from ${documentVersions} v where v.document_id = ${documents.id})`,
      latestVersionId: sql<string | null>`(select v.id from ${documentVersions} v where v.document_id = ${documents.id} order by v.version desc limit 1)`,
      locked: sql<boolean>`exists (select 1 from ${documentVersions} v where v.document_id = ${documents.id} and v.locked_at is not null)`,
      createdAt: documents.createdAt,
      updatedAt: documents.updatedAt,
    })
    .from(documents)
    .leftJoin(jobs, eq(jobs.id, documents.jobId))
    .leftJoin(companies, eq(companies.id, documents.companyId))
    .where(and(isNull(documents.deletedAt), opts.kind ? eq(documents.kind, opts.kind) : undefined))
    .orderBy(desc(documents.isBase), desc(documents.updatedAt));
  return rows;
}

export type VersionSummary = Pick<DocumentVersionRow, "id" | "version" | "reason" | "note" | "createdAt" | "lockedAt" | "lockedJobId" | "restoredFromVersionId">;

export async function listVersions(documentId: string, db: DbOrTx = defaultDb()): Promise<VersionSummary[]> {
  return db
    .select({
      id: documentVersions.id,
      version: documentVersions.version,
      reason: documentVersions.reason,
      note: documentVersions.note,
      createdAt: documentVersions.createdAt,
      lockedAt: documentVersions.lockedAt,
      lockedJobId: documentVersions.lockedJobId,
      restoredFromVersionId: documentVersions.restoredFromVersionId,
    })
    .from(documentVersions)
    .where(eq(documentVersions.documentId, documentId))
    .orderBy(desc(documentVersions.version));
}

/** Everything the document page needs in one go. */
export async function getEditorData(documentId: string, db: DbOrTx = defaultDb()) {
  const doc = await getDocument(documentId, db);
  if (!doc) return null;
  const [draft, versions, job] = await Promise.all([
    getDraft(documentId, db),
    listVersions(documentId, db),
    doc.jobId
      ? db.select({ id: jobs.id, title: jobs.title, company: jobs.company }).from(jobs).where(eq(jobs.id, doc.jobId)).then((r) => r[0] ?? null)
      : Promise.resolve(null),
  ]);
  if (!draft) return null;
  return { document: doc, draft, versions, job, pageSettings: parsePageSettings(doc.pageSettings) };
}

export type JobOption = { id: string; label: string };

/** The most recent jobs, for choosing which job a document was written for. */
export async function listJobOptions(limit = 300, db: DbOrTx = defaultDb()): Promise<JobOption[]> {
  const rows = await db
    .select({ id: jobs.id, title: jobs.title, company: jobs.company })
    .from(jobs)
    .where(isNull(jobs.deletedAt))
    .orderBy(desc(jobs.createdAt))
    .limit(limit);
  return rows.map((r) => ({ id: r.id, label: `${r.title} at ${r.company}` }));
}
