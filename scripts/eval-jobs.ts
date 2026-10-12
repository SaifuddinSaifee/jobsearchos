import "dotenv/config";
import { extractJob } from "@/lib/jobs/extract";
import { fetchJob } from "@/lib/jobs/fetch";
import { normalizeForDedup } from "@/lib/jobs/dedup";
import { loadFixtures, replayFetcher, type Fixture } from "@/lib/jobs/fixtures";
import type { JobExtraction } from "@/lib/jobs/schema";

/**
 * Replays every fixture through the real extraction model and scores it against expected.json.
 * A fixture passes when title and company match and at least 80% of its scored fields match.
 * Usage: npm run eval:jobs [-- <slug-substring>]
 */

const norm = (s: string) => normalizeForDedup(s ?? "");
const overlap = (a: string[], b: string[]) => {
  const want = new Set(a.map(norm));
  if (!want.size) return 1;
  const got = new Set(b.map(norm));
  return [...want].filter((w) => got.has(w)).length / want.size;
};

type Check = { field: string; ok: boolean; detail?: string };

function score(expected: Partial<JobExtraction>, got: JobExtraction): Check[] {
  const checks: Check[] = [];
  const eq = (field: keyof JobExtraction, ok: boolean) => {
    if (expected[field] === undefined) return;
    checks.push({ field, ok, detail: ok ? undefined : `expected ${JSON.stringify(expected[field])}, got ${JSON.stringify(got[field])}` });
  };
  eq("title", norm(expected.title ?? "") === norm(got.title));
  eq("company", norm(expected.company ?? "") === norm(got.company));
  eq("location", norm(expected.location ?? "") === norm(got.location));
  eq("remoteType", expected.remoteType === got.remoteType);
  eq("salaryMin", (expected.salaryMin ?? null) === (got.salaryMin ?? null));
  eq("salaryMax", (expected.salaryMax ?? null) === (got.salaryMax ?? null));
  eq("salaryCurrency", (expected.salaryCurrency ?? "") === got.salaryCurrency);
  eq("postedAt", (expected.postedAt ?? "") === got.postedAt);
  for (const f of ["technologies", "keywords"] as const) {
    if (expected[f]) {
      const o = overlap(expected[f]!, got[f]);
      checks.push({ field: f, ok: o >= 0.8, detail: o >= 0.8 ? undefined : `overlap ${o.toFixed(2)}` });
    }
  }
  return checks;
}

async function textFor(f: Fixture) {
  if (f.pastedText) return { text: f.pastedText, hints: {} };
  const posting = await fetchJob(f.meta.url!, {
    fetcher: replayFetcher(f.responses),
    render: async () => f.rendered ?? "",
  });
  return { text: posting.text, hints: posting.hints };
}

async function main() {
  const filter = process.argv[2];
  const fixtures = (await loadFixtures()).filter((f) => !filter || f.slug.includes(filter));
  if (!fixtures.length) throw new Error("No fixtures found. Record some with npm run snapshot:job");

  let passed = 0;
  let scored = 0;
  for (const f of fixtures) {
    if (!f.expected) {
      console.log(`SKIP  ${f.slug} (no expected.json)`);
      continue;
    }
    scored++;
    try {
      const { text, hints } = await textFor(f);
      const { extraction } = await extractJob(text, hints);
      const checks = score(f.expected, extraction);
      const ratio = checks.filter((c) => c.ok).length / Math.max(checks.length, 1);
      const core = checks.filter((c) => ["title", "company"].includes(c.field)).every((c) => c.ok);
      const ok = core && ratio >= 0.8;
      if (ok) passed++;
      console.log(`${ok ? "PASS" : "FAIL"}  ${f.slug}  ${(ratio * 100).toFixed(0)}%`);
      for (const c of checks.filter((c) => !c.ok)) console.log(`        ${c.field}: ${c.detail}`);
    } catch (err) {
      console.log(`FAIL  ${f.slug}  ${err instanceof Error ? err.message : err}`);
    }
  }
  const pct = scored ? (passed / scored) * 100 : 0;
  console.log(`\n${passed}/${scored} fixtures passed (${pct.toFixed(0)}%), target 90%`);
  process.exit(pct >= 90 ? 0 : 1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
