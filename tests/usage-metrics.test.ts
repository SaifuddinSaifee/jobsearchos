import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { llmCalls } from "@/lib/db/schema";
import { getUsageMetrics, hasAnyCalls, parseRange } from "@/lib/usage/metrics";
import { resetDb, testDb } from "./helpers";

process.env.DATABASE_URL ??= "postgres://unused";
const db = testDb();

// 2026-10-14 12:00 UTC is 05:00 on Oct 14 in Los Angeles (UTC-7), so a 7-day window starts at local midnight Oct 8,
// which is 07:00 UTC.
const NOW = new Date("2026-10-14T12:00:00Z");
const LA = "America/Los_Angeles";

const base = { durationMs: 1000, status: "ok" as const, model: "zai-org/GLM-5.3-Flash", step: "extract-job" as const, action: "add-job" as const };

beforeEach(async () => {
  await resetDb(db);
  await db.insert(llmCalls).values([
    // Local Oct 7, 23:59: outside the window in Los Angeles, inside it in UTC.
    { ...base, createdAt: new Date("2026-10-08T06:59:00Z"), promptTokens: 10, completionTokens: 10, costUsd: 5 },
    // Local Oct 8, 00:01: the first minute of the window.
    { ...base, createdAt: new Date("2026-10-08T07:01:00Z"), runId: "00000000-0000-4000-8000-000000000001", promptTokens: 1000, cachedTokens: 400, completionTokens: 500, reasoningTokens: 100, costUsd: 0.000352 },
    { ...base, createdAt: new Date("2026-10-08T15:00:00Z"), runId: "00000000-0000-4000-8000-000000000001", step: "research-company", durationMs: 3000, promptTokens: 100, completionTokens: 50, costUsd: 0.0001 },
    // Local Oct 13, 20:00, which is already Oct 14 in UTC.
    { ...base, createdAt: new Date("2026-10-14T03:00:00Z"), runId: "00000000-0000-4000-8000-000000000002", action: "find-contacts", step: "rank-contacts", status: "error", error: "bad json", durationMs: 500 },
    // Local Oct 14: an unpriced model, then a stopped call.
    { ...base, createdAt: new Date("2026-10-14T11:00:00Z"), runId: "00000000-0000-4000-8000-000000000003", action: "index-resume", step: "parse-resume", model: "someone/unknown", durationMs: 2000, promptTokens: 200, completionTokens: 50 },
    { ...base, createdAt: new Date("2026-10-14T11:30:00Z"), runId: "00000000-0000-4000-8000-000000000004", action: "read-career-source", step: "group-bullets", status: "stopped", error: "Stopped", durationMs: 100 },
  ]);
});
afterAll(() => db.$client.end());

describe("getUsageMetrics", () => {
  it("counts only what is inside the window, which starts at local midnight", async () => {
    const m = await getUsageMetrics("7d", { db, now: NOW, timeZone: LA });
    expect(m.totals.calls).toBe(5);
    expect(m.totals.errors).toBe(1);
    expect(m.totals.stopped).toBe(1);
    expect(m.totals.runs).toBe(4);
  });

  it("starts the window at UTC midnight when asked for UTC", async () => {
    const m = await getUsageMetrics("7d", { db, now: NOW, timeZone: "UTC" });
    expect(m.totals.calls).toBe(6);
  });

  it("sums cost and tokens, and counts unpriced calls separately", async () => {
    const { totals } = await getUsageMetrics("7d", { db, now: NOW, timeZone: LA });
    expect(totals.costUsd).toBeCloseTo(0.000452, 9);
    expect(totals.promptTokens).toBe(1300);
    expect(totals.cachedTokens).toBe(400);
    expect(totals.completionTokens).toBe(600);
    expect(totals.reasoningTokens).toBe(100);
    // Only the unknown model reported tokens without a price: the error and the stopped call reported none.
    expect(totals.unpricedCalls).toBe(1);
  });

  it("works out latency from the calls that succeeded", async () => {
    const { totals } = await getUsageMetrics("7d", { db, now: NOW, timeZone: LA });
    // Successful durations are 1000, 2000 and 3000.
    expect(totals.p50Ms).toBe(2000);
    expect(totals.p95Ms).toBeCloseTo(2900, 6);
  });

  it("keeps spend over all time, whatever the range", async () => {
    const m = await getUsageMetrics("7d", { db, now: NOW, timeZone: LA });
    expect(m.allTimeCostUsd).toBeCloseTo(5.000452, 9);
  });

  it("gives every local day in the range, filling the empty ones", async () => {
    const { byDay } = await getUsageMetrics("7d", { db, now: NOW, timeZone: LA });
    expect(byDay.map((d) => d.date)).toEqual(["2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14"]);
    expect(byDay[0]).toMatchObject({ calls: 2, errors: 0 });
    expect(byDay[0].costUsd).toBeCloseTo(0.000452, 9);
    expect(byDay[1]).toEqual({ date: "2026-10-09", costUsd: 0, calls: 0, errors: 0 });
    // 03:00 UTC on Oct 14 is still Oct 13 in Los Angeles.
    expect(byDay[5]).toMatchObject({ date: "2026-10-13", calls: 1, errors: 1 });
    expect(byDay[6]).toMatchObject({ date: "2026-10-14", calls: 2 });
  });

  it("covers the whole range even when it is empty at the start", async () => {
    const { byDay } = await getUsageMetrics("30d", { db, now: NOW, timeZone: LA });
    expect(byDay).toHaveLength(30);
    expect(byDay[0].date).toBe("2026-09-15");
  });

  it("rolls up by action with the number of runs, most expensive first", async () => {
    const { byAction } = await getUsageMetrics("7d", { db, now: NOW, timeZone: LA });
    expect(byAction[0]).toMatchObject({ key: "add-job", calls: 2, runs: 1 });
    expect(byAction.map((r) => r.key).sort()).toEqual(["add-job", "find-contacts", "index-resume", "read-career-source"]);
    expect(byAction.find((r) => r.key === "find-contacts")).toMatchObject({ calls: 1, errors: 1 });
  });

  it("rolls up by step and by model", async () => {
    const m = await getUsageMetrics("7d", { db, now: NOW, timeZone: LA });
    expect(m.byStep.find((r) => r.key === "research-company")).toMatchObject({ calls: 1, avgMs: 3000, p95Ms: 3000 });
    expect(m.byModel.map((r) => r.key).sort()).toEqual(["someone/unknown", "zai-org/GLM-5.3-Flash"]);
  });

  it("lists failures newest first and leaves out stopped calls", async () => {
    const { errors } = await getUsageMetrics("7d", { db, now: NOW, timeZone: LA });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ step: "rank-contacts", error: "bad json", status: "error" });
    expect(typeof errors[0].createdAt).toBe("string");
  });

  it("lists recent calls newest first", async () => {
    const { recent } = await getUsageMetrics("7d", { db, now: NOW, timeZone: LA });
    expect(recent.map((r) => r.step)).toEqual(["group-bullets", "parse-resume", "rank-contacts", "research-company", "extract-job"]);
  });

  it("returns zeros, not nulls, when there are no calls", async () => {
    await resetDb(db);
    const m = await getUsageMetrics("30d", { db, now: NOW, timeZone: LA });
    expect(m.totals).toMatchObject({ calls: 0, errors: 0, costUsd: 0, p50Ms: 0, p95Ms: 0, runs: 0, unpricedCalls: 0 });
    expect(m.allTimeCostUsd).toBe(0);
    expect(m.byAction).toEqual([]);
    expect(m.byDay).toHaveLength(30);
  });
});

describe("hasAnyCalls and parseRange", () => {
  it("tells an empty table from a populated one", async () => {
    expect(await hasAnyCalls(db)).toBe(true);
    await resetDb(db);
    expect(await hasAnyCalls(db)).toBe(false);
  });

  it("falls back to 30 days for anything it does not know", () => {
    expect(parseRange("7d")).toBe("7d");
    expect(parseRange("90d")).toBe("90d");
    expect(parseRange("1y")).toBe("30d");
    expect(parseRange(undefined)).toBe("30d");
  });
});
