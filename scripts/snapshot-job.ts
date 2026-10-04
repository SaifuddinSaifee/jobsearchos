import "dotenv/config";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { extractJob } from "@/lib/jobs/extract";
import { renderPage } from "@/lib/jobs/fetch/browser";
import { defaultFetcher } from "@/lib/jobs/fetch/fetcher";
import { fetchJob } from "@/lib/jobs/fetch";
import { recordingFetcher, replayFetcher, slugFor, writeFixture } from "@/lib/jobs/fixtures";

/**
 * Records job pages as regression fixtures under tests/fixtures/jobs/<slug>/.
 *
 *   npm run snapshot:job -- <url> [<url>...]        record each URL (responses.json, rendered.html if JS-rendered)
 *   npm run snapshot:job -- --paste <slug> <file>   record a paste-text fixture
 *   add --draft                                     also run the real model and write expected.json for you to review
 */
async function main() {
  const args = process.argv.slice(2);
  const draft = args.includes("--draft");
  const rest = args.filter((a) => a !== "--draft");

  if (rest[0] === "--paste") {
    const [, slug, file] = rest;
    if (!slug || !file) throw new Error("Usage: --paste <slug> <file>");
    const text = await readFile(file, "utf8");
    const dir = await writeFixture(slug, { meta: { method: "paste", recordedAt: new Date().toISOString() }, pasteText: text });
    if (draft) await writeDraft(dir, text, {});
    console.log(`recorded ${slug}`);
    return;
  }

  if (!rest.length) throw new Error("Usage: npm run snapshot:job -- <url...> [--draft]");
  for (const url of rest) {
    const responses = {};
    let rendered: string | undefined;
    try {
      const posting = await fetchJob(url, {
        fetcher: recordingFetcher(defaultFetcher, responses),
        render: async (u) => (rendered = await renderPage(u)),
      });
      const slug = slugFor(url);
      const dir = await writeFixture(slug, {
        meta: { url, method: posting.method, recordedAt: new Date().toISOString() },
        responses,
        rendered,
      });
      // Replaying must reproduce the same posting; fail loudly here rather than in CI later.
      const again = await fetchJob(url, { fetcher: replayFetcher(responses), render: async () => rendered ?? "" });
      if (again.text !== posting.text) throw new Error("replay produced different text");
      if (draft) await writeDraft(dir, posting.text, posting.hints);
      console.log(`recorded ${slug} (${posting.method}, ${posting.text.length} chars)`);
    } catch (err) {
      console.error(`FAILED ${url}: ${err instanceof Error ? err.message : err}`);
      process.exitCode = 1;
    }
  }
}

async function writeDraft(dir: string, text: string, hints: Parameters<typeof extractJob>[1]) {
  const file = path.join(dir, "expected.json");
  const { extraction } = await extractJob(text, hints);
  // Only the fields the eval scores. Review and correct by hand: this is the answer key.
  const { company, title, location, remoteType, salaryMin, salaryMax, salaryCurrency, postedAt, technologies, keywords } = extraction;
  await writeFile(file, JSON.stringify({ company, title, location, remoteType, salaryMin, salaryMax, salaryCurrency, postedAt, technologies, keywords }, null, 2) + "\n");
}

main().then(
  () => process.exit(process.exitCode ?? 0),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
