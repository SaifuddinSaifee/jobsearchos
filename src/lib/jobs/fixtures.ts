import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { JobExtraction } from "./schema";
import type { Fetcher } from "./fetch/types";

export const FIXTURE_DIR = path.join(process.cwd(), "tests", "fixtures", "jobs");

export type FixtureMeta = {
  /** Source URL (absent for paste fixtures). */
  url?: string;
  /** Method fetchJob is expected to use (url fixtures) or "paste". */
  method: string;
  recordedAt: string;
};

type Recorded = Record<string, { status: number; body: string }>;

export type Fixture = {
  slug: string;
  dir: string;
  meta: FixtureMeta;
  responses: Recorded;
  rendered: string | null;
  pastedText: string | null;
  expected: Partial<JobExtraction> | null;
};

async function readIf(file: string): Promise<string | null> {
  return readFile(file, "utf8").catch(() => null);
}

export async function loadFixtures(): Promise<Fixture[]> {
  const slugs = await readdir(FIXTURE_DIR).catch(() => [] as string[]);
  const out: Fixture[] = [];
  for (const slug of slugs.sort()) {
    const dir = path.join(FIXTURE_DIR, slug);
    const meta = await readIf(path.join(dir, "meta.json"));
    if (!meta) continue;
    const responses = await readIf(path.join(dir, "responses.json"));
    const expected = await readIf(path.join(dir, "expected.json"));
    out.push({
      slug,
      dir,
      meta: JSON.parse(meta),
      responses: responses ? JSON.parse(responses) : {},
      rendered: await readIf(path.join(dir, "rendered.html")),
      pastedText: await readIf(path.join(dir, "paste.txt")),
      expected: expected ? JSON.parse(expected) : null,
    });
  }
  return out;
}

/** Serves recorded responses; any URL that was not recorded is a test failure, not a live request. */
export function replayFetcher(responses: Recorded): Fetcher {
  return async (url) => {
    const hit = responses[url];
    if (!hit) throw new Error(`Fixture has no recorded response for ${url}`);
    return new Response(hit.body, { status: hit.status });
  };
}

/** Wraps a fetcher and records every response by URL. */
export function recordingFetcher(inner: Fetcher, into: Recorded): Fetcher {
  return async (url, init) => {
    const res = await inner(url, init);
    into[url] = { status: res.status, body: await res.clone().text() };
    return res;
  };
}

export async function writeFixture(
  slug: string,
  files: { meta: FixtureMeta; responses?: Recorded; rendered?: string; pasteText?: string },
) {
  const dir = path.join(FIXTURE_DIR, slug);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "meta.json"), JSON.stringify(files.meta, null, 2) + "\n");
  if (files.responses) await writeFile(path.join(dir, "responses.json"), JSON.stringify(files.responses, null, 2) + "\n");
  if (files.rendered) await writeFile(path.join(dir, "rendered.html"), files.rendered);
  if (files.pasteText) await writeFile(path.join(dir, "paste.txt"), files.pasteText);
  return dir;
}

export function slugFor(url: string): string {
  const u = new URL(url);
  const host = u.hostname.replace(/^(www|boards|jobs|job-boards|apply|careers)\./, "").split(".")[0];
  const id = u.searchParams.get("gh_jid") ?? u.pathname.split("/").filter(Boolean).pop() ?? "";
  return `${host}-${id}`.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 48);
}
