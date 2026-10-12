import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { applications, statusEvents } from "@/lib/db/schema";
import { emptyExtraction, type JobDraft } from "@/lib/jobs/schema";
import { saveJob } from "@/lib/jobs/service";
import {
  changeStatus,
  changeStatusBulk,
  dashboardData,
  exportRows,
  getJobDetail,
  listJobRows,
  revertStatus,
  saveNotes,
  setAppliedAt,
} from "@/lib/jobs/tracker";
import { jobsToCsv } from "@/lib/jobs/export";
import { resetDb, testDb } from "./helpers";

process.env.DATABASE_URL ??= "postgres://unused";
vi.mock("@/lib/llm/client", () => ({ together: () => ({}) }));

const db = testDb();
beforeEach(() => resetDb(db));
afterAll(() => db.$client.end());

function draft(n: number, over: Partial<JobDraft> = {}): JobDraft {
  const e = {
    ...emptyExtraction(),
    company: `Co${n}`,
    title: `Engineer ${n}`,
    location: "Austin, TX",
    technologies: ["Go"],
    keywords: ["go"],
    salaryMin: 100000,
    salaryMax: 150000,
    salaryCurrency: "USD",
    salaryPeriod: "year",
  };
  return {
    ...e,
    sourceUrl: `https://boards.greenhouse.io/co${n}/jobs/${n}`,
    fetchMethod: "greenhouse",
    ats: "greenhouse",
    atsJobId: String(n),
    rawFileId: null,
    rawText: "raw",
    normalized: e,
    ...over,
  };
}

async function seed(n = 1) {
  const out: { jobId: string; applicationId: string }[] = [];
  for (let i = 1; i <= n; i++) {
    const r = await saveJob(draft(i), db);
    if (!r.ok) throw new Error("seed failed");
    out.push({ jobId: r.jobId, applicationId: r.applicationId });
  }
  return out;
}

const events = (applicationId: string) =>
  db.select().from(statusEvents).where(eq(statusEvents.applicationId, applicationId)).orderBy(statusEvents.at);
const app = async (id: string) => (await db.select().from(applications).where(eq(applications.id, id)))[0];

describe("changeStatus", () => {
  it("updates the status and writes an event", async () => {
    const [a] = await seed();
    const res = await changeStatus(a.applicationId, "preparing", {}, db);
    expect(res.previous).toMatchObject([{ status: "saved", expected: "preparing" }]);
    expect((await app(a.applicationId)).status).toBe("preparing");
    const ev = await events(a.applicationId);
    expect(ev.map((e) => [e.fromStatus, e.toStatus])).toEqual([[null, "saved"], ["saved", "preparing"]]);
  });

  it("sets applied_at on the first Applied (given date) and keeps it afterwards", async () => {
    const [a] = await seed();
    await changeStatus(a.applicationId, "applied", { appliedDate: "2026-03-09" }, db);
    expect((await app(a.applicationId)).appliedAt?.toISOString()).toBe("2026-03-09T12:00:00.000Z");
    await changeStatus(a.applicationId, "interview", {}, db);
    await changeStatus(a.applicationId, "applied", { appliedDate: "2026-04-01" }, db);
    expect((await app(a.applicationId)).appliedAt?.toISOString()).toBe("2026-03-09T12:00:00.000Z");
  });

  it("defaults the applied date to now", async () => {
    const [a] = await seed();
    await changeStatus(a.applicationId, "applied", {}, db);
    const at = (await app(a.applicationId)).appliedAt!;
    expect(Math.abs(Date.now() - at.getTime())).toBeLessThan(10_000);
  });

  it("is a no-op for the same status", async () => {
    const [a] = await seed();
    const res = await changeStatus(a.applicationId, "saved", {}, db);
    expect(res.previous).toEqual([]);
    expect(await events(a.applicationId)).toHaveLength(1);
  });

  it("rejects an unknown application", async () => {
    await expect(changeStatus("00000000-0000-4000-8000-000000000000", "applied", {}, db)).rejects.toThrow(/not found/);
  });
});

describe("changeStatusBulk", () => {
  it("changes many, dedupes ids, skips rows already in that status", async () => {
    const jobs = await seed(3);
    await changeStatus(jobs[2].applicationId, "rejected", {}, db);
    const ids = [jobs[0].applicationId, jobs[1].applicationId, jobs[0].applicationId, jobs[2].applicationId];
    const res = await changeStatusBulk(ids, "rejected", {}, db);
    expect(res.previous.map((p) => p.applicationId).sort()).toEqual([jobs[0].applicationId, jobs[1].applicationId].sort());
    for (const j of jobs) expect((await app(j.applicationId)).status).toBe("rejected");
  });

  it("is atomic: one unknown id rolls back all", async () => {
    const jobs = await seed(2);
    await expect(
      changeStatusBulk([jobs[0].applicationId, "00000000-0000-4000-8000-000000000000"], "applied", {}, db),
    ).rejects.toThrow();
    expect((await app(jobs[0].applicationId)).status).toBe("saved");
    expect(await events(jobs[0].applicationId)).toHaveLength(1);
  });

  it("caps the batch size", async () => {
    const ids = Array.from({ length: 501 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    await expect(changeStatusBulk(ids, "applied", {}, db)).rejects.toThrow(/at most/);
  });
});

describe("revertStatus", () => {
  it("restores the status and clears an applied date the change set", async () => {
    const [a] = await seed();
    const { previous } = await changeStatus(a.applicationId, "applied", { appliedDate: "2026-03-09" }, db);
    const res = await revertStatus(previous, db);
    expect(res).toEqual({ reverted: 1, skipped: [] });
    const row = await app(a.applicationId);
    expect(row.status).toBe("saved");
    expect(row.appliedAt).toBeNull();
    const ev = await events(a.applicationId);
    expect(ev.at(-1)).toMatchObject({ fromStatus: "applied", toStatus: "saved", note: "Undo" });
  });

  it("keeps an earlier applied date when undoing a later move", async () => {
    const [a] = await seed();
    await changeStatus(a.applicationId, "applied", { appliedDate: "2026-03-09" }, db);
    const { previous } = await changeStatus(a.applicationId, "rejected", {}, db);
    await revertStatus(previous, db);
    const row = await app(a.applicationId);
    expect(row.status).toBe("applied");
    expect(row.appliedAt?.toISOString()).toBe("2026-03-09T12:00:00.000Z");
  });

  it("skips applications whose status changed again", async () => {
    const jobs = await seed(2);
    const { previous } = await changeStatusBulk(jobs.map((j) => j.applicationId), "applied", {}, db);
    await changeStatus(jobs[1].applicationId, "interview", {}, db);
    const res = await revertStatus(previous, db);
    expect(res.reverted).toBe(1);
    expect(res.skipped).toEqual([jobs[1].applicationId]);
    expect((await app(jobs[1].applicationId)).status).toBe("interview");
  });
});

describe("notes and applied date", () => {
  it("save without writing status events", async () => {
    const [a] = await seed();
    await saveNotes(a.applicationId, "Spoke to a recruiter", db);
    await setAppliedAt(a.applicationId, "2026-02-02", db);
    const row = await app(a.applicationId);
    expect(row.notes).toBe("Spoke to a recruiter");
    expect(row.appliedAt?.toISOString()).toBe("2026-02-02T12:00:00.000Z");
    expect(await events(a.applicationId)).toHaveLength(1);
  });

  it("rejects notes that are too long and unknown applications", async () => {
    const [a] = await seed();
    await expect(saveNotes(a.applicationId, "x".repeat(10_001), db)).rejects.toThrow(/at most/);
    await expect(saveNotes("00000000-0000-4000-8000-000000000000", "hi", db)).rejects.toThrow(/not found/);
  });
});

describe("listJobRows / getJobDetail", () => {
  it("returns table rows with source, links, notes flag and last change", async () => {
    const [a] = await seed();
    await saveNotes(a.applicationId, "note", db);
    const [row] = await listJobRows(db);
    expect(row).toMatchObject({
      company: "Co1",
      status: "saved",
      source: "greenhouse",
      postingUrl: "https://boards.greenhouse.io/co1/jobs/1",
      hasNotes: true,
      technologies: ["Go"],
    });
    expect(new Date(row.lastChangeAt).getTime()).toBeGreaterThan(0);
  });

  it("falls back to the snapshot's fetch method when there is no ATS", async () => {
    await saveJob(draft(1, { ats: null, atsJobId: null, fetchMethod: "playwright" }), db);
    expect((await listJobRows(db))[0].source).toBe("playwright");
  });

  it("returns the detail with a newest-first timeline and the snapshot", async () => {
    const [a] = await seed();
    await changeStatus(a.applicationId, "applied", {}, db);
    const d = (await getJobDetail(a.jobId, db))!;
    expect(d.timeline.map((e) => e.to)).toEqual(["applied", "saved"]);
    expect(d.keywords).toEqual(["go"]);
    expect(d.snapshot).toMatchObject({ fetchMethod: "greenhouse", rawText: "raw" });
    expect(d.notes).toBe("");
  });

  it("returns null for an unknown job", async () => {
    expect(await getJobDetail("00000000-0000-4000-8000-000000000000", db)).toBeNull();
  });

  it("never exposes a non-http apply link", async () => {
    const [a] = await seed();
    await db.execute(sql`UPDATE applications SET application_url = 'javascript:alert(1)' WHERE id = ${a.applicationId}`);
    await db.execute(sql`UPDATE jobs SET application_url = 'javascript:alert(1)' WHERE id = ${a.jobId}`);
    expect((await listJobRows(db))[0].applyUrl).toBeNull();
  });
});

describe("saveJob URL hardening", () => {
  it("drops a non-http applicationUrl and falls back to the canonical URL", async () => {
    const r = await saveJob(draft(1, { applicationUrl: "javascript:alert(1)" }), db);
    expect(r.ok).toBe(true);
    const [row] = await listJobRows(db);
    expect(row.applyUrl).toBe("https://boards.greenhouse.io/co1/jobs/1");
  });
});

describe("exportRows", () => {
  it("keeps the requested order and includes notes", async () => {
    const jobs = await seed(3);
    await saveNotes(jobs[1].applicationId, "=cmd, \"quoted\"", db);
    const order = [jobs[2].applicationId, jobs[0].applicationId, jobs[1].applicationId];
    const rows = await exportRows(order, db);
    expect(rows.map((r) => r.company)).toEqual(["Co3", "Co1", "Co2"]);
    const csv = jobsToCsv(rows);
    expect(csv).toContain('"\'=cmd, ""quoted"""');
    expect(csv.split("\r\n")[0]).toContain("Company,Title");
  });

  it("exports everything when ids is null and nothing for an empty list", async () => {
    await seed(2);
    expect(await exportRows(null, db)).toHaveLength(2);
    expect(await exportRows([], db)).toEqual([]);
  });
});

describe("dashboardData", () => {
  const backdate = (applicationId: string, days: number) =>
    db.execute(sql`UPDATE status_events SET at = now() - (${days} || ' days')::interval WHERE application_id = ${applicationId}`);

  it("counts the funnel by group", async () => {
    const jobs = await seed(4);
    await changeStatus(jobs[1].applicationId, "applied", {}, db);
    await changeStatus(jobs[2].applicationId, "technical_interview", {}, db);
    await changeStatus(jobs[3].applicationId, "ghosted", {}, db);
    const d = await dashboardData(db);
    expect(d.funnel).toEqual({ active: 1, applied: 1, interviews: 1, offers: 0, closed: 1 });
    expect(d.total).toBe(4);
    expect(d.recent.length).toBeGreaterThan(0);
  });

  it("flags Applied 7+ days and Preparing 3+ days since the last status change", async () => {
    const jobs = await seed(4);
    await changeStatus(jobs[0].applicationId, "applied", {}, db);
    await changeStatus(jobs[1].applicationId, "applied", {}, db);
    await changeStatus(jobs[2].applicationId, "preparing", {}, db);
    await changeStatus(jobs[3].applicationId, "preparing", {}, db);
    await backdate(jobs[0].applicationId, 8);
    await backdate(jobs[1].applicationId, 6);
    await backdate(jobs[2].applicationId, 4);
    await backdate(jobs[3].applicationId, 1);
    const d = await dashboardData(db);
    expect(d.needsAttention.map((i) => [i.title, i.status])).toEqual([
      ["Engineer 1", "applied"],
      ["Engineer 3", "preparing"],
    ]);
    expect(d.needsAttention[0].daysSince).toBeGreaterThanOrEqual(8);
  });

  it("does not reset the clock when notes are saved", async () => {
    const [a] = await seed();
    await changeStatus(a.applicationId, "applied", {}, db);
    await backdate(a.applicationId, 9);
    await saveNotes(a.applicationId, "touched", db);
    expect((await dashboardData(db)).needsAttention).toHaveLength(1);
  });
});
