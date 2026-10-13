import { createHash } from "node:crypto";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { findCompanyByName } from "@/lib/companies/service";
import { db as defaultDb } from "@/lib/db";
import {
  careerProposals,
  careerSources,
  companies,
  documents,
  documentVersions,
  profileVersions,
  resumeIndexes,
  type CareerProposalRow,
  type CareerSourceRow,
} from "@/lib/db/schema";
import { docToText } from "@/lib/documents/convert/doc-to-text";
import { profileToDoc } from "@/lib/documents/convert/profile-to-doc";
import { hasStructure } from "@/lib/documents/read";
import type { DbOrTx } from "@/lib/documents/service";
import { parseResume } from "@/lib/resume/parse";
import type { Profile } from "@/lib/profile/schema";
import { emptyExtract, extractCoverLetter, extractFromDoc, extractFromProfile, type SourceExtract } from "./extract";
import { normalizeEmployer } from "./normalize";
import { modelClassifier, type Classifier } from "./cover";
import { modelGrouper, type Grouper } from "./group";
import { buildProposal } from "./proposal";
import { classifyProposalParagraphs, groupProposal } from "./regroup";
import { isNothingNew } from "./nothing-new";
import { currentRecord, getLatestRecord } from "./service";

// The work queue for merging sources into the career record. One proposal is prepared at a time, against the newest
// record, and stays "ready" until the user reviews it, so the next one never sees an unreviewed merge.

/** A proposal that has not reported for this long is considered abandoned (its worker died). */
export const PROPOSAL_STALE_SECONDS = 120;
export const PROPOSAL_MAX_ATTEMPTS = 3;
/** Shortest text worth sending to the model to be structured. */
const MIN_TEXT_TO_STRUCTURE = 80;

/** Lower runs first. Cover letters go last so their stories have roles to attach to. */
export const PRIORITY = { base: 0, resume: 1, profile: 2, linkedin: 3, coverLetter: 4 } as const;

export type EnqueueOutcome =
  | { status: "queued" | "open"; proposalId: string; sourceId: string }
  | { status: "skipped"; reason: string; sourceId: string };

type NewSource = typeof careerSources.$inferInsert;

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

export const profileIsEmpty = (p: Profile) =>
  p.experience.length === 0 &&
  p.projects.length === 0 &&
  p.skills.length === 0 &&
  p.technologies.length === 0 &&
  p.education.length === 0 &&
  p.certifications.length === 0 &&
  p.achievements.length === 0;

/**
 * Registers a source (once per document version, profile version or content) and queues a proposal for it. A source
 * whose content is already in the record, or that the user chose to leave out, is skipped; a proposal that is
 * already open is left alone; one that failed is queued again; one that was undone or superseded starts a new one.
 */
export async function enqueueSource(source: NewSource, priority: number, db: DbOrTx, existingSourceId?: string): Promise<EnqueueOutcome> {
  const [done] = await db
    .select({ id: careerSources.id, status: careerProposals.status })
    .from(careerSources)
    .innerJoin(careerProposals, eq(careerProposals.sourceId, careerSources.id))
    .where(
      and(
        eq(careerSources.kind, source.kind!),
        eq(careerSources.contentSha256, source.contentSha256),
        inArray(careerProposals.status, ["applied", "dismissed"]),
      ),
    )
    .limit(1);
  if (done) {
    return {
      status: "skipped",
      sourceId: done.id,
      reason: done.status === "applied" ? "Already in your record." : "You left this out of your record.",
    };
  }

  if (!existingSourceId) await db.insert(careerSources).values(source).onConflictDoNothing();
  const [row] = await db
    .select()
    .from(careerSources)
    .where(
      existingSourceId
        ? eq(careerSources.id, existingSourceId)
        : source.documentVersionId
          ? eq(careerSources.documentVersionId, source.documentVersionId)
          : source.profileVersionId
            ? eq(careerSources.profileVersionId, source.profileVersionId)
            : and(eq(careerSources.kind, source.kind!), eq(careerSources.contentSha256, source.contentSha256)),
    )
    .orderBy(desc(careerSources.createdAt))
    .limit(1);

  const [latest] = await db
    .select()
    .from(careerProposals)
    .where(eq(careerProposals.sourceId, row.id))
    .orderBy(desc(careerProposals.createdAt))
    .limit(1);
  if (latest && ["queued", "running", "ready"].includes(latest.status)) {
    return { status: "open", proposalId: latest.id, sourceId: row.id };
  }
  if (latest?.status === "failed") {
    await db
      .update(careerProposals)
      .set({ status: "queued", error: null, note: null, attempts: 0, startedAt: null, finishedAt: null, updatedAt: new Date() })
      .where(eq(careerProposals.id, latest.id));
    return { status: "queued", proposalId: latest.id, sourceId: row.id };
  }
  const [created] = await db.insert(careerProposals).values({ sourceId: row.id, priority }).returning();
  return { status: "queued", proposalId: created.id, sourceId: row.id };
}

/** Queues the latest version of a resume or cover letter. Anything else (emails, deleted documents) is ignored. */
export async function enqueueDocumentSource(documentId: string, db: DbOrTx = defaultDb()): Promise<EnqueueOutcome | null> {
  const [doc] = await db.select().from(documents).where(and(eq(documents.id, documentId), isNull(documents.deletedAt)));
  if (!doc || (doc.kind !== "resume" && doc.kind !== "cover_letter")) return null;
  const [version] = await db
    .select()
    .from(documentVersions)
    .where(eq(documentVersions.documentId, documentId))
    .orderBy(desc(documentVersions.version))
    .limit(1);
  if (!version) return null;
  const priority = doc.kind === "cover_letter" ? PRIORITY.coverLetter : doc.isBase ? PRIORITY.base : PRIORITY.resume;
  // A newer version replaces what is still pending for older ones of this document.
  await db.execute(sql`
    UPDATE career_proposals
       SET status = 'superseded', finished_at = now(), updated_at = now()
     WHERE status IN ('queued', 'running', 'ready')
       AND source_id IN (SELECT id FROM career_sources WHERE document_id = ${documentId} AND document_version_id IS DISTINCT FROM ${version.id})`);
  return enqueueSource(
    {
      kind: doc.kind,
      documentId: doc.id,
      documentVersionId: version.id,
      contentSha256: version.contentSha256,
      label: doc.title,
      targetRole: doc.targetRole,
      companyId: doc.companyId,
      companyName: doc.companyName,
      writtenOn: doc.writtenOn,
    },
    priority,
    db,
  );
}

/**
 * Offers a document that was just created or saved to the career record, once a record exists (until then, building
 * the record covers every document). A resume that is still being structured is offered when that is done, a
 * document with nothing to read is left alone, and an older pending version is replaced by this one. The review
 * decides what, if anything, joins the record.
 */
export async function offerDocumentToRecord(documentId: string, db: DbOrTx = defaultDb()): Promise<EnqueueOutcome | null> {
  if (!(await getLatestRecord(db))) return null;
  const [doc] = await db.select().from(documents).where(and(eq(documents.id, documentId), isNull(documents.deletedAt)));
  if (!doc || (doc.kind !== "resume" && doc.kind !== "cover_letter")) return null;
  const [version] = await db
    .select()
    .from(documentVersions)
    .where(eq(documentVersions.documentId, documentId))
    .orderBy(desc(documentVersions.version))
    .limit(1);
  if (!version) return null;

  if (doc.kind === "cover_letter") {
    if (extractCoverLetter(version.content).paragraphs.length === 0) return null;
  } else {
    const [index] = await db.select({ status: resumeIndexes.status }).from(resumeIndexes).where(eq(resumeIndexes.documentVersionId, version.id));
    if (index && (index.status === "queued" || index.status === "running")) return null;
    if (hasStructure(version.content)) {
      const x = extractFromDoc(version.content);
      if (x.roles.length + x.projects.length + x.skills.length + x.education.length + x.certifications.length + x.achievements.length === 0) return null;
    } else if (version.plainText.trim().length < MIN_TEXT_TO_STRUCTURE) return null;
  }
  return enqueueDocumentSource(documentId, db);
}

/** Queues the latest saved Profile, unless it is still empty. */
export async function enqueueProfileSource(db: DbOrTx = defaultDb()): Promise<EnqueueOutcome | null> {
  const [latest] = await db.select().from(profileVersions).orderBy(desc(profileVersions.version)).limit(1);
  if (!latest || profileIsEmpty(latest.profile)) return null;
  return enqueueSource(
    {
      kind: "profile",
      profileVersionId: latest.id,
      contentSha256: sha256(JSON.stringify(latest.profile)),
      label: "Profile",
    },
    PRIORITY.profile,
    db,
  );
}

/**
 * Puts a freshly saved Profile forward as a source, but only once a career record exists: until then, building the
 * record covers the Profile. The review decides what, if anything, joins the record.
 */
export async function offerProfileToRecord(db: DbOrTx = defaultDb()): Promise<EnqueueOutcome | null> {
  if (!(await getLatestRecord(db))) return null;
  return enqueueProfileSource(db);
}

/**
 * Queues every library resume (base first, then newest first) and the Profile. Safe to run again: what is already
 * in the record or open for review is left alone.
 */
export async function startBuild(db: DbOrTx = defaultDb()): Promise<{ queued: number; skipped: number }> {
  const rows = await db
    .select({ id: documents.id })
    .from(documents)
    .where(and(isNull(documents.deletedAt), inArray(documents.kind, ["resume", "cover_letter"])))
    .orderBy(desc(documents.isBase), desc(documents.writtenOn), desc(documents.createdAt));
  const outcomes: (EnqueueOutcome | null)[] = [];
  for (const r of rows) outcomes.push(await enqueueDocumentSource(r.id, db));
  outcomes.push(await enqueueProfileSource(db));
  const real = outcomes.filter((o): o is EnqueueOutcome => o !== null);
  return { queued: real.filter((o) => o.status === "queued").length, skipped: real.filter((o) => o.status === "skipped").length };
}

/**
 * Atomically takes the next queued proposal, but only when none is running or waiting for review, so each proposal
 * is prepared against the newest record. Returns its id, or null.
 */
export async function claimNextProposal(db: DbOrTx = defaultDb()): Promise<string | null> {
  try {
    const rows = await db.execute<{ id: string }>(sql`
      UPDATE career_proposals
         SET status = 'running', started_at = now(), updated_at = now(), attempts = attempts + 1, error = NULL
       WHERE id = (
         SELECT id FROM career_proposals
          WHERE status = 'queued'
            AND NOT EXISTS (SELECT 1 FROM career_proposals WHERE status IN ('running', 'ready'))
          ORDER BY priority, created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED
       )
   RETURNING id`);
    return rows[0]?.id ?? null;
  } catch (err) {
    // Two servers claiming at once: the one-open index lets only one win.
    if (String((err as { cause?: unknown }).cause ?? err).includes("career_proposals_one_open_idx")) return null;
    throw err;
  }
}

/** Puts abandoned running proposals back in the queue (or fails them after too many tries). */
export async function sweepStaleProposals(db: DbOrTx = defaultDb()): Promise<number> {
  const rows = await db.execute<{ id: string }>(sql`
    UPDATE career_proposals
       SET status = CASE WHEN attempts >= ${PROPOSAL_MAX_ATTEMPTS} THEN 'failed' ELSE 'queued' END,
           error = CASE WHEN attempts >= ${PROPOSAL_MAX_ATTEMPTS} THEN 'The server stopped while this was running, too many times in a row.' ELSE NULL END,
           finished_at = CASE WHEN attempts >= ${PROPOSAL_MAX_ATTEMPTS} THEN now() ELSE NULL END,
           updated_at = now()
     WHERE status = 'running' AND updated_at < now() - make_interval(secs => ${PROPOSAL_STALE_SECONDS})
 RETURNING id`);
  return rows.length;
}

/** Heartbeat: tells the sweeper this proposal is still being prepared. */
export async function touchProposal(id: string, db: DbOrTx = defaultDb()) {
  await db.update(careerProposals).set({ updatedAt: new Date() }).where(and(eq(careerProposals.id, id), eq(careerProposals.status, "running")));
}

export async function getProposalRow(id: string, db: DbOrTx = defaultDb()): Promise<CareerProposalRow | null> {
  const [r] = await db.select().from(careerProposals).where(eq(careerProposals.id, id));
  return r ?? null;
}

export async function getSourceRow(id: string, db: DbOrTx = defaultDb()): Promise<CareerSourceRow | null> {
  const [r] = await db.select().from(careerSources).where(eq(careerSources.id, id));
  return r ?? null;
}

export type ProcessDeps = {
  db?: DbOrTx;
  /** Reads resume text into a structured profile with the model. Injected so tests never reach the network. */
  parse?: (text: string) => Promise<Profile>;
  /** Decides which new bullets repeat an existing fact. Injected for the same reason. */
  grouper?: Grouper;
  /** Labels the paragraphs of a cover letter. Injected for the same reason. */
  classifier?: Classifier;
  now?: Date;
};

/** The text of a source, to show beside the review. No model call. */
export async function getSourceText(source: CareerSourceRow, db: DbOrTx = defaultDb()): Promise<string> {
  if (source.kind === "linkedin") return source.text ?? "";
  if (source.kind === "profile") {
    const [v] = await db.select().from(profileVersions).where(eq(profileVersions.id, source.profileVersionId as string));
    return v ? docToText(profileToDoc(v.profile)) : "";
  }
  const [v] = await db.select().from(documentVersions).where(eq(documentVersions.id, source.documentVersionId as string));
  return v?.plainText ?? "";
}

/** What a source holds, as pieces for merging, and the text to show beside the review. */
export async function readSource(
  source: CareerSourceRow,
  db: DbOrTx,
  parse: (text: string) => Promise<Profile>,
): Promise<{ extract: SourceExtract; text: string; note: string | null }> {
  if (source.kind === "profile") {
    const [v] = await db.select().from(profileVersions).where(eq(profileVersions.id, source.profileVersionId as string));
    if (!v) throw new Error("That profile version no longer exists.");
    return { extract: extractFromProfile(v.profile), text: docToText(profileToDoc(v.profile)), note: null };
  }
  if (source.kind === "linkedin") {
    const text = source.text ?? "";
    return { extract: extractFromProfile(await parse(text)), text, note: null };
  }
  const [v] = await db.select().from(documentVersions).where(eq(documentVersions.id, source.documentVersionId as string));
  if (!v) throw new Error("That version no longer exists.");
  if (source.kind === "cover_letter") return { extract: extractCoverLetter(v.content), text: v.plainText, note: null };
  if (hasStructure(v.content)) return { extract: extractFromDoc(v.content), text: v.plainText, note: null };
  // A resume that is only headings and paragraphs: read it with the model, so ids are lost but nothing else is.
  if (source.kind === "resume" && v.plainText.trim().length >= MIN_TEXT_TO_STRUCTURE) {
    return { extract: extractFromProfile(await parse(v.plainText)), text: v.plainText, note: "Read with AI, because this resume has no structure yet." };
  }
  return { extract: emptyExtract(), text: v.plainText, note: "There was nothing to read from this document." };
}

/** Prepares one claimed proposal: reads its source and compares it with the newest record. Failures are recorded on its row. */
export async function processProposal(id: string, deps: ProcessDeps = {}): Promise<void> {
  const db = deps.db ?? defaultDb();
  const row = await getProposalRow(id, db);
  if (!row || row.status !== "running") return;
  try {
    const source = await getSourceRow(row.sourceId, db);
    if (!source) throw new Error("The source of this proposal no longer exists.");
    const { extract, note } = await readSource(source, db, deps.parse ?? parseResume);
    const current = await currentRecord(db);

    const companyIds = new Map<string, string>();
    for (const name of new Set(extract.roles.map((r) => r.company.trim()).filter(Boolean))) {
      const company = await findCompanyByName(name, db);
      if (company) companyIds.set(normalizeEmployer(name), company.id);
    }
    // The company a letter was written for: the directory's name when the document is linked, else what was typed.
    let companyName = source.companyName ?? "";
    if (source.companyId) {
      const [c] = await db.select({ name: companies.name }).from(companies).where(eq(companies.id, source.companyId));
      companyName = c?.name ?? companyName;
    }
    const built = buildProposal(
      current,
      extract,
      {
        sourceId: source.id,
        label: source.label,
        targetRole: source.targetRole,
        company: companyName ? { id: source.companyId, name: companyName } : null,
      },
      deps.now ?? new Date(),
      companyIds,
    );
    // Only bullets that matched nothing exactly are put to the model, and only for roles joining one already recorded.
    const grouper = deps.grouper ?? modelGrouper;
    const grouped = await groupProposal(built, current.record, grouper);
    const proposal = await classifyProposalParagraphs(grouped, current.record, deps.classifier ?? modelClassifier, grouper);
    // Saving would only record where things were read, so there is nothing to review.
    if (isNothingNew(proposal, current.record)) {
      await db
        .update(careerProposals)
        .set({ status: "dismissed", proposal, baseVersion: current.version, note: "Nothing new in this source, so it was left out without asking.", error: null, finishedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(careerProposals.id, id), eq(careerProposals.status, "running")));
      return;
    }
    await db
      .update(careerProposals)
      .set({ status: "ready", proposal, baseVersion: current.version, note, error: null, finishedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(careerProposals.id, id), eq(careerProposals.status, "running")));
  } catch (err) {
    await db
      .update(careerProposals)
      .set({
        status: "failed",
        error: (err instanceof Error ? err.message : "Could not prepare this source").slice(0, 500),
        finishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(careerProposals.id, id), eq(careerProposals.status, "running")));
  }
}
