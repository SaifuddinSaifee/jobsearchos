import { ExternalLink, Link2 } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { safeHref } from "@/lib/jobs/links";
import type { JobRow } from "@/lib/jobs/types";

function IconLink({ href, label, children }: { href: string; label: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={label}
            className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors active:scale-95 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** Posting and application-page links; one icon when both point at the same page. */
export function JobLinks({ job }: { job: Pick<JobRow, "postingUrl" | "applyUrl"> }) {
  const posting = safeHref(job.postingUrl);
  const apply = safeHref(job.applyUrl);
  if (!posting && !apply) return <span className="text-muted-foreground">—</span>;
  const same = posting && apply && posting === apply;
  return (
    <div className="flex items-center">
      {posting && (
        <IconLink href={posting} label="Open job posting">
          <Link2 className="size-4" />
        </IconLink>
      )}
      {apply && !same && (
        <IconLink href={apply} label="Open application page">
          <ExternalLink className="size-4" />
        </IconLink>
      )}
    </div>
  );
}
