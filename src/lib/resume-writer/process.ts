import { and, desc, eq, ne } from "drizzle-orm";
import { normalizeText } from "@/lib/career/normalize";
import { db as defaultDb, type Db } from "@/lib/db";
import { resumeGenerations, type ResumeGenerationRow } from "@/lib/db/schema";
import { createDocument, addGeneratedVersion, getDocument } from "@/lib/documents/service";
import { enqueueDocumentIndex } from "@/lib/resume/indexing";
import { getJobDetail } from "@/lib/jobs/tracker";
import { getLatest } from "@/lib/profile/service";
import { emptyProfile } from "@/lib/profile/schema";
import type { CareerRecord } from "@/lib/career/schema";
import { buildResumeDoc } from "./build";
import { findClashes } from "./clashes";
import { buildRequirements, indexSource } from "./context";
import { matchRequirements, modelMatcher, type Matcher } from "./match";
import { getGenerationRow } from "./service";
import { loadContact, loadSource } from "./source";
import { assumeQualified, endRunning, endStep, NO_SOURCE_MESSAGE, startStep, type GenerationChoices, type GenerationSteps, type Requirement, type ReviewOptions } from "./types";
import { chosenFraming, planWriting, recentRoles, recommendFraming } from "./write";
import { modelWriter, type Writer, type WriterStage } from "./writer";

// The two phases the background worker runs for a generation: matching what the job asks for against the source, and,
// after the user's review, writing the resume. Every outside thing (the models) is passed in, so the tests never reach
// the network.

export type ProcessDeps = {
  db?: Db;
  matcher?: Matcher;
  writer?: Writer;
  now?: Date;
};

/** The longest posting text kept on the resume as the job description it was written for. */
const MAX_JD_CHARS = 50_000;

class Failure extends Error {}

/**
 * Carries over what the user said last time to the same requirements this time: that they have it, and any note, also
 * one added to something the record already shows ("Add detail"), which is not ticked but is still theirs to keep.
 */
export function carryOver(fresh: Requirement[], previous: Requirement[]): Requirement[] {
  const said = new Map(previous.filter((r) => r.userHas || r.note.trim() !== "").map((r) => [normalizeText(r.text), r]));
  return fresh.map((r) => {
    const before = said.get(normalizeText(r.text));
    return before ? { ...r, userHas: r.userHas || before.userHas, note: before.note } : r;
  });
}

/**
 * What the review screen offers besides the requirements, and the choices it starts from. Each role told more than one
 * way gets the telling recommended for the job; each fact whose wordings disagree on a number gets the wording most of
 * the user's documents agree on. A telling the user chose for this job before, and a number they settled for any job
 * before, are kept (record ids do not change between versions).
 */
export function reviewChoices(
  record: CareerRecord,
  job: { title: string },
  requirements: Requirement[],
  before: { framings: Record<string, string>; wordings: Record<string, string> },
): { options: ReviewOptions; choices: GenerationChoices } {
  const recent = recentRoles(record);
  const roles = recent
    .filter(({ role }) => role.framings.length > 1)
    .map(({ employer, role }) => ({
      roleId: role.id,
      label: employer,
      framings: role.framings.map((f) => ({ id: f.id, title: f.title })),
      recommended: recommendFraming(role, job.title, requirements)?.id ?? role.framings[0].id,
    }));
  const framings = Object.fromEntries(roles.filter((r) => r.framings.some((f) => f.id === before.framings[r.roleId])).map((r) => [r.roleId, before.framings[r.roleId]]));
  const clashes = findClashes(recent.map(({ employer, role }) => ({ employer, role, framingId: chosenFraming(role, job.title, requirements, { framings, wordings: {} })?.id ?? null })));
  const wordings = Object.fromEntries(clashes.map((c) => [c.factId, c.options.some((o) => o.wordingId === before.wordings[c.factId]) ? before.wordings[c.factId] : c.recommended]));
  return { options: { roles, clashes }, choices: { framings, wordings } };
}

/** Writes a patch to a generation that is still in the expected running status. False when it has moved on (stopped). */
async function update(db: Db, id: string, running: "matching" | "writing", patch: Partial<typeof resumeGenerations.$inferInsert>): Promise<boolean> {
  const rows = await db
    .update(resumeGenerations)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(resumeGenerations.id, id), eq(resumeGenerations.status, running)))
    .returning({ id: resumeGenerations.id });
  return rows.length > 0;
}

/** Runs the claimed phase of a generation. Failures are recorded on its row; a stopped generation records nothing. */
export async function processGeneration(id: string, deps: ProcessDeps = {}): Promise<void> {
  const db = deps.db ?? defaultDb();
  const row = await getGenerationRow(id, db);
  if (!row || (row.status !== "matching" && row.status !== "writing")) return;
  const running = row.status;
  // Each phase adds its own time, so the total leaves out the wait for the user's review between them.
  const started = Date.now();
  const workMs = () => (row.workMs ?? 0) + (Date.now() - started);
  try {
    if (running === "matching") await runMatching(row, deps, db, workMs);
    else await runWriting(row, deps, db, workMs);
  } catch (err) {
    const message = err instanceof Failure ? err.message : (err instanceof Error ? err.message : "Could not write this resume").slice(0, 500);
    if (!(err instanceof Failure)) console.error("[resume-writer] failed:", err instanceof Error ? err.message : err);
    // The step it failed in keeps the time it ran, like the ones before it.
    const steps = endRunning((await getGenerationRow(id, db).catch(() => null))?.steps ?? {}, "failed");
    await update(db, id, running, { status: "failed", error: message, steps, finishedAt: new Date(), workMs: workMs() });
  }
}

/** Reads the job, lines what it asks for up against the source, and stops for review (or goes on to writing). */
async function runMatching(row: ResumeGenerationRow, deps: ProcessDeps, db: Db, workMs: () => number): Promise<void> {
  const steps: GenerationSteps = { read: startStep() };
  if (!(await update(db, row.id, "matching", { steps }))) return;

  const job = await getJobDetail(row.jobId, db);
  if (!job) throw new Failure("That job no longer exists.");
  const source = await loadSource(db);
  if (!source) throw new Failure(NO_SOURCE_MESSAGE);

  steps.read = endStep(steps.read, "done", source.source === "record" ? "Career record" : "Base resume");
  steps.match = startStep();
  if (!(await update(db, row.id, "matching", { steps }))) return;

  const [previous] = await db
    .select({ requirements: resumeGenerations.requirements, choices: resumeGenerations.choices })
    .from(resumeGenerations)
    .where(and(eq(resumeGenerations.jobId, row.jobId), eq(resumeGenerations.status, "done"), ne(resumeGenerations.id, row.id)))
    .orderBy(desc(resumeGenerations.createdAt))
    .limit(1);
  // A number the user settled is settled for every job: the latest finished generation of any job carries it.
  const [lastAnywhere] = await db
    .select({ choices: resumeGenerations.choices })
    .from(resumeGenerations)
    .where(and(eq(resumeGenerations.status, "done"), ne(resumeGenerations.id, row.id)))
    .orderBy(desc(resumeGenerations.createdAt))
    .limit(1);
  const fresh = carryOver(buildRequirements(job), previous?.requirements ?? []);
  const matched = fresh.length > 0 ? await matchRequirements(fresh, indexSource(source.record), deps.matcher ?? modelMatcher) : [];
  // With the review turned off, nobody ticks what they have, so the candidate is taken to be qualified (as the review
  // screen does when it starts with the gaps ticked). The match shown stays what the source really says.
  const requirements = row.skipReview ? assumeQualified(matched) : matched;
  const { options, choices } = reviewChoices(source.record, job, matched, { framings: previous?.choices.framings ?? {}, wordings: lastAnywhere?.choices.wordings ?? {} });

  steps.match = endStep(steps.match, "done", `${matched.filter((r) => r.verdict === "met").length} of ${matched.length}`);
  const notes = [
    ...(source.source === "base_resume" ? ["Your career record is empty, so this is written from your base resume."] : []),
    ...(requirements.length === 0 ? ["The posting lists nothing to match, so there was nothing to review."] : []),
  ];
  await update(db, row.id, "matching", {
    // With nothing to review, or the review turned off, writing follows at once.
    status: row.skipReview || requirements.length === 0 ? "writing_queued" : "review",
    requirements,
    choices,
    reviewOptions: options,
    source: source.source,
    recordVersion: source.recordVersion,
    baseVersionId: source.baseVersionId,
    steps,
    notes,
    workMs: workMs(),
  });
}

/** Writes the resume from the reviewed requirements and saves it as the job's resume. */
async function runWriting(row: ResumeGenerationRow, deps: ProcessDeps, db: Db, workMs: () => number): Promise<void> {
  // Matching's steps stay; writing's start afresh (a run picked up again after a restart has none left over).
  const steps: GenerationSteps = { read: row.steps.read, match: row.steps.match, write: startStep() };
  if (!(await update(db, row.id, "writing", { steps }))) return;

  const job = await getJobDetail(row.jobId, db);
  if (!job) throw new Failure("That job no longer exists.");
  const source = await loadSource(db);
  if (!source) throw new Failure(NO_SOURCE_MESSAGE);
  const latestProfile = await getLatest(db);
  const instructions = latestProfile?.generationInstructions ?? null;
  const contact = await loadContact((latestProfile?.profile ?? emptyProfile()).contact, db);

  const plan = planWriting(source.record, job, row.requirements, instructions, row.choices);
  if (plan.roles.length === 0) throw new Failure("There is no experience to write from yet.");
  // Each stage of writing is saved as it starts and ends, so the page shows where it is and how long each part took.
  const onStage: WriterStage = async (name, status, detail) => {
    steps[name] = status === "running" ? startStep() : endStep(steps[name], status, detail);
    await update(db, row.id, "writing", { steps });
  };
  const { written, notes } = await (deps.writer ?? modelWriter)(plan, job, row.requirements, instructions, onStage);

  if (steps.write?.status === "running") steps.write = endStep(steps.write, "done");
  steps.save = startStep();
  if (!(await update(db, row.id, "writing", { steps }))) return;

  const title = `Resume for ${job.title} at ${job.company}`;
  const { doc, bulletFacts } = buildResumeDoc(written, contact);
  const existing = row.documentId ? await getDocument(row.documentId, db) : null;
  let documentId: string;
  if (existing) {
    await addGeneratedVersion(existing.id, doc, { note: `Written for ${job.title} at ${job.company}` }, db);
    documentId = existing.id;
  } else {
    const made = await createDocument(
      {
        kind: "resume",
        origin: "generated",
        reason: "generated",
        title,
        content: doc,
        jobId: row.jobId,
        targetRole: job.title,
        jdUrl: job.postingUrl,
        jdText: job.snapshot?.rawText?.slice(0, MAX_JD_CHARS) ?? null,
        writtenOn: (deps.now ?? new Date()).toISOString().slice(0, 10),
      },
      db,
    );
    documentId = made.document.id;
  }
  await enqueueDocumentIndex(documentId, {}, db).catch(() => null);

  steps.save = endStep(steps.save, "done");
  await update(db, row.id, "writing", {
    status: "done",
    documentId,
    bulletFacts,
    steps,
    notes: [...row.notes, ...notes],
    finishedAt: new Date(),
    workMs: workMs(),
  });
}
