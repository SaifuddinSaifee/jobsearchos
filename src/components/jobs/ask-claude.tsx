"use client";

import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { jobToMarkdown, type MarkdownJob } from "@/lib/jobs/markdown";

const INTRO = `I'm applying for the job below. Read the job description carefully. If it lists a job posting link, open it to read the full original posting.

/job-application-kit

Also identify any gaps in my resume that would make me a less competitive candidate for this role, and suggest ways to address those gaps in my application materials.
And fix them in the resume and cover letter, if possible, to make me a more competitive candidate.

Job description:

`;

// The whole prompt travels in the URL, which browsers and proxies cap, so keep it to a few thousand characters.
// The verbatim posting never goes in: Claude can read it from the posting link instead.
const MAX_URL_PROMPT = 8000;

/** The structured job, without the verbatim posting; drops the company profile, then cuts, if still too long. */
export function claudePrompt(job: MarkdownJob): string {
  const candidates = [
    { ...job, rawText: "" },
    { ...job, rawText: "", companyProfile: null, aboutCompany: "" },
  ].map((j) => INTRO + jobToMarkdown(j));
  const fit = candidates.find((p) => encodeURIComponent(p).length <= MAX_URL_PROMPT);
  if (fit) return fit;
  let p = candidates[candidates.length - 1];
  while (encodeURIComponent(p).length > MAX_URL_PROMPT) p = p.slice(0, Math.floor(p.length * 0.9));
  return `${p}\n\n(Job description truncated.)`;
}

/** Opens a new claude.ai chat with this job description as the prompt; the user adds their resume there. */
export function AskClaudeButton({ build, disabled }: { build: () => MarkdownJob; disabled?: boolean }) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={disabled}
      onClick={() =>
        window.open(`https://claude.ai/new?q=${encodeURIComponent(claudePrompt(build()))}`, "_blank", "noopener,noreferrer")
      }
    >
      <Sparkles aria-hidden /> Ask Claude
    </Button>
  );
}
