import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { findCompanyByName } from "@/lib/companies/service";
import { db as defaultDb } from "@/lib/db";
import {
  careerProposals,
  careerSources,
  documents,
  documentVersions,
  resumeIndexes,
  type CareerProposalRow,
  type DocumentRow,
  type DocumentVersionRow,
} from "@/lib/db/schema";
import { hasStructure } from "@/lib/documents/read";
import type { DbOrTx } from "@/lib/documents/service";
import type { RecordChoice } from "@/lib/documents/types";
import { extractCoverLetter, extractFromDoc, type SourceExtract } from "./extract";
import { normalizeEmployer } from "./normalize";
import { emptySummary, hasSomethingNew, summarizeProposal, type OfferSummary } from "./offer-summary";
import { buildProposal } from "./proposal";
import { MIN_TEXT_TO_STRUCTURE } from "./queue";
import type { CareerRecord } from "./schema";
import { currentRecord } from "./service";

// Whether a resume or cover letter is in the career record, and if not, what adding it would bring. Nothing here
// calls a model: the summary uses exact and near matches only, so it is free to compute on every page load. Adding is
// always the user's choice (see `addDocumentsToRecord`).

/** Where a document stands with the career record (for its latest version). */
export type OfferState =
  /** A resume upload still being read into sections. */
  | { state: "reading" }
  /** There is nothing to read in it yet. */
  | { state: "empty" }
  /** Not in the record, and adding it would bring something. */
  | { state: "new"; summary: OfferSummary }
  /** Everything in it is already in the record. */
  | { state: "nothing-new" }
  /** Queued or being prepared; `autoApply` when it will be added without a review. */
  | { state: "adding"; proposalId: string; autoApply: boolean }
  | { state: "review"; proposalId: string }
  /** Set aside before it was reviewed ("Review later" or "Stop and skip"). */
  | { state: "set-aside"; proposalId: string; summary: OfferSummary }
  | { state: "failed"; proposalId: string; error: string | null }
  /** The user left it out when reviewing it. It is not offered again, but can still be added by hand. */
  | { state: "left-out" }
  | { state: "in-record" };

export type DocumentOffer = OfferState & {
  documentId: string;
  versionId: string | null;
  kind: "resume" | "cover_letter";
  title: string;
  isBase: boolean;
  writtenOn: string | null;
  targetRole: string | null;
  companyName: string | null;
  /** "later" only counts for the version it was given for; it is null here once a newer version exists. */
  choice: RecordChoice | null;
};

/** A source id that never exists: the summary is computed before any source is registered. */
const NO_SOURCE = "00000000-0000-0000-0000-000000000000";

/** The free summary of one version against the record. Null when there is nothing to read. */
async function summarize(
  doc: DocumentRow,
  version: DocumentVersionRow,
  record: { version: number; record: CareerRecord },
  companyIdFor: (name: string) => Promise<string | null>,
): Promise<OfferSummary | null> {
  let extract: SourceExtract;
  if (doc.kind === "cover_letter") {
    extract = extractCoverLetter(version.content);
    if (extract.paragraphs.length === 0) return null;
  } else if (hasStructure(version.content)) {
    extract = extractFromDoc(version.content);
    const read = extract.roles.length + extract.projects.length + extract.skills.length + extract.education.length + extract.certifications.length + extract.achievements.length;
    if (read === 0) return null;
  } else {
    if (version.plainText.trim().length < MIN_TEXT_TO_STRUCTURE) return null;
    return { ...emptySummary(), needsReading: true };
  }

  const companyIds = new Map<string, string>();
  for (const name of new Set(extract.roles.map((r) => r.company.trim()).filter(Boolean))) {
    const id = await companyIdFor(name);
    if (id) companyIds.set(normalizeEmployer(name), id);
  }
  const proposal = buildProposal(record, extract, { sourceId: NO_SOURCE, label: doc.title, targetRole: doc.targetRole }, new Date(), companyIds);
  return summarizeProposal(proposal, record.record);
}

/**
 * The record offer of each document (resumes and cover letters only; anything else is left out). Works in a few
 * queries for the whole list, so the Library can show every document at once.
 */
export async function getDocumentOffers(docs: DocumentRow[], db: DbOrTx = defaultDb()): Promise<DocumentOffer[]> {
  const eligible = docs.filter((d): d is DocumentRow & { kind: "resume" | "cover_letter" } => !d.deletedAt && (d.kind === "resume" || d.kind === "cover_letter"));
  if (eligible.length === 0) return [];
  const ids = eligible.map((d) => d.id);

  const versions = await db
    .selectDistinctOn([documentVersions.documentId])
    .from(documentVersions)
    .where(inArray(documentVersions.documentId, ids))
    .orderBy(documentVersions.documentId, desc(documentVersions.version));
  const latestOf = new Map(versions.map((v) => [v.documentId, v]));
  const versionIds = versions.map((v) => v.id);

  // The newest proposal for the source of each latest version.
  const proposals = versionIds.length
    ? await db
        .selectDistinctOn([careerSources.documentVersionId], { versionId: careerSources.documentVersionId, proposal: careerProposals })
        .from(careerSources)
        .innerJoin(careerProposals, eq(careerProposals.sourceId, careerSources.id))
        .where(inArray(careerSources.documentVersionId, versionIds))
        .orderBy(careerSources.documentVersionId, desc(careerProposals.createdAt))
    : [];
  const proposalOf = new Map<string, CareerProposalRow>(proposals.map((p) => [p.versionId as string, p.proposal]));

  // The same content applied from anywhere (another version, a copy of the document) is in the record too.
  const shas = [...new Set(versions.map((v) => v.contentSha256))];
  const applied = shas.length
    ? await db
        .selectDistinct({ kind: careerSources.kind, sha: careerSources.contentSha256 })
        .from(careerSources)
        .innerJoin(careerProposals, eq(careerProposals.sourceId, careerSources.id))
        .where(and(inArray(careerSources.contentSha256, shas), eq(careerProposals.status, "applied")))
    : [];
  const appliedKeys = new Set(applied.map((a) => `${a.kind}:${a.sha}`));

  const reading = versionIds.length
    ? await db
        .select({ versionId: resumeIndexes.documentVersionId })
        .from(resumeIndexes)
        .where(and(inArray(resumeIndexes.documentVersionId, versionIds), inArray(resumeIndexes.status, ["queued", "running"])))
    : [];
  const readingIds = new Set(reading.map((r) => r.versionId));

  const record = await currentRecord(db);
  const companies = new Map<string, Promise<string | null>>();
  const companyIdFor = (name: string) => {
    const key = normalizeEmployer(name);
    if (!companies.has(key)) companies.set(key, findCompanyByName(name, db).then((c) => c?.id ?? null));
    return companies.get(key)!;
  };

  const out: DocumentOffer[] = [];
  for (const doc of eligible) {
    const version = latestOf.get(doc.id) ?? null;
    const choice = doc.recordChoice === "later" && doc.recordChoiceVersionId !== version?.id ? null : doc.recordChoice;
    const base = {
      documentId: doc.id,
      versionId: version?.id ?? null,
      kind: doc.kind,
      title: doc.title,
      isBase: doc.isBase,
      writtenOn: doc.writtenOn,
      targetRole: doc.targetRole,
      companyName: doc.companyName,
      choice,
    };
    out.push({ ...base, ...(await stateOf(doc, version)) });
  }
  return out;

  async function stateOf(doc: DocumentRow, version: DocumentVersionRow | null): Promise<OfferState> {
    if (!version) return { state: "empty" };
    const p = proposalOf.get(version.id);
    if (p?.status === "queued" || p?.status === "running") return { state: "adding", proposalId: p.id, autoApply: p.autoApply };
    // A one-click add is ready only for the moment before it is applied.
    if (p?.status === "ready") return p.autoApply ? { state: "adding", proposalId: p.id, autoApply: true } : { state: "review", proposalId: p.id };
    if (p?.status === "failed") return { state: "failed", proposalId: p.id, error: p.error };
    if (p?.status === "applied" || appliedKeys.has(`${doc.kind}:${version.contentSha256}`)) return { state: "in-record" };

    if (doc.kind === "resume" && !hasStructure(version.content) && readingIds.has(version.id)) return { state: "reading" };
    const summary = await summarize(doc, version, record, companyIdFor);
    if (!summary) return { state: "empty" };
    if (p?.status === "skipped") return { state: "set-aside", proposalId: p.id, summary };
    if (p?.status === "dismissed" && hasSomethingNew(summary)) return { state: "left-out" };
    return hasSomethingNew(summary) ? { state: "new", summary } : { state: "nothing-new" };
  }
}

/** The record offer of one document, or null when it is not a resume or cover letter (or does not exist). */
export async function getDocumentOffer(documentId: string, db: DbOrTx = defaultDb()): Promise<DocumentOffer | null> {
  const [doc] = await db.select().from(documents).where(and(eq(documents.id, documentId), isNull(documents.deletedAt)));
  if (!doc) return null;
  const [offer] = await getDocumentOffers([doc], db);
  return offer ?? null;
}

/** Every resume and cover letter in the library with its record offer: the base first, then newest first. */
export async function listDocumentOffers(db: DbOrTx = defaultDb()): Promise<DocumentOffer[]> {
  const docs = await db
    .select()
    .from(documents)
    .where(and(isNull(documents.deletedAt), inArray(documents.kind, ["resume", "cover_letter"])))
    .orderBy(desc(documents.isBase), sql`${documents.kind} = 'cover_letter'`, sql`${documents.writtenOn} desc nulls last`, desc(documents.createdAt));
  return getDocumentOffers(docs, db);
}

export class OfferError extends Error {}

/**
 * Remembers the user's answer about a document: "later" (Not now) holds for its latest version only, so a new
 * version asks again; "never" holds for every version; null asks again now.
 */
export async function setRecordChoice(documentId: string, choice: RecordChoice | null, db: DbOrTx = defaultDb()): Promise<void> {
  const [latest] = await db
    .select({ id: documentVersions.id })
    .from(documentVersions)
    .where(eq(documentVersions.documentId, documentId))
    .orderBy(desc(documentVersions.version))
    .limit(1);
  const rows = await db
    .update(documents)
    .set({ recordChoice: choice, recordChoiceVersionId: choice === "later" ? (latest?.id ?? null) : null })
    .where(and(eq(documents.id, documentId), isNull(documents.deletedAt), inArray(documents.kind, ["resume", "cover_letter"])))
    .returning({ id: documents.id });
  if (rows.length === 0) throw new OfferError("That document is not a resume or cover letter in your library.");
}
