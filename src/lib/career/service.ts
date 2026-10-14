import { desc, eq, gt, inArray, sql } from "drizzle-orm";
import { db as defaultDb } from "@/lib/db";
import type { DbOrTx } from "@/lib/documents/service";
import {
  careerProposals,
  careerRecordVersions,
  careerSources,
  documents,
  type CareerRecordVersionRow,
} from "@/lib/db/schema";
import { newId } from "@/lib/documents/build";
import { applyEdit } from "./edit";
import type { EditOp } from "./edit-schema";
import {
  CareerRecordSchema,
  emptyRecord,
  RECORD_SCHEMA_VERSION,
  type CareerRecord,
  type RecordVersionReason,
  type SourceKind,
} from "./schema";

/** Raised when a save was based on a version that is no longer the latest. The caller should reload and retry. */
export class RecordConflict extends Error {
  constructor(
    public readonly expected: number,
    public readonly actual: number,
  ) {
    super(`The career record changed (expected version ${expected}, found ${actual}). Reload and try again.`);
    this.name = "RecordConflict";
  }
}

export type SaveRecordInput = {
  record: unknown;
  reason: RecordVersionReason;
  note?: string | null;
  proposalId?: string | null;
  restoredFromVersionId?: string | null;
  /** The version number the caller based the change on (0 when there is none yet). Omit to skip the check. */
  expectedVersion?: number;
};

export async function getLatestRecord(db: DbOrTx = defaultDb()): Promise<CareerRecordVersionRow | null> {
  const [row] = await db
    .select()
    .from(careerRecordVersions)
    .orderBy(desc(careerRecordVersions.version))
    .limit(1);
  return row ?? null;
}

/** The latest record, or an empty one when nothing has been merged yet. */
export async function currentRecord(db: DbOrTx = defaultDb()): Promise<{ version: number; record: CareerRecord }> {
  const latest = await getLatestRecord(db);
  return latest ? { version: latest.version, record: latest.record } : { version: 0, record: emptyRecord() };
}

export async function listRecordVersions(db: DbOrTx = defaultDb()) {
  return db
    .select({
      id: careerRecordVersions.id,
      version: careerRecordVersions.version,
      reason: careerRecordVersions.reason,
      changeNote: careerRecordVersions.changeNote,
      createdAt: careerRecordVersions.createdAt,
    })
    .from(careerRecordVersions)
    .orderBy(desc(careerRecordVersions.version));
}

export async function getRecordVersion(id: string, db: DbOrTx = defaultDb()) {
  const [row] = await db.select().from(careerRecordVersions).where(eq(careerRecordVersions.id, id));
  return row ?? null;
}

/**
 * Saves a new immutable version. Serialized by an advisory lock, so two saves can never fork the numbering, and
 * rejected with `RecordConflict` when `expectedVersion` is not the latest.
 */
export async function saveRecordVersion(
  input: SaveRecordInput,
  db: DbOrTx = defaultDb(),
): Promise<CareerRecordVersionRow> {
  const record = CareerRecordSchema.parse(input.record);
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('career_record'))`);
    const [latest] = await tx
      .select({ version: careerRecordVersions.version })
      .from(careerRecordVersions)
      .orderBy(desc(careerRecordVersions.version))
      .limit(1);
    const current = latest?.version ?? 0;
    if (input.expectedVersion !== undefined && input.expectedVersion !== current) {
      throw new RecordConflict(input.expectedVersion, current);
    }
    const [row] = await tx
      .insert(careerRecordVersions)
      .values({
        version: current + 1,
        record,
        recordSchema: RECORD_SCHEMA_VERSION,
        reason: input.reason,
        changeNote: input.note ?? null,
        proposalId: input.proposalId ?? null,
        restoredFromVersionId: input.restoredFromVersionId ?? null,
      })
      .returning();
    return row;
  });
}

/**
 * Restoring never rewrites history: it saves the old record as a new version. Proposals that were applied after
 * the restored version are marked `undone`, so the review list can offer to review them again.
 */
export async function restoreRecordVersion(id: string, db: DbOrTx = defaultDb()): Promise<CareerRecordVersionRow> {
  const old = await getRecordVersion(id, db);
  if (!old) throw new Error("Version not found");
  const restored = await saveRecordVersion(
    {
      record: old.record,
      reason: "restore",
      note: `Restored from version ${old.version}`,
      restoredFromVersionId: old.id,
    },
    db,
  );
  const later = await db
    .select({ id: careerRecordVersions.id })
    .from(careerRecordVersions)
    .where(gt(careerRecordVersions.version, old.version));
  const laterIds = later.map((r) => r.id).filter((x) => x !== restored.id);
  if (laterIds.length > 0) {
    await db
      .update(careerProposals)
      .set({ status: "undone", updatedAt: new Date() })
      .where(inArray(careerProposals.appliedVersionId, laterIds));
  }
  return restored;
}

/**
 * Applies one hand edit as a new record version. `expectedVersion` is the version the user was looking at; if the
 * record has moved on, `RecordConflict` is raised and nothing is saved.
 */
export async function editRecord(
  op: EditOp,
  expectedVersion: number,
  db: DbOrTx = defaultDb(),
  ctx: { newId?: () => string; now?: Date } = {},
): Promise<CareerRecordVersionRow> {
  const current = await currentRecord(db);
  if (current.version !== expectedVersion) throw new RecordConflict(expectedVersion, current.version);
  const { record, note } = applyEdit(current.record, op, { newId: ctx.newId ?? newId, now: ctx.now ?? new Date() });
  return saveRecordVersion({ record, reason: "edit", note, expectedVersion }, db);
}

/** What the record shows for each source a wording came from: its name, and where to open it if it still exists. */
export type SourceInfo = {
  kind: SourceKind;
  label: string;
  /** Library page of the exact version that was read, or null for the Profile, LinkedIn and deleted documents. */
  href: string | null;
  deleted: boolean;
};

export async function listSourceInfo(db: DbOrTx = defaultDb()): Promise<Record<string, SourceInfo>> {
  const rows = await db
    .select({ source: careerSources, deletedAt: documents.deletedAt })
    .from(careerSources)
    .leftJoin(documents, eq(documents.id, careerSources.documentId));
  const out: Record<string, SourceInfo> = {};
  for (const { source, deletedAt } of rows) {
    const deleted = source.documentId !== null && deletedAt !== null;
    out[source.id] = {
      kind: source.kind,
      label: source.label,
      deleted,
      href: source.documentId && !deleted ? `/library/${source.documentId}?version=${source.documentVersionId}` : source.kind === "profile" ? "/profile" : null,
    };
  }
  return out;
}

