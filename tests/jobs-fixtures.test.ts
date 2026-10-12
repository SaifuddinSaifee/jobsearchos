import { describe, expect, it } from "vitest";
import { fetchJob } from "@/lib/jobs/fetch";
import { loadFixtures, replayFetcher } from "@/lib/jobs/fixtures";

// Deterministic regression: every recorded page must still fetch and parse to the same method,
// with usable text and a title. The LLM step is covered separately by `npm run eval:jobs`.
const fixtures = await loadFixtures();

describe.skipIf(fixtures.length === 0)("job fixtures (offline replay)", () => {
  for (const f of fixtures.filter((f) => f.meta.url)) {
    it(f.slug, async () => {
      const posting = await fetchJob(f.meta.url!, {
        fetcher: replayFetcher(f.responses),
        render: async () => f.rendered ?? "",
      });
      expect(posting.method).toBe(f.meta.method);
      expect(posting.text.length).toBeGreaterThan(200);
      if (f.expected?.title && posting.hints.title) {
        expect(posting.hints.title.toLowerCase()).toContain(f.expected.title.toLowerCase().slice(0, 12));
      }
    });
  }
});
