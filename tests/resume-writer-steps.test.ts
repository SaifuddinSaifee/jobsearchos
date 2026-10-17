import { describe, expect, it, vi } from "vitest";

process.env.DATABASE_URL ??= "postgres://unused";
vi.mock("@/lib/llm/openai", () => ({ chatClient: () => ({}) }));

import { endRunning, endStep, formatDuration, startStep, stepMs, stepsMs } from "@/lib/resume-writer/types";
import { planWriting, type WriterAnswer } from "@/lib/resume-writer/write";
import { makeWriter } from "@/lib/resume-writer/writer";
import type { Review } from "@/lib/resume-writer/review";
import { job, record, withMap } from "./resume-writer-helpers";

const at = (s: number) => new Date(Date.UTC(2026, 9, 16, 8, 0, s));

describe("step times", () => {
  it("records when a step started and how long it ran", () => {
    const started = startStep(at(0));
    expect(started).toEqual({ status: "running", startedAt: at(0).toISOString() });
    expect(endStep(started, "done", "12 of 30", at(45))).toEqual({ status: "done", detail: "12 of 30", startedAt: at(0).toISOString(), ms: 45_000 });
    // A step that never started has no time.
    expect(endStep(undefined, "skipped", "nothing needed", at(45))).toEqual({ status: "skipped", detail: "nothing needed" });
  });

  it("counts a running step up to now, and adds the steps into a total", () => {
    const steps = { read: endStep(startStep(at(0)), "done", undefined, at(2)), match: endStep(startStep(at(2)), "done", undefined, at(50)), write: startStep(at(60)) };
    expect(stepMs(steps.write, at(90).getTime())).toBe(30_000);
    expect(stepMs(undefined, at(90).getTime())).toBeNull();
    // The wait for the user's review (50s to 60s) is not counted.
    expect(stepsMs(steps, at(90).getTime())).toBe(80_000);
    // An older run with no times shows none.
    expect(stepMs({ status: "done" }, at(90).getTime())).toBeNull();
  });

  it("ends the step a failed run was in", () => {
    const steps = endRunning({ read: endStep(startStep(at(0)), "done", undefined, at(1)), match: startStep(at(1)) }, "failed", at(31));
    expect(steps.match).toMatchObject({ status: "failed", ms: 30_000 });
    expect(steps.read).toMatchObject({ status: "done", ms: 1000 });
  });

  it("reads as seconds, minutes and hours", () => {
    expect(formatDuration(8_400)).toBe("8s");
    expect(formatDuration(65_000)).toBe("1m 05s");
    expect(formatDuration(3_725_000)).toBe("1h 02m");
  });
});

describe("the writer's stages", () => {
  const plan = planWriting(record(), job, withMap([{ verdict: "met", refs: ["fact1"] }]));
  const answer: WriterAnswer = {
    summary: "Product manager who shipped billing.",
    roles: [{ role: "e1", bullets: [{ facts: ["f1"], text: "Launched self-serve billing for 2,000 merchants" }] }],
    projects: plan.projects.slice(0, 1).map((p) => ({ project: p.alias, bullets: [{ text: p.description }] })),
    certifications: [],
  };
  const review = (edits: Review["edits"]): Review => ({ scores: [{ criterion: "faithful", score: 4, note: "" }], edits, verdict: edits.length ? "revise" : "ready" });

  it("reports the draft, the review with its score, and the revision as each starts and ends", async () => {
    const stages: string[] = [];
    const edit = { target: "b1", criterion: "faithful", problem: "p", instruction: "i" };
    await makeWriter(vi.fn(async () => answer) as never, async () => review([edit]))(plan, job, [], null, (stage, status, detail) => {
      stages.push([stage, status, detail].filter(Boolean).join(" "));
    });
    expect(stages).toEqual(["write done", "review running", "review done 4.0 of 5", "revise running", "revise done 1 change asked for"]);
  });

  it("reports a revision that was not needed as skipped, and a review that failed as failed", async () => {
    const stages: string[] = [];
    await makeWriter(vi.fn(async () => answer) as never, async () => {
      throw new Error("down");
    })(plan, job, [], null, (stage, status) => {
      stages.push(`${stage} ${status}`);
    });
    expect(stages).toEqual(["write done", "review running", "review failed", "revise skipped"]);
  });
});
