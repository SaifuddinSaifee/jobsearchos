"use client";

import { ClipboardCheck, FileText, Loader2, Sparkles } from "lucide-react";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useJobResume } from "./use-job-resume";
import { useResumeActions } from "./use-resume-actions";

/**
 * The one button for a job's resume. It asks for one when there is none, shows where it is while it is made (and leads
 * to the page that shows it), and opens it once it exists. Writing it again is done from the editor.
 */
export function GenerateResumeButton({ jobId, size = "sm", className }: { jobId: string; size?: "sm" | "default"; className?: string }) {
  const { data } = useJobResume(jobId);
  const { busy, start } = useResumeActions(jobId);
  const g = data?.generation ?? null;
  const page = `/jobs/${jobId}/resume`;
  const link = (href: string, content: React.ReactNode, primary = false) => (
    <Link href={href} className={cn(buttonVariants({ size, variant: primary ? "default" : "outline" }), "animate-in fade-in duration-200 motion-reduce:animate-none", className)}>
      {content}
    </Link>
  );

  if (g && (g.status === "queued" || g.status === "matching")) {
    return link(page, <><Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden />Matching the job</>);
  }
  if (g?.status === "review") return link(page, <><ClipboardCheck aria-hidden />Review the match</>, true);
  if (g && (g.status === "writing_queued" || g.status === "writing")) {
    return link(page, <><Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden />Writing resume</>);
  }
  if (data?.documentId) return link(`/library/${data.documentId}`, <><FileText aria-hidden />Open resume</>);
  return (
    <Button size={size} className={className} loading={busy === "start"} disabled={!data} onClick={() => start({ open: true })}>
      <Sparkles aria-hidden />
      Generate resume
    </Button>
  );
}
