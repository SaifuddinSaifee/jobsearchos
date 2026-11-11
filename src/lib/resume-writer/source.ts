import { and, desc, eq, isNull, ne } from "drizzle-orm";
import { applyProposal, resolveDecisions } from "@/lib/career/apply";
import { extractFromDoc } from "@/lib/career/extract";
import { buildProposal } from "@/lib/career/proposal";
import { emptyRecord, type CareerRecord } from "@/lib/career/schema";
import { currentRecord } from "@/lib/career/service";
import type { DocJSON } from "@/lib/documents/build";
import { newId } from "@/lib/documents/build";
import { docToProfile } from "@/lib/documents/convert/doc-to-profile";
import { hasStructure } from "@/lib/documents/read";
import { getBaseDocument, latestVersion, type DbOrTx } from "@/lib/documents/service";
import { db as defaultDb } from "@/lib/db";
import { documents } from "@/lib/db/schema";
import type { Profile } from "@/lib/profile/schema";
import { recordHasExperience } from "./context";
import type { GenerationSource } from "./types";

/** A fixed id for the in-memory source: nothing is saved, so it only has to be a valid one. */
const BASE_SOURCE_ID = "00000000-0000-4000-8000-00000000ba5e";

/**
 * The base resume as a career record, in memory only (nothing is saved). It is the same read the record uses when a
 * resume is added to it, so roles, facts and wordings come out word for word. Null when the resume has no
 * experience in it, for example an upload not yet read into sections.
 */
export function recordFromResume(content: DocJSON, label = "Base resume"): CareerRecord | null {
  if (!hasStructure(content)) return null;
  const extract = extractFromDoc(content);
  const current = { version: 0, record: emptyRecord() };
  const proposal = buildProposal(current, extract, { sourceId: BASE_SOURCE_ID, label, targetRole: null });
  const { record } = applyProposal(current.record, resolveDecisions(proposal, {}, current.record), { sourceId: BASE_SOURCE_ID, label, newId }, null);
  return recordHasExperience(record) ? record : null;
}

/** What a resume is written from, and which version of it. */
export type LoadedSource = {
  source: GenerationSource;
  record: CareerRecord;
  /** The career record version, when written from the record. */
  recordVersion: number | null;
  /** The base resume version, when written from the base resume. */
  baseVersionId: string | null;
};

/**
 * The career record when it has experience in it, else the base resume read as a record, else null (nothing to write
 * from). The record is always preferred: it holds every way each thing has been worded.
 */
export async function loadSource(db: DbOrTx = defaultDb()): Promise<LoadedSource | null> {
  const current = await currentRecord(db);
  if (recordHasExperience(current.record)) {
    return { source: "record", record: current.record, recordVersion: current.version, baseVersionId: null };
  }
  const base = await getBaseDocument(db);
  const version = base ? await latestVersion(base.id, db) : null;
  const record = version ? recordFromResume(version.content, base!.title) : null;
  return record && version ? { source: "base_resume", record, recordVersion: null, baseVersionId: version.id } : null;
}

type Contact = Profile["contact"];

/** How many of the latest resumes are read for a contact line when neither the Profile nor the base resume has one. */
const CONTACT_RESUMES = 5;

/** Each contact field from the first one that has it; the links from the first that has any. */
export function mergeContact(contacts: Contact[]): Contact {
  const first = (pick: (c: Contact) => string) => contacts.map((c) => pick(c).trim()).find(Boolean) ?? "";
  return {
    name: first((c) => c.name),
    email: first((c) => c.email),
    phone: first((c) => c.phone),
    location: first((c) => c.location),
    links: contacts.find((c) => c.links.some((l) => l.trim()))?.links.filter((l) => l.trim()) ?? [],
  };
}

const complete = (c: Contact) => !!(c.name.trim() && c.email.trim() && c.phone.trim() && c.location.trim() && c.links.length > 0);

/**
 * The name and contact line for a written resume. The Profile's own wins field by field; what it leaves empty comes
 * from the header of the base resume, then of the latest resumes the user wrote or uploaded (never a generated one).
 */
export async function loadContact(profile: Contact, db: DbOrTx = defaultDb()): Promise<Contact> {
  const found = [profile];
  if (complete(profile)) return profile;
  const base = await getBaseDocument(db);
  const others = await db
    .select({ id: documents.id })
    .from(documents)
    .where(and(eq(documents.kind, "resume"), isNull(documents.deletedAt), ne(documents.origin, "generated"), ...(base ? [ne(documents.id, base.id)] : [])))
    .orderBy(desc(documents.updatedAt))
    .limit(CONTACT_RESUMES);
  for (const id of [...(base ? [base.id] : []), ...others.map((o) => o.id)]) {
    const version = await latestVersion(id, db);
    if (!version) continue;
    found.push(docToProfile(version.content).contact);
    if (complete(mergeContact(found))) break;
  }
  return mergeContact(found);
}
