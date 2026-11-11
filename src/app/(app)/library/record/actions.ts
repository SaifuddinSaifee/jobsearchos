"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { addDocumentsToRecord, enqueueProfileSource } from "@/lib/career/queue";
import { OfferError, setRecordChoice } from "@/lib/career/offer";
import { enqueueAfterCreate } from "@/lib/documents/queue";
import { createVersion, DocumentError } from "@/lib/documents/service";
import { RECORD_CHOICES } from "@/lib/documents/types";
import { withLlmContext } from "@/lib/llm/context";
import { DecisionsSchema } from "@/lib/career/proposal-schema";
import {
  applyReviewedProposal,
  dismissProposal,
  prepareSkipped,
  ProposalError,
  regroupRole,
  retryFailedProposals,
  reviewAgain,
  saveDecisions,
  skipProposal,
} from "@/lib/career/review";
import { EditError } from "@/lib/career/edit";
import { EditOpSchema } from "@/lib/career/edit-schema";
import { editRecord, RecordConflict, restoreRecordVersion } from "@/lib/career/service";
import { applyCompaction, dismissCompaction, saveCompactionAnswers, startCompaction } from "@/lib/career/compaction";
import { CompactionAnswersSchema } from "@/lib/career/compact-schema";
import { kickWorker, stopCareerProposal } from "@/lib/queue/worker";

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string; stale?: boolean };

async function run<T extends object>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    const out = await fn();
    revalidatePath("/library");
    revalidatePath("/library/record/review");
    return { ok: true, ...out };
  } catch (err) {
    if (err instanceof ProposalError) return { ok: false, error: err.message, stale: err.stale };
    if (err instanceof OfferError || err instanceof DocumentError) return { ok: false, error: err.message };
    if (err instanceof EditError) return { ok: false, error: err.message, stale: true };
    if (err instanceof RecordConflict) return { ok: false, error: "Your record changed since you opened it. It has been reloaded.", stale: true };
    if (err instanceof z.ZodError) return { ok: false, error: err.issues[0]?.message ?? "Invalid input" };
    if (err instanceof Error && err.message === "Version not found") return { ok: false, error: err.message };
    console.error("[career] action failed:", err);
    return { ok: false, error: "Something went wrong. Try again." };
  }
}

const Id = z.uuid();

/** Saves an old record version as a new one. History is never rewritten. */
export async function restoreRecordVersionAction(versionId: string) {
  return run(async () => {
    const restored = await restoreRecordVersion(Id.parse(versionId));
    return { version: restored.version };
  });
}

/**
 * Adds the chosen resumes and cover letters to the record. With `autoApply` (the one-click add) each is added as
 * suggested once prepared; otherwise each waits for review, one at a time.
 */
export async function addDocumentsAction(documentIds: string[], autoApply: boolean) {
  return run(async () => {
    const ids = z.array(Id).min(1, "Choose at least one document").max(500).parse(documentIds);
    const out = await addDocumentsToRecord(ids, { autoApply: z.boolean().parse(autoApply) });
    kickWorker();
    return out;
  });
}

/**
 * Adds the document open in the editor, as it is now: what the editor holds is saved as a version first (the editor
 * has already saved its draft before calling this), so the record gets exactly what is on the page.
 */
export async function addOpenDocumentAction(documentId: string, autoApply: boolean) {
  return run(async () => {
    const id = Id.parse(documentId);
    const made = await createVersion(id, { reason: "manual", note: "Saved to add to the career record" });
    if (made.created) await enqueueAfterCreate(id);
    const out = await addDocumentsToRecord([id], { autoApply: z.boolean().parse(autoApply) });
    kickWorker();
    return out;
  });
}

/** "Not now" (for this version), "never" (for every version), or null to be asked again. */
export async function setRecordChoiceAction(documentId: string, choice: string | null) {
  return run(async () => {
    await setRecordChoice(Id.parse(documentId), z.enum(RECORD_CHOICES).nullable().parse(choice));
    return {};
  });
}

/** Keeps the user's choices while they review, so a reload loses nothing. */
export async function saveDecisionsAction(proposalId: string, decisions: unknown) {
  return run(async () => {
    await saveDecisions(Id.parse(proposalId), DecisionsSchema.parse(decisions));
    return {};
  });
}

/** Saves the choices, merges the source into the record as a new version, and prepares the next source. */
export async function applyProposalAction(proposalId: string, decisions: unknown) {
  return run(async () => {
    const id = Id.parse(proposalId);
    await saveDecisions(id, DecisionsSchema.parse(decisions));
    try {
      const out = await applyReviewedProposal(id);
      return { version: out.version, summary: out.summary };
    } finally {
      // Either the next source is prepared, or (when the record changed) this one is prepared again.
      kickWorker();
    }
  });
}

/** Leaves a source out of the record and prepares the next one. */
export async function dismissProposalAction(proposalId: string) {
  return run(async () => {
    await dismissProposal(Id.parse(proposalId));
    kickWorker();
    return {};
  });
}

/** Sets a source aside unreviewed (stopping it if it is being prepared) and moves on to the next one. */
export async function skipProposalAction(proposalId: string) {
  return run(async () => {
    const id = Id.parse(proposalId);
    const { label } = await skipProposal(id);
    stopCareerProposal(id);
    kickWorker();
    return { label };
  });
}

/** Queues a skipped source to be prepared for review. */
export async function prepareSkippedAction(proposalId: string) {
  return run(async () => {
    await prepareSkipped(Id.parse(proposalId));
    kickWorker();
    return {};
  });
}

export async function retryFailedAction() {
  return run(async () => {
    const count = await retryFailedProposals();
    kickWorker();
    return { count };
  });
}

/** Puts a merge that was undone by a restore back in the queue. */
export async function reviewAgainAction(proposalId: string) {
  return run(async () => {
    await reviewAgain(Id.parse(proposalId));
    kickWorker();
    return {};
  });
}

/** One hand edit of the career record, saved as a new version. `version` is the one the user was looking at. */
export async function editRecordAction(op: unknown, version: number) {
  return run(async () => {
    const saved = await editRecord(EditOpSchema.parse(op), z.number().int().min(0).parse(version));
    return { version: saved.version, note: saved.changeNote };
  });
}

/** Compares a role's bullets with the role the user moved it under, so each bullet gets a suggestion that fits. */
export async function regroupRoleAction(proposalId: string, roleKey: string, target: unknown) {
  return run(async () => {
    const id = Id.parse(proposalId);
    const key = z.string().min(1).parse(roleKey);
    const out = await withLlmContext("regroup-role", { proposalId: id }, () => regroupRole(id, key, target));
    return { proposal: out.proposal };
  });
}

/** Queues the saved Profile as a source, unless it is empty or already in the record. */
export async function includeProfileAction() {
  return run(async () => {
    const outcome = await enqueueProfileSource();
    if (outcome && outcome.status !== "skipped") kickWorker();
    return {
      status: outcome === null ? ("empty" as const) : outcome.status,
      reason: outcome?.status === "skipped" ? outcome.reason : null,
    };
  });
}

/** Queues a tidy of the record (one statement per fact, repeats folded in), or returns the one already open. */
export async function startCompactionAction() {
  return run(async () => {
    const out = await startCompaction();
    kickWorker();
    return out;
  });
}

/** Starts a fresh tidy after one that failed. */
export async function retryCompactionAction(compactionId: string) {
  return run(async () => {
    await dismissCompaction(Id.parse(compactionId));
    const out = await startCompaction();
    kickWorker();
    return out;
  });
}

/** Keeps the answers to a tidy's questions while the user reviews it. */
export async function saveCompactionAnswersAction(compactionId: string, answers: unknown) {
  return run(async () => {
    await saveCompactionAnswers(Id.parse(compactionId), CompactionAnswersSchema.parse(answers));
    return {};
  });
}

/** Saves the answers, then the tidied record as a new version. */
export async function applyCompactionAction(compactionId: string, answers: unknown) {
  return run(async () => {
    const id = Id.parse(compactionId);
    await saveCompactionAnswers(id, CompactionAnswersSchema.parse(answers));
    try {
      return await applyCompaction(id);
    } finally {
      // When the record changed, the tidy was queued to be worked out again.
      kickWorker();
    }
  });
}

/** Leaves the record as it is. */
export async function dismissCompactionAction(compactionId: string) {
  return run(async () => {
    await dismissCompaction(Id.parse(compactionId));
    return {};
  });
}
