import { ClipboardList, ExternalLink, Link2 } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { safeHref } from "@/lib/jobs/links";
import type { JobRow } from "@/lib/jobs/types";
import { useJobsActions } from "./context";

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

/** Opens the job panel, where the posting's instructions on how to apply are shown next to the apply links. */
function ApplyNotesFlag({ jobId }: { jobId: string }) {
  const { openJob } = useJobsActions();
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label="This posting has instructions on how to apply. Open the job to read them"
            onClick={() => openJob(jobId)}
            className="inline-flex size-7 items-center justify-center rounded-md text-amber-600 outline-none transition-colors active:scale-95 hover:bg-amber-500/10 focus-visible:ring-2 focus-visible:ring-ring dark:text-amber-400"
          />
        }
      >
        <ClipboardList className="size-4" />
      </TooltipTrigger>
      <TooltipContent>Read how to apply first</TooltipContent>
    </Tooltip>
  );
}

/** Posting and application-page links; one icon when both point at the same page. */
export function JobLinks({ job }: { job: Pick<JobRow, "jobId" | "postingUrl" | "applyUrl" | "hasApplyNotes"> }) {
  const posting = safeHref(job.postingUrl);
  const apply = safeHref(job.applyUrl);
  if (!posting && !apply && !job.hasApplyNotes) return <span className="text-muted-foreground">—</span>;
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
      {job.hasApplyNotes && <ApplyNotesFlag jobId={job.jobId} />}
    </div>
  );
}

/** Outline buttons for the job panel's action row; one button when the posting is also the application page. */
export function JobLinkButtons({ job }: { job: Pick<JobRow, "postingUrl" | "applyUrl"> }) {
  const posting = safeHref(job.postingUrl);
  const apply = safeHref(job.applyUrl);
  const links: { href: string; label: string; Icon: typeof Link2 }[] = [];
  if (posting) links.push({ href: posting, label: "Open job posting", Icon: Link2 });
  if (apply && apply !== posting) links.push({ href: apply, label: "Open application page", Icon: ExternalLink });
  return links.map(({ href, label, Icon }) => (
    <a key={href} href={href} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: "outline" })}>
      <Icon aria-hidden />
      {label}
    </a>
  ));
}
