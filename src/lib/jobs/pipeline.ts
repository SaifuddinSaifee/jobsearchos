import { companySiteBase, researchCompany, ResearchError } from "@/lib/companies/research";
import { webSearch, type WebSearchProvider } from "@/lib/companies/search";
import { findCompanyByName, needsResearch } from "@/lib/companies/service";
import type { CompanyResearch } from "@/lib/companies/types";
import { putFile } from "@/lib/storage/local";
import { dedupKey } from "./dedup";
import { extractJob } from "./extract";
import { fetchJob } from "./fetch";
import { renderPage } from "./fetch/browser";
import { FetchError, type FetchedPosting, type FetchStep } from "./fetch/types";
import { canonicalizeUrl } from "./fetch/url";
import type { JobDraft } from "./schema";
import { findDuplicate } from "./service";

export type PipelineInput = { kind: "url"; url: string } | { kind: "text"; text: string; url?: string };

export type PipelineResult =
  | { type: "draft"; draft: JobDraft }
  | { type: "duplicate"; job: { id: string; company: string; title: string } };

export type PipelineDeps = {
  fetchJob: typeof fetchJob;
  extractJob: typeof extractJob;
  findDuplicate: typeof findDuplicate;
  putFile: (bytes: Buffer, meta: { mime: string; originalName?: string }) => Promise<{ id: string }>;
  findCompanyByName: typeof findCompanyByName;
  researchCompany: typeof researchCompany;
  webSearch: () => WebSearchProvider | null;
  render: (url: string) => Promise<string>;
};

export const defaultPipelineDeps: PipelineDeps = {
  fetchJob,
  extractJob,
  findDuplicate,
  putFile,
  findCompanyByName,
  researchCompany,
  webSearch,
  render: renderPage,
};

export const MAX_PASTE_CHARS = 200_000;

/**
 * Turns a job URL (or pasted posting text) into a draft job, reporting each step. Nothing is saved as a job
 * here; only the raw source is stored (write-once, content-addressed). Returns a duplicate instead of a draft
 * when the job is already saved, checked as early as possible so no AI call is wasted on it.
 * Throws FetchError (blocked page, no description, ...) or any other error for the caller to record.
 */
export async function runPipeline(
  input: PipelineInput,
  onStep: (step: FetchStep) => void = () => {},
  deps: PipelineDeps = defaultPipelineDeps,
): Promise<PipelineResult> {
  const sourceUrl = input.kind === "url" ? input.url : (input.url?.trim() ?? "");
  const canonicalUrl = sourceUrl ? canonicalizeUrl(sourceUrl) : null;
  if (canonicalUrl) {
    const dup = await deps.findDuplicate({ canonicalUrl });
    if (dup) return { type: "duplicate", job: dup };
  }

  let posting: FetchedPosting;
  if (input.kind === "text") {
    const text = input.text.trim();
    if (!text) throw new FetchError("empty", "There is no text to read");
    if (text.length > MAX_PASTE_CHARS) throw new FetchError("empty", "The pasted text is too long");
    onStep({ step: "detect", status: "skipped" });
    onStep({ step: "fetch", status: "skipped", detail: "pasted text" });
    onStep({ step: "render", status: "skipped" });
    posting = {
      method: "paste",
      sourceUrl: canonicalUrl ?? "",
      applicationUrl: canonicalUrl,
      ats: null,
      atsJobId: null,
      raw: { body: text, mime: "text/plain" },
      text,
      hints: {},
    };
  } else {
    posting = await deps.fetchJob(input.url, { onStep });
  }

  const raw = await deps.putFile(Buffer.from(posting.raw.body), {
    mime: posting.raw.mime,
    originalName: posting.sourceUrl || "pasted-job.txt",
  });

  onStep({ step: "structure", status: "running" });
  const { extraction } = await deps.extractJob(posting.text, posting.hints);
  onStep({ step: "structure", status: "done" });

  const dup = await deps.findDuplicate({ dedupKey: dedupKey(extraction) });
  if (dup) return { type: "duplicate", job: dup };

  // Company profile, cheapest source first: directory, the posting's own text, the company's site, then one search.
  onStep({ step: "company", status: "running" });
  let companyResearch: CompanyResearch | null = null;
  let companyNote = "";
  try {
    const existing = await deps.findCompanyByName(extraction.company);
    if (existing && !needsResearch(existing)) {
      companyNote = `${existing.name} is already in your company directory.`;
      onStep({ step: "company", status: "skipped", detail: "already in directory" });
    } else {
      const siteBase = companySiteBase(extraction.company, [existing?.website, posting.sourceUrl, posting.applicationUrl]);
      companyResearch = await deps.researchCompany(extraction.company, {
        search: deps.webSearch(),
        siteBase,
        postingAbout: extraction.aboutCompany,
        render: deps.render,
      });
      const how = companyResearch.via === "web-search" ? "a web search" : "the company's own site (no search used)";
      companyNote = `Researched from ${how}. It is saved to the company directory when the job is saved.`;
      onStep({ step: "company", status: "done", detail: companyResearch.via === "web-search" ? "web search" : "company site" });
    }
  } catch (err) {
    companyNote =
      err instanceof ResearchError
        ? `Company research: ${err.message}`
        : `Company research failed: ${err instanceof Error ? err.message : "unknown error"}. You can retry from Companies.`;
    onStep({ step: "company", status: "skipped", detail: err instanceof ResearchError ? "not enough free info" : "failed" });
  }

  return {
    type: "draft",
    draft: {
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
    },
  };
}
