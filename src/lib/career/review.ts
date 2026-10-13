import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db as defaultDb, type Db } from "@/lib/db";
import { careerProposals, careerRecordVersions, careerSources } from "@/lib/db/schema";
import type { DbOrTx } from "@/lib/documents/service";
import { newId, type IdGen } from "@/lib/documents/build";
import { applyProposal, checkRefs, resolveDecisions, type ApplySummary } from "./apply";
import type { FailedSource } from "./failure";
import { modelGrouper, type Grouper } from "./group";
import { getProposalRow, getSourceRow, getSourceText } from "./queue";
import { groupRoleBullets } from "./regroup";
import { DecisionsSchema, ProposalSchema, RoleSuggestionSchema, type Decisions, type Proposal, type RoleSuggestion } from "./proposal-schema";
import { RecordConflict, currentRecord, saveRecordVersion } from "./service";
import { PROPOSAL_STATUSES, type ProposalStatus, type SourceKind } from "./schema";

export class ProposalError extends Error {
  constructor(
    message: string,
    /** True when the record changed under the proposal and it was queued to be prepared again. */
    public readonly stale = false,
  ) {
    super(message);
    this.name = "ProposalError";
  }
}

/** Saves the user's choices so far. Only a proposal waiting for review takes decisions. */
export async function saveDecisions(proposalId: string, decisions: unknown, db: DbOrTx = defaultDb()): Promise<void> {
  const parsed = DecisionsSchema.parse(decisions);
  const rows = await db
    .update(careerProposals)
    .set({ decisions: parsed, updatedAt: new Date() })
    .where(and(eq(careerProposals.id, proposalId), eq(careerProposals.status, "ready")))
    .returning({ id: careerProposals.id });
  if (rows.length === 0) throw new ProposalError("This source is no longer waiting for review.");
}

/**
 * The user moved a role under a different role of the record. Settles that role's bullets against the new target
 * (exact matches first, then the model), forgets the choices made for those bullets, and saves both.
 */
export async function regroupRole(
  proposalId: string,
  roleKey: string,
  target: unknown,
  opts: { db?: DbOrTx; grouper?: Grouper } = {},
): Promise<{ proposal: Proposal; decisions: Decisions }> {
  const db = opts.db ?? defaultDb();
  const wanted: RoleSuggestion = RoleSuggestionSchema.parse(target);
  const row = await getProposalRow(proposalId, db);
  if (!row || row.status !== "ready" || !row.proposal) throw new ProposalError("This source is no longer waiting for review.");
  const proposal = ProposalSchema.parse(row.proposal);
  const decisions = DecisionsSchema.parse(row.decisions);
  const { record } = await currentRecord(db);

  const roleId = wanted.to === "new" ? null : wanted.roleId;
  const targetRole = roleId ? (record.employers.flatMap((e) => e.roles).find((r) => r.id === roleId) ?? null) : null;
  if (roleId && !targetRole) throw new ProposalError("That role is no longer in your record.");

  let found = false;
  const employers = await Promise.all(
    proposal.employers.map(async (e) => ({
      ...e,
      roles: await Promise.all(
        e.roles.map(async (r) => {
          if (r.key !== roleKey) return r;
          found = true;
          return { ...r, bullets: await groupRoleBullets(r, targetRole, opts.grouper ?? modelGrouper) };
        }),
      ),
    })),
  );
  if (!found) throw new ProposalError("That role is not in this proposal.");

  const item = employers.flatMap((e) => e.roles).find((r) => r.key === roleKey)!;
  const forgotten = new Set(item.bullets.map((b) => b.key));
  const nextDecisions = Object.fromEntries(Object.entries(decisions).filter(([k]) => !forgotten.has(k)));
  const next: Proposal = { ...proposal, employers };
  await db
    .update(careerProposals)
    .set({ proposal: next, decisions: nextDecisions, updatedAt: new Date() })
    .where(and(eq(careerProposals.id, proposalId), eq(careerProposals.status, "ready")));
  return { proposal: next, decisions: nextDecisions };
}

/** Leaves a source out of the record. The next one is prepared. */
export async function dismissProposal(proposalId: string, db: DbOrTx = defaultDb()): Promise<void> {
  const rows = await db
    .update(careerProposals)
    .set({ status: "dismissed", finishedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(careerProposals.id, proposalId), inArray(careerProposals.status, ["ready", "queued", "failed"])))
    .returning({ id: careerProposals.id });
  if (rows.length === 0) throw new ProposalError("This source can no longer be left out.");
}

/**
 * Sets a source aside without reviewing it, so the next one is prepared: one being prepared is stopped (the worker
 * is told separately), and one waiting for review gives up its slot. It stays unreviewed, with the user's choices
 * kept, until they ask for it to be prepared again.
 */
export async function skipProposal(proposalId: string, db: DbOrTx = defaultDb()): Promise<{ label: string }> {
  const rows = await db
    .update(careerProposals)
    .set({ status: "skipped", proposal: null, baseVersion: null, error: null, note: null, finishedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(careerProposals.id, proposalId), inArray(careerProposals.status, ["queued", "running", "ready"])))
    .returning({ sourceId: careerProposals.sourceId });
  if (rows.length === 0) throw new ProposalError("This source is no longer being prepared.");
  const source = await getSourceRow(rows[0].sourceId, db);
  return { label: source?.label ?? "This source" };
}

/** Queues a skipped source again, in its usual place in the order. */
export async function prepareSkipped(proposalId: string, db: DbOrTx = defaultDb()): Promise<void> {
  const rows = await db
    .update(careerProposals)
    .set({ status: "queued", attempts: 0, startedAt: null, finishedAt: null, updatedAt: new Date() })
    .where(and(eq(careerProposals.id, proposalId), eq(careerProposals.status, "skipped")))
    .returning({ id: careerProposals.id });
  if (rows.length === 0) throw new ProposalError("This source was not skipped.");
}

/** Tries a failed proposal again. */
export async function retryProposal(proposalId: string, db: DbOrTx = defaultDb()): Promise<void> {
  const rows = await db
    .update(careerProposals)
    .set({ status: "queued", error: null, note: null, attempts: 0, startedAt: null, finishedAt: null, updatedAt: new Date() })
    .where(and(eq(careerProposals.id, proposalId), eq(careerProposals.status, "failed")))
    .returning({ id: careerProposals.id });
  if (rows.length === 0) throw new ProposalError("This source is not waiting to be retried.");
}

/** Queues every failed proposal again. Returns how many. */
export async function retryFailedProposals(db: DbOrTx = defaultDb()): Promise<number> {
  const rows = await db
    .update(careerProposals)
    .set({ status: "queued", error: null, note: null, attempts: 0, startedAt: null, finishedAt: null, updatedAt: new Date() })
    .where(eq(careerProposals.status, "failed"))
    .returning({ id: careerProposals.id });
  return rows.length;
}

/** Puts an undone merge back in the queue, to be reviewed again against the restored record. */
export async function reviewAgain(proposalId: string, db: DbOrTx = defaultDb()): Promise<void> {
  const rows = await db
    .update(careerProposals)
    .set({
      status: "queued",
      proposal: null,
      decisions: {},
      appliedVersionId: null,
      baseVersion: null,
      error: null,
      note: null,
      attempts: 0,
      startedAt: null,
      finishedAt: null,
      updatedAt: new Date(),
    })
    .where(and(eq(careerProposals.id, proposalId), eq(careerProposals.status, "undone")))
    .returning({ id: careerProposals.id });
  if (rows.length === 0) throw new ProposalError("This merge was not undone.");
}

/**
 * Applies a reviewed proposal and saves the result as a new record version. If the record changed since the
 * proposal was prepared, it still applies as long as everything it points at exists; otherwise the proposal is
 * queued to be prepared again (keeping the user's choices) and a stale error is raised.
 */
export async function applyReviewedProposal(
  proposalId: string,
  opts: { db?: Db; newId?: IdGen } = {},
): Promise<{ version: number; summary: ApplySummary }> {
  const db = opts.db ?? defaultDb();
  const row = await getProposalRow(proposalId, db);
  if (!row || row.status !== "ready" || !row.proposal) throw new ProposalError("This source is no longer waiting for review.");
  const source = await getSourceRow(row.sourceId, db);
  if (!source) throw new ProposalError("The source of this proposal no longer exists.");

  const proposal: Proposal = ProposalSchema.parse(row.proposal);
  const decisions: Decisions = DecisionsSchema.parse(row.decisions);
  const current = await currentRecord(db);
  const resolved = resolveDecisions(proposal, decisions, current.record);

  const missing = checkRefs(current.record, resolved);
  if (missing.length > 0) {
    await db
      .update(careerProposals)
      .set({ status: "queued", proposal: null, baseVersion: null, startedAt: null, finishedAt: null, attempts: 0, updatedAt: new Date() })
      .where(and(eq(careerProposals.id, proposalId), eq(careerProposals.status, "ready")));
    throw new ProposalError("Your record changed while you were reviewing. It is being checked again; your choices are kept.", true);
  }

  const { record, summary } = applyProposal(
    current.record,
    resolved,
    { sourceId: source.id, label: source.label, newId: opts.newId ?? newId },
    proposal.targetRole,
  );

  try {
    const saved = await db.transaction(async (tx) => {
      const version = await saveRecordVersion(
        {
          record,
          reason: "merge",
          note: `Merged "${source.label}"`,
          proposalId,
          expectedVersion: current.version,
        },
        tx,
      );
      await tx
        .update(careerProposals)
        .set({ status: "applied", appliedVersionId: version.id, finishedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(careerProposals.id, proposalId), eq(careerProposals.status, "ready")));
      return version;
    });
    return { version: saved.version, summary };
  } catch (err) {
    if (err instanceof RecordConflict) {
      throw new ProposalError("Your record changed while you were saving. Reload and try again.", true);
    }
    throw err;
  }
}

export type OpenReview = {
  proposalId: string;
  proposal: Proposal;
  decisions: Decisions;
  note: string | null;
  source: { id: string; kind: SourceKind; label: string; documentId: string | null; documentVersionId: string | null; text: string };
};

/** The proposal waiting for review, with the text of its source and the user's choices so far. */
export async function getOpenReview(db: DbOrTx = defaultDb()): Promise<OpenReview | null> {
  const [row] = await db.select().from(careerProposals).where(eq(careerProposals.status, "ready")).limit(1);
  if (!row?.proposal) return null;
  const source = await getSourceRow(row.sourceId, db);
  if (!source) return null;
  const text = await getSourceText(source, db);
  return {
    proposalId: row.id,
    proposal: ProposalSchema.parse(row.proposal),
    decisions: DecisionsSchema.parse(row.decisions),
    note: row.note,
    source: {
      id: source.id,
      kind: source.kind,
      label: source.label,
      documentId: source.documentId,
      documentVersionId: source.documentVersionId,
      text,
    },
  };
}

export type CareerStatus = {
  counts: Record<ProposalStatus, number>;
  /** Sources that still need work or a decision, plus those already decided: the "3 of 27" in the review. */
  total: number;
  done: number;
  current: { id: string; status: ProposalStatus; label: string; kind: SourceKind } | null;
  failed: FailedSource[];
  /** Merges that were undone by a restore and can be reviewed again. */
  undone: { id: string; label: string }[];
  /** Sources the user set aside before reviewing them. */
  skipped: { id: string; label: string }[];
  recordVersion: number;
};

export async function getCareerStatus(db: DbOrTx = defaultDb()): Promise<CareerStatus> {
  const counts = Object.fromEntries(PROPOSAL_STATUSES.map((s) => [s, 0])) as Record<ProposalStatus, number>;
  const grouped = await db
    .select({ status: careerProposals.status, n: sql<number>`count(*)::int` })
    .from(careerProposals)
    .groupBy(careerProposals.status);
  for (const g of grouped) counts[g.status] = g.n;

  const withSource = (status: ProposalStatus[]) =>
    db
      .select({ proposal: careerProposals, source: careerSources })
      .from(careerProposals)
      .innerJoin(careerSources, eq(careerSources.id, careerProposals.sourceId))
      .where(inArray(careerProposals.status, status))
      .orderBy(asc(careerProposals.priority), asc(careerProposals.createdAt));

  const [open] = await withSource(["running", "ready"]);
  const failed = await withSource(["failed"]);
  const undone = await withSource(["undone"]);
  const skipped = await withSource(["skipped"]);
  // Only the number: this is polled from every page (the sidebar), so the record itself is not loaded.
  const [latest] = await db
    .select({ version: careerRecordVersions.version })
    .from(careerRecordVersions)
    .orderBy(desc(careerRecordVersions.version))
    .limit(1);

  const done = counts.applied + counts.dismissed;
  return {
    counts,
    done,
    total: done + counts.queued + counts.running + counts.ready + counts.failed + counts.skipped,
    current: open ? { id: open.proposal.id, status: open.proposal.status, label: open.source.label, kind: open.source.kind } : null,
    failed: failed.map((f) => ({
      id: f.proposal.id,
      label: f.source.label,
      kind: f.source.kind,
      error: f.proposal.error,
      attempts: f.proposal.attempts,
      failedAt: (f.proposal.finishedAt ?? f.proposal.updatedAt).toISOString(),
    })),
    undone: undone.map((u) => ({ id: u.proposal.id, label: u.source.label })),
    skipped: skipped.map((u) => ({ id: u.proposal.id, label: u.source.label })),
    recordVersion: latest?.version ?? 0,
  };
}

