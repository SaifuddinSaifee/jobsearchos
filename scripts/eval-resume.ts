import "dotenv/config";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "@/lib/env";
import type { Usage } from "@/lib/llm/chat";
import { withLlmContext } from "@/lib/llm/context";
import { runLlmScript } from "@/lib/llm/script";
import type { Profile } from "@/lib/profile/schema";
import { extractResumeText, normalizeText } from "@/lib/resume/extract";
import { PARSE_OPTIONS, parseResume, type ParseOptions } from "@/lib/resume/parse";

const USAGE = `Usage: npm run eval:resume -- <resume file or folder> [--effort default|low|medium|high] [--runs N] [--out results.json]

Runs text extraction and LLM parsing on each resume (PDF, DOCX or TXT), one at a time, and reports time, tokens,
schema failures and how many bullets were copied verbatim. "--effort default" sends no reasoning effort (the
model's own default); leaving --effort out uses what production uses. A single file with one run also prints
the parsed profile. Keep resumes and --out files outside the repo.`;

const EFFORTS = ["low", "medium", "high"] as const;
const EXTENSIONS = new Set([".pdf", ".docx", ".txt"]);

type Args = { target: string; effort: "production" | "default" | (typeof EFFORTS)[number]; runs: number; out: string | null };

type RunResult = {
  file: string;
  run: number;
  chars: number;
  extractMs: number;
  parseMs: number;
  ok: boolean;
  error: string | null;
  usage: Usage | null;
  counts: Counts | null;
  bullets: { total: number; verbatim: number; missing: string[] } | null;
  profile: Profile | null;
};

type Counts = { roles: number; bullets: number; skillGroups: number; technologies: number; projects: number; education: number };

function parseArgs(argv: string[]): Args {
  const args: Args = { target: "", effort: "production", runs: 1, out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--effort") {
      const v = argv[++i];
      if (v !== "default" && !(EFFORTS as readonly string[]).includes(v)) throw new Error(`--effort must be default, ${EFFORTS.join(", ")}\n\n${USAGE}`);
      args.effort = v as Args["effort"];
    } else if (a === "--runs") {
      args.runs = Number(argv[++i]);
      if (!Number.isInteger(args.runs) || args.runs < 1) throw new Error(`--runs must be a whole number of at least 1\n\n${USAGE}`);
    } else if (a === "--out") {
      args.out = argv[++i] ?? null;
    } else if (a === "--help" || a === "-h") {
      console.log(USAGE);
      process.exit(0);
    } else if (!args.target) {
      args.target = a;
    } else {
      throw new Error(`Unexpected argument "${a}"\n\n${USAGE}`);
    }
  }
  if (!args.target) throw new Error(USAGE);
  return args;
}

function optionsFor(effort: Args["effort"]): ParseOptions {
  if (effort === "production") return PARSE_OPTIONS;
  if (effort === "default") return {};
  return { reasoningEffort: effort };
}

async function resumeFiles(target: string): Promise<string[]> {
  if (!(await stat(target)).isDirectory()) return [target];
  const names = (await readdir(target)).filter((n) => EXTENSIONS.has(path.extname(n).toLowerCase())).sort();
  if (!names.length) throw new Error(`No PDF, DOCX or TXT files in ${target}`);
  return names.map((n) => path.join(target, n));
}

async function textOf(file: string): Promise<string> {
  const bytes = await readFile(file);
  if (path.extname(file).toLowerCase() === ".txt") return normalizeText(bytes.toString("utf8"));
  return (await extractResumeText(bytes, path.basename(file), "")).text;
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/** The share of bullets that appear word for word in the source text (whitespace aside). The prompt asks for verbatim. */
function verbatim(profile: Profile, text: string) {
  const source = squash(text);
  const bullets = [...profile.experience.flatMap((e) => e.bullets), ...profile.projects.flatMap((p) => p.bullets)].map(squash).filter(Boolean);
  const missing = bullets.filter((b) => !source.includes(b));
  return { total: bullets.length, verbatim: bullets.length - missing.length, missing };
}

const countsOf = (p: Profile): Counts => ({
  roles: p.experience.length,
  bullets: p.experience.reduce((n, e) => n + e.bullets.length, 0) + p.projects.reduce((n, x) => n + x.bullets.length, 0),
  skillGroups: p.skills.length,
  technologies: p.technologies.length,
  projects: p.projects.length,
  education: p.education.length,
});

const countsLabel = (c: Counts) =>
  `${c.roles} roles, ${c.bullets} bullets, ${c.skillGroups} skill groups, ${c.technologies} technologies, ${c.projects} projects, ${c.education} education`;

async function evalOnce(file: string, run: number, opts: ParseOptions, effortLabel: string): Promise<RunResult> {
  const t0 = performance.now();
  const text = await textOf(file);
  const t1 = performance.now();
  let usage: Usage | null = null;
  const result: RunResult = { file: path.basename(file), run, chars: text.length, extractMs: Math.round(t1 - t0), parseMs: 0, ok: false, error: null, usage: null, counts: null, bullets: null, profile: null };
  try {
    const profile = await withLlmContext("eval-resume", {}, () => parseResume(text, { ...opts, onUsage: (u) => (usage = u) }), {
      metadata: { effort: effortLabel, run },
    });
    Object.assign(result, { ok: true, counts: countsOf(profile), bullets: verbatim(profile, text), profile });
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
  }
  result.parseMs = Math.round(performance.now() - t1);
  result.usage = usage;
  return result;
}

const percentile = (xs: number[], p: number) => {
  if (!xs.length) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
};
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function printRun(r: RunResult) {
  const tokens = r.usage ? `${r.usage.completionTokens} out (${r.usage.reasoningTokens ?? 0} thinking)` : "no usage reported";
  if (!r.ok) {
    console.error(`FAIL  ${r.file} #${r.run}  ${r.parseMs} ms  ${tokens}  ${r.error}`);
    return;
  }
  const b = r.bullets!;
  console.error(`OK    ${r.file} #${r.run}  ${r.parseMs} ms  ${tokens}  ${b.verbatim}/${b.total} bullets verbatim  ${countsLabel(r.counts!)}`);
  for (const m of b.missing.slice(0, 3)) console.error(`        not verbatim: ${m.slice(0, 120)}`);
  if (b.missing.length > 3) console.error(`        ...and ${b.missing.length - 3} more`);
}

function printSummary(results: RunResult[], label: string) {
  const ok = results.filter((r) => r.ok);
  const parse = results.map((r) => r.parseMs);
  const withUsage = results.filter((r) => r.usage);
  const bullets = ok.reduce((n, r) => n + r.bullets!.total, 0);
  const verbatimBullets = ok.reduce((n, r) => n + r.bullets!.verbatim, 0);
  // A file whose counts change between runs is one the model is unsure about.
  const unstable = [...new Set(results.map((r) => r.file))].filter((f) => new Set(ok.filter((r) => r.file === f).map((r) => countsLabel(r.counts!))).size > 1);

  console.error(`\nSummary (${label})`);
  console.error(`  runs: ${results.length}, failed: ${results.length - ok.length}`);
  console.error(`  parse time: median ${percentile(parse, 50)} ms, p90 ${percentile(parse, 90)} ms, max ${Math.max(...parse)} ms`);
  if (withUsage.length) {
    console.error(
      `  output tokens: mean ${Math.round(mean(withUsage.map((r) => r.usage!.completionTokens)))}, thinking mean ${Math.round(mean(withUsage.map((r) => r.usage!.reasoningTokens ?? 0)))}`,
    );
  }
  console.error(`  bullets verbatim: ${verbatimBullets}/${bullets}${bullets ? ` (${((verbatimBullets / bullets) * 100).toFixed(1)}%)` : ""}`);
  if (unstable.length) console.error(`  counts changed between runs: ${unstable.join(", ")}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const files = await resumeFiles(args.target);
  const opts = optionsFor(args.effort);
  const label = `${env().EXTRACTION_MODEL}, effort ${args.effort === "production" ? "as in production" : args.effort}`;
  console.error(`${files.length} file(s), ${args.runs} run(s) each, ${label}\n`);

  const results: RunResult[] = [];
  for (const file of files) {
    for (let run = 1; run <= args.runs; run++) {
      const r = await evalOnce(file, run, opts, args.effort);
      printRun(r);
      results.push(r);
    }
  }

  if (files.length === 1 && args.runs === 1 && results[0].profile) console.log(JSON.stringify(results[0].profile, null, 2));
  printSummary(results, label);

  if (args.out) {
    await writeFile(args.out, JSON.stringify({ model: env().EXTRACTION_MODEL, effort: args.effort, runs: args.runs, at: new Date().toISOString(), results }, null, 2));
    console.error(`\nWrote ${args.out}`);
  }
}

void runLlmScript(main);
