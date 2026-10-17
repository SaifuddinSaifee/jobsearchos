import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";

process.env.DATABASE_URL ??= "postgres://unused";
vi.mock("@/lib/llm/openai", () => ({ chatClient: () => ({}) }));

import { saveRecordVersion } from "@/lib/career/service";
import { applications, documents, documentVersions, resumeGenerations } from "@/lib/db/schema";
import { createDocument } from "@/lib/documents/service";
import { emptyExtraction, type JobDraft } from "@/lib/jobs/schema";
import { saveJob } from "@/lib/jobs/service";
import { changeStatus } from "@/lib/jobs/tracker";
import { defaultDocumentId } from "@/lib/outreach/attachments";
import { saveVersion as saveProfile } from "@/lib/profile/service";
import { emptyInstructions, emptyProfile } from "@/lib/profile/schema";
import { carryOver, processGeneration } from "@/lib/resume-writer/process";
import {
  claimNextGeneration,
  findJobResume,
  getJobResumeState,
  listActiveGenerations,
  recoverInterruptedGenerations,
  saveReview,
  startGeneration,
  stopGeneration,
  sweepStaleGenerations,
} from "@/lib/resume-writer/service";
import { NO_SOURCE_MESSAGE } from "@/lib/resume-writer/types";
import { processGenerationJob } from "@/lib/queue/worker";
import { profileToDoc } from "@/lib/documents/convert/profile-to-doc";
import { buildRequirements } from "@/lib/resume-writer/context";
import type { Matcher } from "@/lib/resume-writer/match";
import type { WriterAnswer } from "@/lib/resume-writer/write";
import { readWriting } from "@/lib/resume-writer/write";
import { makeWriter, type Writer } from "@/lib/resume-writer/writer";
import { counter, fact, profileWith } from "./career-helpers";
import { resetDb, testDb } from "./helpers";
import { record as sampleRecord, job as sampleJob } from "./resume-writer-helpers";

const db = testDb();
beforeEach(() => resetDb(db));
afterAll(() => db.$client.end());

function draft(over: Partial<JobDraft> = {}): JobDraft {
  const e = {
    ...emptyExtraction(),
    company: "Stripe",
    title: "Product Manager",
    location: "Remote",
    technologies: ["SQL"],
    keywords: ["payments"],
    responsibilities: ["Own the payments roadmap"],
    requirements: { required: ["Experience launching payments products", "Strong SQL"], preferred: ["Familiarity with Go"] },
  };
  return { ...e, sourceUrl: "https://boards.greenhouse.io/stripe/jobs/1", fetchMethod: "greenhouse", ats: "greenhouse", atsJobId: "1", rawFileId: null, rawText: "Posting text", normalized: e, ...over };
}

async function seedJob() {
  const r = await saveJob(draft(), db);
  if (!r.ok) throw new Error("seed failed");
  return { jobId: r.jobId, applicationId: r.applicationId };
}

/** A career record with experience in it, and a profile with a contact line. */
async function seedRecord() {
  await saveRecordVersion({ record: sampleRecord(), reason: "edit" }, db);
  await saveProfile({ profile: { ...emptyProfile(), contact: { name: "Sam Example", email: "sam@example.com", phone: "", location: "Remote", links: [] } } }, db);
}

const answers: Record<string, string[]> = { "Experience launching payments products": ["fact1"], "Strong SQL": ["fact4", "skill1"] };
const matcher = vi.fn<Matcher>(async (open) => new Map(open.filter((r) => answers[r.text]).map((r) => [r.id, { verdict: "met" as const, refs: answers[r.text] }])));

const answer = (): WriterAnswer => ({
  summary: "Product manager who shipped billing to thousands of merchants.",
  roles: [
    { role: "e1", bullets: [{ facts: ["f1"], text: "Launched self-serve billing for 2,000 merchants" }, { facts: ["f2"], text: "Cut build times by 40% across the platform team" }] },
    { role: "e2", bullets: [{ facts: ["f4"], text: "Built reporting tools in SQL for the finance team" }] },
  ],
  projects: [],
  certifications: ["c1"],
});

const writer: Writer = vi.fn(async (plan) => ({ written: readWriting(answer(), plan), notes: [] }));

/** Starts a generation and runs the phase the worker would claim, returning the row. */
async function runNext(extra: { matcher?: Matcher; writer?: Writer } = {}) {
  const claimed = await claimNextGeneration(db);
  if (!claimed) return null;
  await processGeneration(claimed.id, { db, matcher: extra.matcher ?? matcher, writer: extra.writer ?? writer });
  const [row] = await db.select().from(resumeGenerations).where(eq(resumeGenerations.id, claimed.id));
  return row;
}

describe("starting", () => {
  it("queues one generation per job, and gives the open one back when asked again", async () => {
    const { jobId } = await seedJob();
    const first = await startGeneration(jobId, {}, db);
    expect(first.generation).toMatchObject({ status: "queued", documentId: null, skipReview: false });
    const again = await startGeneration(jobId, {}, db);
    expect(again.generation.id).toBe(first.generation.id);
    expect(await db.select().from(resumeGenerations)).toHaveLength(1);
  });

  it("refuses an unknown job, and writes again into the same resume only when asked to", async () => {
    await expect(startGeneration("00000000-0000-4000-8000-000000000000", {}, db)).rejects.toThrow(/no longer exists/);
    const { jobId } = await seedJob();
    await seedRecord();
    await startGeneration(jobId, {}, db);
    const matched = (await runNext())!;
    await saveReview((await db.select().from(resumeGenerations))[0].id, { answers: [] }, db);
    const done = (await runNext())!;
    expect(done.status).toBe("done");
    // The time spent working: matching, then writing on top of it, without the wait for the review between them.
    expect(matched.workMs).toBeGreaterThanOrEqual(0);
    expect(done.workMs).toBeGreaterThanOrEqual(matched.workMs!);

    await expect(startGeneration(jobId, {}, db)).rejects.toThrow(/already has a resume/);
    const again = await startGeneration(jobId, { regenerate: true }, db);
    expect(again.generation.documentId).toBe(done.documentId);
  });

  it("skips the review step when the profile says so, and moves the job to Preparing at once", async () => {
    const { jobId, applicationId } = await seedJob();
    await saveProfile({ generationInstructions: { ...emptyInstructions(), reviewRequirements: false } }, db);
    const { generation, previous } = await startGeneration(jobId, {}, db);
    expect(generation.skipReview).toBe(true);
    expect(previous).toEqual([{ applicationId, status: "saved", appliedAt: null, expected: "preparing" }]);
    expect((await db.select().from(applications).where(eq(applications.id, applicationId)))[0].status).toBe("preparing");
  });
});

describe("matching", () => {
  it("settles what the job asks for against the record and waits for review", async () => {
    const { jobId } = await seedJob();
    await seedRecord();
    await startGeneration(jobId, {}, db);
    const row = (await runNext())!;
    expect(row).toMatchObject({ status: "review", source: "record", recordVersion: 1, notes: [] });
    const byText = new Map(row.requirements.map((r) => [r.text, r]));
    expect(byText.get("Experience launching payments products")).toMatchObject({ kind: "must", verdict: "met", refs: ["fact1"] });
    expect(byText.get("Strong SQL")).toMatchObject({ verdict: "met", refs: ["fact4", "skill1"] });
    expect(byText.get("Familiarity with Go")).toMatchObject({ kind: "nice", verdict: "missing" });
    expect(row.steps.match).toMatchObject({ status: "done" });
  });

  it("goes straight on to writing when the review is off", async () => {
    const { jobId } = await seedJob();
    await seedRecord();
    await saveProfile({ generationInstructions: { ...emptyInstructions(), reviewRequirements: false } }, db);
    await startGeneration(jobId, {}, db);
    expect((await runNext())!.status).toBe("writing_queued");
  });

  it("takes the candidate as qualified when the review is off: gaps are worked in, the match stays what the record says", async () => {
    const { jobId } = await seedJob();
    await seedRecord();
    await saveProfile({ generationInstructions: { ...emptyInstructions(), reviewRequirements: false } }, db);
    await startGeneration(jobId, {}, db);
    const row = (await runNext())!;
    const go = row.requirements.find((r) => r.text === "Familiarity with Go")!;
    expect(go).toMatchObject({ verdict: "missing", userHas: true });
    expect(row.requirements.find((r) => r.text === "Strong SQL")).toMatchObject({ verdict: "met", userHas: false });

    const seen = vi.fn<Writer>(async (...args) => writer(...args));
    await runNext({ writer: seen });
    expect(seen.mock.calls[0][0].users.map((u) => u.text)).toEqual(["Familiarity with Go"]);
  });

  it("writes from the base resume, and says so, while the record is empty", async () => {
    const { jobId } = await seedJob();
    await createDocument(
      { kind: "resume", origin: "uploaded", title: "Base", isBase: true, content: profileToDoc(profileWith([{ company: "Initech", title: "Developer", bullets: ["Wrote reporting tools in SQL"] }]), counter("b")) },
      db,
    );
    await startGeneration(jobId, {}, db);
    const row = (await runNext())!;
    expect(row).toMatchObject({ status: "review", source: "base_resume", recordVersion: null, notes: ["Your career record is empty, so this is written from your base resume."] });
    expect(row.baseVersionId).toBeTruthy();
  });

  it("fails with a clear message when there is nothing to write from", async () => {
    const { jobId } = await seedJob();
    await startGeneration(jobId, {}, db);
    expect(await runNext()).toMatchObject({ status: "failed", error: NO_SOURCE_MESSAGE });
  });

  it("fails with the reason when the model cannot be reached", async () => {
    const { jobId } = await seedJob();
    await seedRecord();
    await startGeneration(jobId, {}, db);
    const row = await runNext({
      matcher: async () => {
        throw new Error("Could not match requirements with the model: boom");
      },
    });
    expect(row).toMatchObject({ status: "failed", error: "Could not match requirements with the model: boom" });
  });

  it("carries over what the user said they have last time", () => {
    const [a, b] = buildRequirements(sampleJob);
    expect(carryOver([a, b], [{ ...a, userHas: true, note: "AWS certified" }])).toEqual([{ ...a, userHas: true, note: "AWS certified" }, b]);
  });
});

describe("review and writing", () => {
  async function reviewed(over: Parameters<typeof runNext>[0] = {}) {
    const { jobId, applicationId } = await seedJob();
    await seedRecord();
    await startGeneration(jobId, {}, db);
    const matched = (await runNext())!;
    return { jobId, applicationId, matched, over };
  }

  it("saves the user's answers, queues the writing and moves the job to Preparing with Undo", async () => {
    const { applicationId, matched } = await reviewed();
    const go = matched.requirements.find((r) => r.text === "Familiarity with Go")!;
    const { previous, generation } = await saveReview(matched.id, { answers: [{ id: go.id, userHas: true, note: "  side projects in Go  " }] }, db);
    expect(generation.status).toBe("writing_queued");
    expect(generation.requirements.find((r) => r.id === go.id)).toMatchObject({ userHas: true, note: "side projects in Go" });
    expect(previous).toHaveLength(1);
    expect((await db.select().from(applications).where(eq(applications.id, applicationId)))[0].status).toBe("preparing");
    await expect(saveReview(matched.id, { answers: [] }, db)).rejects.toThrow(/not waiting for review/);
  });

  it("does not move a job that is past Saved, and turns the review off for good when asked", async () => {
    const { applicationId, matched } = await reviewed();
    await db.update(applications).set({ status: "applied" }).where(eq(applications.id, applicationId));
    expect((await saveReview(matched.id, { answers: [], skipReviewNextTime: true }, db)).previous).toEqual([]);
    expect((await db.select().from(applications).where(eq(applications.id, applicationId)))[0].status).toBe("applied");
    const { jobId } = await seedJob2();
    expect((await startGeneration(jobId, {}, db)).generation.skipReview).toBe(true);
  });

  it("writes the resume into a new Library document linked to the job, with where each bullet came from", async () => {
    const { jobId, matched } = await reviewed();
    await saveReview(matched.id, { answers: [] }, db);
    const done = (await runNext())!;
    expect(done).toMatchObject({ status: "done", error: null });
    expect(Object.keys(done.bulletFacts)).toHaveLength(3);
    expect(Object.values(done.bulletFacts)).toContainEqual(["fact1"]);

    const doc = (await findJobResume(jobId, db))!;
    expect(doc).toMatchObject({ id: done.documentId, kind: "resume", origin: "generated", jobId, title: "Resume for Product Manager at Stripe", targetRole: "Product Manager", isBase: false });
    expect(doc.jdText).toBe("Posting text");
    const [v] = await db.select().from(documentVersions).where(eq(documentVersions.documentId, doc.id));
    expect(v).toMatchObject({ version: 1, reason: "generated" });
    expect(v.plainText).toContain("Launched self-serve billing for 2,000 merchants");
    expect(v.plainText).toContain("Sam Example");
    expect(done.steps.save).toMatchObject({ status: "done" });
  });

  it("passes the user's answers, the plan and the instructions to the writer", async () => {
    const seen = vi.fn<Writer>(async (...args) => writer(...args));
    const { matched } = await reviewed();
    const go = matched.requirements.find((r) => r.text === "Familiarity with Go")!;
    await saveReview(matched.id, { answers: [{ id: go.id, userHas: true, note: "side projects" }] }, db);
    await runNext({ writer: seen });
    const [plan, , requirements] = seen.mock.calls[0];
    expect(plan.users).toMatchObject([{ text: "Familiarity with Go", note: "side projects" }]);
    expect(requirements.find((r) => r.id === go.id)?.userHas).toBe(true);
  });

  it("writes again into the same document as its next version, keeping unsaved edits as a version", async () => {
    const { jobId, matched } = await reviewed();
    await saveReview(matched.id, { answers: [] }, db);
    const first = (await runNext())!;
    await db.execute(sql`UPDATE document_drafts SET content = content || '{"extra": true}'::jsonb, content_sha256 = 'edited' WHERE document_id = ${first.documentId}`);

    await startGeneration(jobId, { regenerate: true }, db);
    const second = (await runNext())!;
    await saveReview(second.id, { answers: [] }, db);
    const again = (await runNext())!;
    expect(again.documentId).toBe(first.documentId);
    const versions = await db.select().from(documentVersions).where(eq(documentVersions.documentId, first.documentId!)).orderBy(documentVersions.version);
    expect(versions.map((v) => [v.version, v.reason])).toEqual([[1, "generated"], [2, "manual"], [3, "generated"]]);
    expect(await db.select().from(documents)).toHaveLength(1);
    // What the user said they have last time is still said.
    expect(second.requirements.every((r) => !r.userHas)).toBe(true);
  });

  it("leaves a version that was sent alone when it is written again", async () => {
    const { jobId, applicationId, matched } = await reviewed();
    await saveReview(matched.id, { answers: [] }, db);
    const first = (await runNext())!;
    await changeStatus(applicationId, "applied", {}, db);

    await startGeneration(jobId, { regenerate: true }, db);
    await saveReview((await runNext())!.id, { answers: [] }, db);
    await runNext();
    const versions = await db.select().from(documentVersions).where(eq(documentVersions.documentId, first.documentId!)).orderBy(documentVersions.version);
    expect(versions[0].lockedAt).not.toBeNull();
    const newest = versions[versions.length - 1];
    expect(newest).toMatchObject({ reason: "generated", lockedAt: null });
    expect(versions.length).toBeGreaterThanOrEqual(2);
  });

  it("becomes the resume a new email for the job starts with, instead of the base resume", async () => {
    const base = await createDocument({ kind: "resume", origin: "uploaded", title: "Base", isBase: true, content: profileToDoc(profileWith([{ company: "Initech", title: "Developer", bullets: ["Wrote reports"] }]), counter("q")) }, db);
    const { jobId, matched } = await reviewed();
    expect(await defaultDocumentId(jobId, db)).toBe(base.document.id);
    await saveReview(matched.id, { answers: [] }, db);
    const done = (await runNext())!;
    expect(await defaultDocumentId(jobId, db)).toBe(done.documentId);
    expect(await defaultDocumentId((await seedJob2()).jobId, db)).toBe(base.document.id);
  });

  it("goes from writing to saving with no page fitting step", async () => {
    const { matched } = await reviewed();
    await saveReview(matched.id, { answers: [] }, db);
    const done = (await runNext())!;
    expect(done.status).toBe("done");
    expect(Object.keys(done.steps).sort()).toEqual(["match", "read", "save", "write"]);
    expect(done.notes.join(" ")).not.toMatch(/page/i);
  });

  it("records when each step started and how long it took, writing's stages as the writer reports them", async () => {
    const { matched } = await reviewed();
    expect(matched.steps.match).toMatchObject({ status: "done", startedAt: expect.any(String), ms: expect.any(Number) });
    await saveReview(matched.id, { answers: [] }, db);
    const staged: Writer = async (plan, _job, _reqs, _instructions, onStage) => {
      await onStage?.("write", "done");
      await onStage?.("review", "running");
      await onStage?.("review", "done", "4.2 of 5");
      await onStage?.("revise", "skipped", "nothing needed");
      return { written: readWriting(answer(), plan), notes: [] };
    };
    const done = (await runNext({ writer: staged }))!;
    for (const name of ["read", "match", "write", "review", "save"] as const) {
      expect(done.steps[name]).toMatchObject({ status: "done", ms: expect.any(Number) });
    }
    expect(done.steps.review?.detail).toBe("4.2 of 5");
    // A step that never ran has no time.
    expect(done.steps.revise).toEqual({ status: "skipped", detail: "nothing needed" });
  });

  it("fails with the reason when the writing model fails", async () => {
    const { matched } = await reviewed();
    await saveReview(matched.id, { answers: [] }, db);
    const row = await runNext({ writer: makeWriter(vi.fn().mockRejectedValue(new Error("boom")) as never) });
    expect(row).toMatchObject({ status: "failed", error: "Could not write the resume with the model: boom" });
    expect(await db.select().from(documents)).toHaveLength(0);
    // The step it failed in keeps the time it ran.
    expect(row!.steps.write).toMatchObject({ status: "failed", ms: expect.any(Number) });
  });
});

async function seedJob2() {
  const r = await saveJob(draft({ title: "Another role", sourceUrl: "https://boards.greenhouse.io/x/jobs/2", atsJobId: "2" }), db);
  if (!r.ok) throw new Error("seed failed");
  return { jobId: r.jobId };
}

describe("stopping, sweeping and the sidebar", () => {
  it("stops an open generation, and starts a fresh one afterwards", async () => {
    const { jobId } = await seedJob();
    const { generation } = await startGeneration(jobId, {}, db);
    expect((await stopGeneration(generation.id, db))?.status).toBe("stopped");
    expect(await stopGeneration(generation.id, db)).toBeNull();
    expect((await startGeneration(jobId, {}, db)).generation.id).not.toBe(generation.id);
  });

  it("records nothing for a phase that was stopped while it ran", async () => {
    const { jobId } = await seedJob();
    await seedRecord();
    const { generation } = await startGeneration(jobId, {}, db);
    const claimed = (await claimNextGeneration(db))!;
    const slow: Matcher = async () => {
      await stopGeneration(generation.id, db);
      return new Map();
    };
    await processGeneration(claimed.id, { db, matcher: slow });
    const [row] = await db.select().from(resumeGenerations).where(eq(resumeGenerations.id, generation.id));
    expect(row).toMatchObject({ status: "stopped", requirements: [] });
  });

  it("claims one waiting to be written before one waiting to be matched, one at a time", async () => {
    const a = await seedJob();
    const b = await seedJob2();
    const first = (await startGeneration(a.jobId, {}, db)).generation;
    const second = (await startGeneration(b.jobId, {}, db)).generation;
    await db.update(resumeGenerations).set({ status: "writing_queued" }).where(eq(resumeGenerations.id, second.id));
    expect(await claimNextGeneration(db)).toEqual({ id: second.id, status: "writing" });
    expect(await claimNextGeneration(db)).toEqual({ id: first.id, status: "matching" });
    expect(await claimNextGeneration(db)).toBeNull();
  });

  it("puts abandoned runs back where they waited, and fails them after too many tries", async () => {
    const { jobId } = await seedJob();
    await startGeneration(jobId, {}, db);
    await claimNextGeneration(db);
    await db.execute(sql`UPDATE resume_generations SET updated_at = now() - interval '10 minutes'`);
    expect(await sweepStaleGenerations(db)).toBe(1);
    expect((await db.select().from(resumeGenerations))[0].status).toBe("queued");

    await db.execute(sql`UPDATE resume_generations SET status = 'writing', attempts = 3`);
    expect(await recoverInterruptedGenerations(db)).toBe(1);
    expect((await db.select().from(resumeGenerations))[0]).toMatchObject({ status: "failed", error: expect.stringContaining("too many times") });
  });

  it("lists what is in progress and what just ended, with the job each is for", async () => {
    const a = await seedJob();
    const b = await seedJob2();
    const open = (await startGeneration(a.jobId, {}, db)).generation;
    const ended = (await startGeneration(b.jobId, {}, db)).generation;
    await db.update(resumeGenerations).set({ status: "done", finishedAt: new Date() }).where(eq(resumeGenerations.id, ended.id));
    expect((await listActiveGenerations(db)).map((g) => [g.id, g.status, g.jobLabel]).sort()).toEqual(
      [[open.id, "queued", "Product Manager at Stripe"], [ended.id, "done", "Another role at Stripe"]].sort(),
    );
    await db.execute(sql`UPDATE resume_generations SET finished_at = now() - interval '5 minutes' WHERE status = 'done'`);
    expect((await listActiveGenerations(db)).map((g) => g.id)).toEqual([open.id]);
  });

  it("reports the job's state: its latest generation, its resume and its documents", async () => {
    const { jobId } = await seedJob();
    expect(await getJobResumeState(jobId, db)).toEqual({ generation: null, documentId: null, documents: [] });
    await seedRecord();
    await startGeneration(jobId, {}, db);
    const matched = (await runNext())!;
    await saveReview(matched.id, { answers: [] }, db);
    const done = (await runNext())!;
    const state = await getJobResumeState(jobId, db);
    expect(state.generation).toMatchObject({ id: done.id, status: "done", documentId: done.documentId });
    expect(state.documentId).toBe(done.documentId);
    expect(state.documents).toMatchObject([{ id: done.documentId, kind: "resume", origin: "generated", version: 1, locked: false }]);
  });
});

describe("the worker", () => {
  it("marks a phase failed when it takes too long, and records nothing when it was stopped", async () => {
    const { jobId } = await seedJob();
    const { generation } = await startGeneration(jobId, {}, db);
    const claimed = (await claimNextGeneration(db))!;
    await processGenerationJob(claimed.id, { db, timeoutMs: 20, run: () => new Promise(() => {}) });
    expect((await db.select().from(resumeGenerations).where(eq(resumeGenerations.id, generation.id)))[0]).toMatchObject({ status: "failed", error: "Timed out after 15 minutes" });

    const second = await startGeneration(jobId, {}, db);
    const claimedAgain = (await claimNextGeneration(db))!;
    const controller = new AbortController();
    const done = processGenerationJob(claimedAgain.id, { db, signal: controller.signal, run: () => new Promise(() => {}) });
    await stopGeneration(second.generation.id, db);
    controller.abort();
    await done;
    expect((await db.select().from(resumeGenerations).where(eq(resumeGenerations.id, second.generation.id)))[0].status).toBe("stopped");
  });
});

describe("choices on the review screen", () => {
  /** The sample record with one achievement told with different numbers in different documents. */
  const withClash = () => {
    const rec = sampleRecord();
    rec.employers[0].roles[0].facts.push(
      fact("fact9", [
        ["w9a", "Increased user activation by 45% by rebuilding onboarding"],
        ["w9b", "Increased user activation by 45%, cutting time-to-value"],
        ["w9c", "Boosted feature activation rate by 18%"],
      ]),
    );
    return rec;
  };
  async function matched(jobId?: string) {
    const id = jobId ?? (await seedJob()).jobId;
    await startGeneration(id, {}, db);
    return { jobId: id, row: (await runNext())! };
  }
  beforeEach(async () => {
    await saveRecordVersion({ record: withClash(), reason: "edit" }, db);
    await saveProfile({ profile: { ...emptyProfile(), contact: { name: "Sam Example", email: "sam@example.com", phone: "", location: "Remote", links: [] } } }, db);
  });

  it("offers the tellings of a role and the numbers the record disagrees on, with the recommended ones", async () => {
    const { row } = await matched();
    expect(row.reviewOptions.roles).toEqual([
      { roleId: "roleA", label: "Acme", framings: [{ id: "fEng", title: "Software Engineer" }, { id: "fPm", title: "Product Manager" }], recommended: "fPm" },
    ]);
    expect(row.reviewOptions.clashes).toMatchObject([{ factId: "fact9", where: "Acme", recommended: "w9a", reason: "2 of your 3 versions of this line say it this way." }]);
    // The recommended number is chosen from the start, so a resume written with the review off uses it too.
    expect(row.choices).toEqual({ framings: {}, wordings: { fact9: "w9a" } });
  });

  it("saves the user's picks, keeps only what was offered, and writes from them", async () => {
    const { row } = await matched();
    const { generation } = await saveReview(row.id, { answers: [], choices: { framings: { roleA: "fEng", roleZ: "fX" }, wordings: { fact9: "w9c", fact1: "w1" } } }, db);
    expect(generation.choices).toEqual({ framings: { roleA: "fEng" }, wordings: { fact9: "w9c" } });

    const seen = vi.fn<Writer>(async (...args) => writer(...args));
    await runNext({ writer: seen });
    const plan = seen.mock.calls[0][0];
    expect(plan.roles[0].title).toBe("Software Engineer");
    // The picked number leads, and the versions that give the other number are left out.
    expect(plan.roles[0].facts.find((f) => f.factId === "fact9")!.texts).toEqual(["Boosted feature activation rate by 18%"]);
  });

  it("carries a settled number to the next resume for any job, and a chosen telling to the same job", async () => {
    const first = await matched();
    await saveReview(first.row.id, { answers: [], choices: { framings: { roleA: "fEng" }, wordings: { fact9: "w9c" } } }, db);
    await runNext();

    const other = await matched((await seedJob2()).jobId);
    expect(other.row.choices).toEqual({ framings: {}, wordings: { fact9: "w9c" } });
    await stopGeneration(other.row.id, db);

    await startGeneration(first.jobId, { regenerate: true }, db);
    const again = (await runNext())!;
    expect(again.choices).toEqual({ framings: { roleA: "fEng" }, wordings: { fact9: "w9c" } });
  });
});
