import "./eval-resume-writer/test-db";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { llmCalls, type LlmCallRow } from "@/lib/db/schema";
import { docToMarkdown } from "@/lib/documents/convert/doc-to-markdown";
import { currentLlmContext, withLlmContext } from "@/lib/llm/context";
import { runLlmScript } from "@/lib/llm/script";
import { chatStructured } from "@/lib/llm/structured";
import { flushLlmCalls } from "@/lib/llm/usage";
import { buildResumeDoc } from "@/lib/resume-writer/build";
import { buildRequirements, indexSource } from "@/lib/resume-writer/context";
import { matchRequirements, modelMatcher } from "@/lib/resume-writer/match";
import { makeReviewer, meanScore } from "@/lib/resume-writer/review";
import { assumeQualified, type Requirement } from "@/lib/resume-writer/types";
import { planWriting } from "@/lib/resume-writer/write";
import { makeWriter, type RevisionMode, type WriterConfig, type WriterTrace } from "@/lib/resume-writer/writer";
import { CASES, type EvalCase } from "./eval-resume-writer/cases";

const USAGE = `Usage: npm run eval:writer -- [--configs A,B,C,D] [--revision always|targeted|both] [--cases id,id] [--matches <earlier run folder>] [--concurrency N] [--out <folder>] [--dev-db]

Writes a resume for each synthetic case (scripts/eval-resume-writer/cases.ts) with each writer and reviewer config,
and reports cost, time, tokens by stage, retries, the review and the code checks per run. Each case is matched once
(GLM-5.3 Flash) and every config writes from the same match; --matches reuses the match of an earlier run so two
runs compare like for like. The final resumes are saved under blind/ with the config hidden; key.json says which is
which. Usage records go to the test database unless --dev-db is passed. Nothing here changes the app's defaults.

Configs:
`;

const GLM = "zai-org/GLM-5.3";
const GLM_FLASH = "zai-org/GLM-5.3-Flash";
const KIMI = "moonshotai/Kimi-K3";
const DEEPSEEK = "deepseek-ai/DeepSeek-V4.1-Flash";

type Config = { name: string; writer: string; effort: WriterConfig["effort"]; reviewer: string };
const CONFIGS: Record<string, Config> = {
  A: { name: "A", writer: GLM, effort: "max", reviewer: KIMI },
  B: { name: "B", writer: GLM, effort: "max", reviewer: DEEPSEEK },
  C: { name: "C", writer: GLM, effort: "high", reviewer: DEEPSEEK },
  D: { name: "D", writer: GLM_FLASH, effort: "max", reviewer: DEEPSEEK },
};
const describe = (c: Config) => `${c.name}: ${c.writer} at ${c.effort} effort writes, ${c.reviewer} reviews`;

/** Asked when the config's reviewer still fails after its retries. GLM-5.3 does not think under a JSON schema, so it is asked by prompt. */
const FALLBACK_REVIEWER = { model: GLM, jsonMode: "prompt", reasoningEffort: "high" } as const;

type Args = { configs: Config[]; revisions: RevisionMode[]; cases: EvalCase[]; matches: string | null; concurrency: number; out: string };

function parseArgs(argv: string[]): Args {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const args: Args = { configs: Object.values(CONFIGS), revisions: ["always"], cases: CASES, matches: null, concurrency: 3, out: path.join("eval-runs", "resume-writer", stamp) };
  const usage = `${USAGE}${Object.values(CONFIGS).map(describe).join("\n")}`;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = argv[++i];
      if (!v) throw new Error(`${a} needs a value\n\n${usage}`);
      return v;
    };
    if (a === "--configs") {
      args.configs = value().split(",").map((n) => {
        const c = CONFIGS[n.trim().toUpperCase()];
        if (!c) throw new Error(`Unknown config "${n}"\n\n${usage}`);
        return c;
      });
    } else if (a === "--revision") {
      const v = value();
      if (v !== "always" && v !== "targeted" && v !== "both") throw new Error(`--revision must be always, targeted or both\n\n${usage}`);
      args.revisions = v === "both" ? ["always", "targeted"] : [v];
    } else if (a === "--cases") {
      const ids = value().split(",").map((s) => s.trim());
      args.cases = ids.map((id) => {
        const c = CASES.find((x) => x.id === id);
        if (!c) throw new Error(`Unknown case "${id}". Cases: ${CASES.map((x) => x.id).join(", ")}`);
        return c;
      });
    } else if (a === "--matches") args.matches = value();
    else if (a === "--concurrency") {
      args.concurrency = Number(value());
      if (!Number.isInteger(args.concurrency) || args.concurrency < 1) throw new Error(`--concurrency must be a whole number of at least 1\n\n${usage}`);
    } else if (a === "--out") args.out = value();
    else if (a === "--dev-db") continue;
    else if (a === "--help" || a === "-h") {
      console.log(usage);
      process.exit(0);
    } else throw new Error(`Unexpected argument "${a}"\n\n${usage}`);
  }
  return args;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** What the user would leave ticked on the review screen: the defaults, plus the case's own ticks with their notes. */
function reviewed(c: EvalCase, matched: Requirement[]): Requirement[] {
  return assumeQualified(matched).map((r) => {
    const tick = c.ticks.find((t) => t.match.test(r.text));
    return tick ? { ...r, userHas: true, note: tick.note ?? r.note } : r;
  });
}

type CaseMatch = { requirements: Requirement[]; ms: number; costUsd: number | null };

async function rowsOf(runId: string): Promise<LlmCallRow[]> {
  await flushLlmCalls();
  return db().select().from(llmCalls).where(eq(llmCalls.runId, runId)).orderBy(asc(llmCalls.createdAt));
}

/** Runs `fn` inside its own eval context, and returns its result with the usage rows it recorded. */
async function recorded<T>(metadata: Record<string, string>, fn: () => Promise<T>): Promise<{ value: T | null; error: string | null; rows: LlmCallRow[]; ms: number }> {
  let runId = "";
  const started = Date.now();
  let value: T | null = null;
  let error: string | null = null;
  try {
    value = await withLlmContext(
      "eval-resume-writer",
      {},
      () => {
        runId = currentLlmContext()?.runId ?? "";
        return fn();
      },
      { metadata },
    );
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  const ms = Date.now() - started;
  return { value, error, rows: runId ? await rowsOf(runId) : [], ms };
}

const sum = (xs: (number | null)[]) => xs.reduce<number>((n, x) => n + (x ?? 0), 0);

async function matchCase(c: EvalCase): Promise<CaseMatch> {
  const r = await recorded({ case: c.id, stage: "match" }, () => matchRequirements(buildRequirements(c.job), indexSource(c.record), modelMatcher));
  if (!r.value) throw new Error(`Matching failed for ${c.id}: ${r.error}`);
  return { requirements: reviewed(c, r.value), ms: r.ms, costUsd: sum(r.rows.map((x) => x.costUsd)) };
}

type StageUsage = { calls: number; failed: number; models: string[]; inputTokens: number; cachedInputTokens: number; outputTokens: number; reasoningTokens: number; latencyMs: number; retries: number; retryWaitMs: number; costUsd: number };

/** The usage rows of one run, summed by stage. A review row from the fallback model is its own stage. */
function byStage(rows: LlmCallRow[], reviewer: string): Record<string, StageUsage> {
  const out: Record<string, StageUsage> = {};
  for (const row of rows) {
    const stage = row.step === "review-resume" && row.model !== reviewer ? "review-fallback" : row.step;
    const s = (out[stage] ??= { calls: 0, failed: 0, models: [], inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0, latencyMs: 0, retries: 0, retryWaitMs: 0, costUsd: 0 });
    s.calls++;
    if (row.status !== "ok") s.failed++;
    if (!s.models.includes(row.model)) s.models.push(row.model);
    s.inputTokens += row.promptTokens ?? 0;
    s.cachedInputTokens += row.cachedTokens ?? 0;
    s.outputTokens += row.completionTokens ?? 0;
    s.reasoningTokens += row.reasoningTokens ?? 0;
    s.latencyMs += row.durationMs;
    s.retries += row.retryCount ?? 0;
    s.retryWaitMs += row.retryWaitMs ?? 0;
    s.costUsd += row.costUsd ?? 0;
  }
  return out;
}

type RunResult = {
  blindId: string;
  case: string;
  config: string;
  revision: RevisionMode;
  ok: boolean;
  error: string | null;
  wallMs: number;
  costUsd: number;
  stages: Record<string, StageUsage>;
  /** Retries: the client's own (per call), failed calls tried again by the writer, and the writer's waits before a review retry. */
  retries: { sdk: number; sdkWaitMs: number; failedCalls: number; reviewWaitsMs: number[] };
  review: { by: WriterTrace["reviewedBy"]; mean: number | null; verdict: string | null; edits: number; material: number; scores: Record<string, number>; errors: string[] };
  revision_: { outcome: WriterTrace["revision"] | null; targets: string[] };
  findings: { draft: Record<string, number>; final: Record<string, number>; reverted: number };
  disagreements: string[];
  flags: string[];
  notes: string[];
  calls: { step: string; model: string; status: string; effort: string | null; inputTokens: number | null; cachedInputTokens: number | null; outputTokens: number | null; reasoningTokens: number | null; latencyMs: number; retries: number | null; retryWaitMs: number | null; costUsd: number | null; error: string | null }[];
};

const countKinds = (findings: { kind: string }[]) => findings.reduce<Record<string, number>>((m, f) => ((m[f.kind] = (m[f.kind] ?? 0) + 1), m), {});

async function runOne(c: EvalCase, requirements: Requirement[], cfg: Config, revision: RevisionMode, out: string): Promise<RunResult> {
  const plan = planWriting(c.record, c.job, requirements, null);
  let trace: WriterTrace | null = null;
  const writer = makeWriter(chatStructured, makeReviewer(chatStructured, { model: cfg.reviewer }), sleep, {
    model: cfg.writer,
    effort: cfg.effort,
    revision,
    fallbackReviewer: makeReviewer(chatStructured, FALLBACK_REVIEWER),
    onTrace: (t) => (trace = t),
  });
  const r = await recorded({ case: c.id, config: cfg.name, revision }, () => writer(plan, c.job, requirements, null));
  const t = trace as WriterTrace | null;

  const blindId = randomBytes(3).toString("hex");
  if (r.value) {
    const markdown = docToMarkdown(buildResumeDoc(r.value.written, c.contact).doc);
    await mkdir(path.join(out, "blind", c.id), { recursive: true });
    await writeFile(path.join(out, "blind", c.id, `resume-${blindId}.md`), markdown);
  }

  const stages = byStage(r.rows, cfg.reviewer);
  const flags: string[] = [];
  if (r.error) flags.push(`run failed: ${r.error}`);
  if (t && t.reviewedBy !== "primary") flags.push(t.reviewedBy === "fallback" ? "reviewer failed; GLM-5.3 fallback reviewed" : "reviewer failed; no review");
  if (t && t.disagreements.length > 0) flags.push("reviewer disagrees with code checks");
  if (t?.revision === "failed") flags.push("revision failed");
  const review = t?.review ?? null;
  return {
    blindId,
    case: c.id,
    config: cfg.name,
    revision,
    ok: !!r.value,
    error: r.error,
    wallMs: r.ms,
    costUsd: sum(r.rows.map((x) => x.costUsd)),
    stages,
    retries: { sdk: sum(r.rows.map((x) => x.retryCount)), sdkWaitMs: sum(r.rows.map((x) => x.retryWaitMs)), failedCalls: r.rows.filter((x) => x.status !== "ok").length, reviewWaitsMs: t?.reviewWaitsMs ?? [] },
    review: {
      by: t?.reviewedBy ?? null,
      mean: review ? meanScore(review) : null,
      verdict: review?.verdict ?? null,
      edits: review?.edits.length ?? 0,
      material: t?.materialEdits ?? 0,
      scores: Object.fromEntries((review?.scores ?? []).map((s) => [s.criterion, s.score])),
      errors: t?.reviewErrors ?? [],
    },
    revision_: { outcome: t?.revision ?? null, targets: t?.targets ?? [] },
    findings: { draft: countKinds(t?.findings ?? []), final: countKinds(t?.finalFindings ?? []), reverted: t?.reverted ?? 0 },
    disagreements: t?.disagreements ?? [],
    flags,
    notes: r.value?.notes ?? [],
    calls: r.rows.map((x) => ({ step: x.step, model: x.model, status: x.status, effort: x.reasoningEffort, inputTokens: x.promptTokens, cachedInputTokens: x.cachedTokens, outputTokens: x.completionTokens, reasoningTokens: x.reasoningTokens, latencyMs: x.durationMs, retries: x.retryCount, retryWaitMs: x.retryWaitMs, costUsd: x.costUsd, error: x.error })),
  };
}

/** Runs the tasks with at most `limit` at a time, in order of starting. */
async function pool<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, tasks.length) }, async () => {
      while (next < tasks.length) {
        const i = next++;
        results[i] = await tasks[i]();
      }
    }),
  );
  return results;
}

const secs = (ms: number) => `${(ms / 1000).toFixed(0)}s`;
const usd = (n: number) => `$${n.toFixed(4)}`;
const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const STAGES = ["write-resume", "review-resume", "review-fallback", "revise-resume"];

function report(runs: RunResult[], matches: Record<string, CaseMatch>, args: Args): string {
  const label = (r: RunResult) => `${r.config}${args.revisions.length > 1 || r.revision !== "always" ? `/${r.revision}` : ""}`;
  const groups = [...new Set(runs.map(label))];
  const lines: string[] = ["# Resume writer eval", ""];
  lines.push(...args.configs.map((c) => `- ${describe(c)}`), `- Revision: ${args.revisions.join(" and ")}. Reviewer fallback: GLM-5.3 at high effort, JSON by prompt.`, "");
  lines.push("Read the resumes under blind/ before this report: key.json says which config wrote which.", "");

  lines.push("## By config", "", "| Config | Runs ok | Mean cost | Mean wall clock | Max wall clock | Mean review | Revised | Skipped revision | Reviewer fell back | Flagged runs |", "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const g of groups) {
    const rs = runs.filter((r) => label(r) === g);
    const ok = rs.filter((r) => r.ok);
    const scores = ok.map((r) => r.review.mean).filter((x): x is number => x !== null);
    lines.push(
      `| ${g} | ${ok.length} of ${rs.length} | ${usd(mean(rs.map((r) => r.costUsd)))} | ${secs(mean(rs.map((r) => r.wallMs)))} | ${secs(Math.max(...rs.map((r) => r.wallMs)))} | ${scores.length ? mean(scores).toFixed(2) : "none"} | ${rs.filter((r) => r.revision_.outcome === "full" || r.revision_.outcome === "targeted").length} | ${rs.filter((r) => r.revision_.outcome === "skipped").length} | ${rs.filter((r) => r.review.by === "fallback").length} | ${rs.filter((r) => r.flags.length).length} |`,
    );
  }

  lines.push("", "## Stages by config (means per run)", "", "| Config | Stage | Calls | Input | Cached | Output | Reasoning | Latency | Retries | Retry wait | Cost |", "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const g of groups) {
    const rs = runs.filter((r) => label(r) === g);
    for (const stage of STAGES) {
      const ss = rs.map((r) => r.stages[stage]).filter((s): s is StageUsage => !!s);
      if (!ss.length) continue;
      const m = (f: (s: StageUsage) => number) => sum(ss.map(f)) / rs.length;
      lines.push(`| ${g} | ${stage} | ${m((s) => s.calls).toFixed(1)} | ${k(Math.round(m((s) => s.inputTokens)))} | ${k(Math.round(m((s) => s.cachedInputTokens)))} | ${k(Math.round(m((s) => s.outputTokens)))} | ${k(Math.round(m((s) => s.reasoningTokens)))} | ${secs(m((s) => s.latencyMs))} | ${m((s) => s.retries).toFixed(1)} | ${secs(m((s) => s.retryWaitMs))} | ${usd(m((s) => s.costUsd))} |`);
    }
  }

  lines.push("", "## Every run", "");
  for (const r of runs) {
    lines.push(`### ${r.case}, ${label(r)}`, "");
    lines.push(`- ${r.ok ? "Written" : `Failed: ${r.error}`}. Cost ${usd(r.costUsd)}, wall clock ${secs(r.wallMs)}.`);
    for (const stage of STAGES) {
      const s = r.stages[stage];
      if (!s) continue;
      lines.push(`- ${stage} (${s.models.join(", ")}): ${s.calls} ${s.calls === 1 ? "call" : "calls"}${s.failed ? `, ${s.failed} failed` : ""}; in ${k(s.inputTokens)} (cached ${k(s.cachedInputTokens)}), out ${k(s.outputTokens)} of which reasoning ${k(s.reasoningTokens)}; ${secs(s.latencyMs)}; ${s.retries} retries, ${secs(s.retryWaitMs)} waiting; ${usd(s.costUsd)}.`);
    }
    if (r.retries.reviewWaitsMs.length) lines.push(`- Writer waited before retrying the review: ${r.retries.reviewWaitsMs.map(secs).join(", ")}.`);
    const scores = Object.entries(r.review.scores).map(([c, s]) => `${c} ${s}`).join(", ");
    lines.push(`- Review (${r.review.by ?? "none"}): ${r.review.mean === null ? "no score" : `${r.review.mean.toFixed(1)} of 5`}, verdict ${r.review.verdict ?? "none"}, ${r.review.edits} edits of which ${r.review.material} material.${scores ? ` Scores: ${scores}.` : ""}`);
    if (r.review.errors.length) lines.push(`- Review errors: ${r.review.errors.map((e) => e.slice(0, 160)).join(" | ")}`);
    lines.push(`- Revision: ${r.revision_.outcome ?? "none"}${r.revision_.targets.length ? ` (${r.revision_.targets.join(", ")})` : ""}.`);
    const kinds = (m: Record<string, number>) => Object.entries(m).map(([kind, n]) => `${kind} ${n}`).join(", ") || "none";
    lines.push(`- Code checks: draft ${kinds(r.findings.draft)}; final ${kinds(r.findings.final)}; ${r.findings.reverted} reverted to the candidate's words.`);
    if (r.disagreements.length) lines.push(`- Disagreements: ${r.disagreements.join("; ")}.`);
    if (r.flags.length) lines.push(`- Flags: ${r.flags.join("; ")}.`);
    lines.push("");
  }

  lines.push("## Matching (shared by every config)", "", "| Case | Requirements | Met | Ticked | Time | Cost |", "| --- | --- | --- | --- | --- | --- |");
  for (const [id, m] of Object.entries(matches)) lines.push(`| ${id} | ${m.requirements.length} | ${m.requirements.filter((r) => r.verdict === "met").length} | ${m.requirements.filter((r) => r.userHas).length} | ${secs(m.ms)} | ${m.costUsd === null ? "reused" : usd(m.costUsd)} |`);
  return `${lines.join("\n")}\n`;
}

/** Shuffles a copy, so the blind files of a case are not in config order. */
const shuffled = <T>(xs: T[]) => xs.map((x) => [Math.random(), x] as const).sort((a, b) => a[0] - b[0]).map(([, x]) => x);

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await mkdir(args.out, { recursive: true });
  console.log(`Writing to ${args.out}`);

  const matches: Record<string, CaseMatch> = {};
  if (args.matches) {
    const saved = JSON.parse(await readFile(path.join(args.matches, "matches.json"), "utf8")) as Record<string, Requirement[]>;
    for (const c of args.cases) {
      if (!saved[c.id]) throw new Error(`${args.matches}/matches.json has no match for ${c.id}`);
      matches[c.id] = { requirements: saved[c.id], ms: 0, costUsd: null };
    }
  } else {
    await Promise.all(
      args.cases.map(async (c) => {
        matches[c.id] = await matchCase(c);
        console.log(`matched ${c.id}: ${matches[c.id].requirements.length} requirements in ${secs(matches[c.id].ms)}`);
      }),
    );
  }
  await writeFile(path.join(args.out, "matches.json"), JSON.stringify(Object.fromEntries(Object.entries(matches).map(([id, m]) => [id, m.requirements])), null, 2));

  // Configs interleave, so no one config runs all at once against the same rate limit.
  const jobs = args.cases.flatMap((c) => args.revisions.flatMap((revision) => args.configs.map((cfg) => ({ c, cfg, revision }))));
  const tasks = shuffled(jobs).map(({ c, cfg, revision }) => async () => {
    console.log(`start ${c.id} ${cfg.name}/${revision}`);
    const r = await runOne(c, matches[c.id].requirements, cfg, revision, args.out);
    console.log(`done  ${c.id} ${cfg.name}/${revision}: ${r.ok ? "ok" : "FAILED"} ${usd(r.costUsd)} ${secs(r.wallMs)} review ${r.review.mean?.toFixed(1) ?? "none"}${r.flags.length ? ` [${r.flags.join("; ")}]` : ""}`);
    await writeFile(path.join(args.out, "runs.partial.jsonl"), `${JSON.stringify(r)}\n`, { flag: "a" });
    return r;
  });
  const runs = (await pool(tasks, args.concurrency)).sort((a, b) => a.case.localeCompare(b.case) || a.config.localeCompare(b.config) || a.revision.localeCompare(b.revision));

  const key = Object.fromEntries(runs.map((r) => [`${r.case}/resume-${r.blindId}.md`, `${r.config}/${r.revision}`]));
  await writeFile(path.join(args.out, "key.json"), JSON.stringify(key, null, 2));
  await writeFile(path.join(args.out, "runs.json"), JSON.stringify(runs, null, 2));
  await writeFile(path.join(args.out, "report.md"), report(runs, matches, args));
  console.log(`\nDone: ${runs.filter((r) => r.ok).length} of ${runs.length} written, ${usd(sum(runs.map((r) => r.costUsd)))} in all. Report: ${path.join(args.out, "report.md")}`);
  return runs.every((r) => r.ok) ? 0 : 1;
}

runLlmScript(main);
