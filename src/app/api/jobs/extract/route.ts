import { webSearch } from "@/lib/companies/search";
import { companySiteBase, researchCompany, ResearchError } from "@/lib/companies/research";
import { renderPage } from "@/lib/jobs/fetch/browser";
import { findCompanyByName, needsResearch } from "@/lib/companies/service";
import type { CompanyResearch } from "@/lib/companies/types";
import { dedupKey } from "@/lib/jobs/dedup";
import { extractJob } from "@/lib/jobs/extract";
import { fetchJob } from "@/lib/jobs/fetch";
import { FetchError, type FetchedPosting } from "@/lib/jobs/fetch/types";
import { canonicalizeUrl } from "@/lib/jobs/fetch/url";
import type { JobDraft } from "@/lib/jobs/schema";
import { findDuplicate } from "@/lib/jobs/service";
import { putFile } from "@/lib/storage/local";
import { encodeEvent } from "@/lib/sse";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_PASTE_CHARS = 200_000;

/**
 * Streams progress for turning a job URL (or pasted JD text) into a draft job.
 * Events: step, duplicate, result, error. Nothing is saved as a job here; only the raw
 * source is stored (write-once, content-addressed), so an abandoned draft leaves no job behind.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { url?: string; text?: string };
  const url = body.url?.trim() ?? "";
  const pasted = body.text?.trim() ?? "";
  if (!url && !pasted) {
    return Response.json({ error: "Provide a job URL or the job description text" }, { status: 400 });
  }
  if (pasted.length > MAX_PASTE_CHARS) {
    return Response.json({ error: "The pasted text is too long" }, { status: 400 });
  }

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: string, data: unknown) =>
        controller.enqueue(encoder.encode(encodeEvent(event, data)));

      try {
        let canonicalUrl: string | null = null;
        if (url) {
          canonicalUrl = canonicalizeUrl(url);
          const dup = await findDuplicate({ canonicalUrl });
          if (dup) {
            send("duplicate", dup);
            return;
          }
        }

        let posting: FetchedPosting;
        if (pasted) {
          send("step", { step: "detect", status: "skipped" });
          send("step", { step: "fetch", status: "skipped", detail: "pasted text" });
          send("step", { step: "render", status: "skipped" });
          posting = {
            method: "paste",
            sourceUrl: canonicalUrl ?? "",
            applicationUrl: canonicalUrl,
            ats: null,
            atsJobId: null,
            raw: { body: pasted, mime: "text/plain" },
            text: pasted,
            hints: {},
          };
        } else {
          posting = await fetchJob(url, { onStep: (s) => send("step", s) });
        }

        const raw = await putFile(Buffer.from(posting.raw.body), {
          mime: posting.raw.mime,
          originalName: posting.sourceUrl || "pasted-job.txt",
        });

        send("step", { step: "structure", status: "running" });
        const { extraction } = await extractJob(posting.text, posting.hints);
        send("step", { step: "structure", status: "done" });

        const dup = await findDuplicate({ dedupKey: dedupKey(extraction) });
        if (dup) {
          send("duplicate", dup);
          return;
        }

        // Company profile, cheapest source first: directory, then the posting's own text, then the company's site, then one search.
        send("step", { step: "company", status: "running" });
        let companyResearch: CompanyResearch | null = null;
        let companyNote = "";
        try {
          const existing = await findCompanyByName(extraction.company);
          if (existing && !needsResearch(existing)) {
            companyNote = `${existing.name} is already in your company directory.`;
            send("step", { step: "company", status: "skipped", detail: "already in directory" });
          } else {
            const siteBase = companySiteBase(extraction.company, [existing?.website, posting.sourceUrl, posting.applicationUrl]);
            companyResearch = await researchCompany(extraction.company, {
              search: webSearch(),
              siteBase,
              postingAbout: extraction.aboutCompany,
              render: renderPage,
            });
            const how = companyResearch.via === "web-search" ? "a web search" : "the company's own site (no search used)";
            companyNote = `Researched from ${how}. It is saved to the company directory when you save the job.`;
            send("step", { step: "company", status: "done", detail: companyResearch.via === "web-search" ? "web search" : "company site" });
          }
        } catch (err) {
          companyNote =
            err instanceof ResearchError
              ? `Company research: ${err.message}`
              : `Company research failed: ${err instanceof Error ? err.message : "unknown error"}. You can retry from Companies.`;
          send("step", { step: "company", status: "skipped", detail: err instanceof ResearchError ? "not enough free info" : "failed" });
        }

        const draft: JobDraft = {
          ...extraction,
          companyResearch,
          companyNote,
          applicationUrl: extraction.applicationUrl || posting.applicationUrl || "",
          sourceUrl: posting.sourceUrl,
          fetchMethod: posting.method,
          ats: posting.ats,
          atsJobId: posting.atsJobId,
          rawFileId: raw.id,
          rawText: posting.text,
          normalized: extraction,
        };
        send("result", draft);
      } catch (err) {
        if (err instanceof FetchError) {
          send("error", { code: err.code, message: err.message });
        } else {
          send("error", {
            code: "failed",
            message: err instanceof Error ? err.message : "Could not extract the job",
          });
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
