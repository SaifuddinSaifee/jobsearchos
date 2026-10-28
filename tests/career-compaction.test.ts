import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

process.env.DATABASE_URL ??= "postgres://unused";
vi.mock("@/lib/llm/openai", () => ({ chatClient: () => ({}) }));

import { resetDb, testDb } from "./helpers";
import { counter, employer, fact, recordWith, role } from "./career-helpers";
import {
  applyCompaction,
  claimNextCompaction,
  dismissCompaction,
  getOpenCompaction,
  processCompaction,
  saveCompactionAnswers,
  startCompaction,
  sweepStaleCompactions,
} from "@/lib/career/compaction";
import { readDescription, type Describer } from "@/lib/career/describe";
import { ProposalError } from "@/lib/career/review";
import { currentRecord, getLatestRecord, saveRecordVersion } from "@/lib/career/service";
import { careerCompactions } from "@/lib/db/schema";

const db = testDb();
beforeEach(() => resetDb(db));
afterAll(() => db.$client.end());

const describe_: Describer = async (facts) =>
  new Map(facts.map((f) => [f.key, readDescription({ statement: f.wordings[0], details: [...f.wordings.join(" ").matchAll(/\d+%/g)].map((m) => ({ kind: "metric" as const, text: m[0], measures: "build time" })) }, f.wordings)]));
const deps = { db, cluster: async () => [["f1", "f2"]], describe: describe_, newId: counter("x") };

async function seed() {
  const record = recordWith(employer("Acme", [role({ facts: [fact("f1", [["w1", "Cut build times by 40%"]]), fact("f2", [["w2", "Cut build times by 60% with caching"]])] })]));
  await saveRecordVersion({ record, reason: "merge" }, db);
}

async function prepared() {
  await seed();
  const { id } = await startCompaction(db);
  expect(await claimNextCompaction(db)).toBe(id);
  await processCompaction(id, deps);
  return id;
}

describe("tidying the record", () => {
  it("keeps one open at a time", async () => {
    const a = await startCompaction(db);
    const b = await startCompaction(db);
    expect(a.started).toBe(true);
    expect(b).toEqual({ id: a.id, started: false });
    expect(await getOpenCompaction(db)).toMatchObject({ id: a.id, status: "queued" });
  });

  it("works it out for review, then saves it as a new version", async () => {
    const id = await prepared();
    const open = await getOpenCompaction(db);
    expect(open).toMatchObject({ id, status: "ready" });
    if (open?.status !== "ready") throw new Error("not ready");
    expect(open.result.roles[0]).toMatchObject({ factsBefore: 2, factsAfter: 1 });
    const q = open.result.questions[0];
    expect(q.options.map((o) => o.text)).toEqual(["40%", "60%"]);

    await saveCompactionAnswers(id, { [q.id]: q.options[1].detailId }, db);
    const { version } = await applyCompaction(id, db);
    expect(version).toBe(2);
    const latest = await getLatestRecord(db);
    expect(latest?.reason).toBe("compact");
    expect(latest?.changeNote).toBe("Tidied the record: 2 facts became 1");
    const f = latest!.record.employers[0].roles[0].facts[0];
    expect(f.details.map((d) => d.text)).toEqual(["60%"]);
    expect(f.wordings.map((w) => w.text)).toEqual(["Cut build times by 60% with caching"]);
    const [row] = await db.select().from(careerCompactions).where(eq(careerCompactions.id, id));
    expect(row.status).toBe("applied");
    expect(row.appliedVersionId).toBe(latest!.id);
  });

  it("is worked out again when the record changed before it was applied", async () => {
    const id = await prepared();
    const { record } = await currentRecord(db);
    await saveRecordVersion({ record, reason: "edit" }, db);
    await expect(applyCompaction(id, db)).rejects.toThrow(ProposalError);
    expect(await getOpenCompaction(db)).toMatchObject({ id, status: "queued" });
  });

  it("leaves a role as it is when its model step fails, and still finishes", async () => {
    await seed();
    const { id } = await startCompaction(db);
    await claimNextCompaction(db);
    await processCompaction(id, { ...deps, cluster: async () => Promise.reject(new Error("model down")), describe: async () => Promise.reject(new Error("model down")) });
    const open = await getOpenCompaction(db);
    if (open?.status !== "ready") throw new Error("not ready");
    expect(open.result.roles[0]).toMatchObject({ factsBefore: 2, factsAfter: 2 });
    expect(open.result.unwritten.map((u) => u.findings)).toEqual([["The model could not be reached for this role."], ["The model could not be reached for this role."]]);
  });

  it("records a failure when it is stopped, and can be dismissed", async () => {
    await seed();
    const { id } = await startCompaction(db);
    await claimNextCompaction(db);
    await processCompaction(id, { ...deps, cluster: async () => Promise.reject(new Error("Stopped")) });
    expect(await getOpenCompaction(db)).toEqual({ id, status: "failed", error: "Stopped" });
    await dismissCompaction(id, db);
    expect(await getOpenCompaction(db)).toBeNull();
  });

  it("puts one cut off by a restart back in the queue", async () => {
    const { id } = await startCompaction(db);
    await claimNextCompaction(db);
    expect(await sweepStaleCompactions(db, { all: true })).toBe(1);
    expect(await getOpenCompaction(db)).toMatchObject({ id, status: "queued" });
  });
});
