"use client";

import { Copy, Download } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { detailToMarkdownJob, jobToMarkdown, markdownFilename } from "@/lib/jobs/markdown";
import type { MarkdownJob } from "@/lib/jobs/markdown";
import type { JobDetail } from "@/lib/jobs/types";

export type MarkdownFile = { markdown: string; filename: string };

export function toMarkdownFile(job: MarkdownJob): MarkdownFile {
  return { markdown: jobToMarkdown(job), filename: markdownFilename(job) };
}

/** Loads a saved job and renders it, for places that only have the table row (e.g. the row menu). */
export async function loadJobMarkdown(jobId: string): Promise<MarkdownFile> {
  const res = await fetch(`/api/jobs/${jobId}`);
  if (!res.ok) throw new Error("Could not load the job");
  return toMarkdownFile(detailToMarkdownJob((await res.json()) as JobDetail));
}

export async function copyMarkdown(markdown: string) {
  try {
    await navigator.clipboard.writeText(markdown);
  } catch {
    // Clipboard API unavailable (insecure context or denied): fall back to a hidden textarea.
    const ta = document.createElement("textarea");
    ta.value = markdown;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    if (!ok) throw new Error("Could not copy to the clipboard");
  }
  toast.success("Copied job as Markdown");
}

export function downloadMarkdown({ markdown, filename }: MarkdownFile) {
  const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  toast.success(`Downloaded ${filename}`);
}

/** Copy / download buttons. `build` runs on click so it always reflects the latest values. */
export function MarkdownButtons({
  build,
  disabled,
}: {
  build: () => MarkdownFile;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => copyMarkdown(build().markdown).catch((e: Error) => toast.error(e.message))}
      >
        <Copy /> Copy as Markdown
      </Button>
      <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => downloadMarkdown(build())}>
        <Download /> Download .md
      </Button>
    </div>
  );
}
