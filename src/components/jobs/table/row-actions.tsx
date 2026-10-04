"use client";

import { MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { safeHref } from "@/lib/jobs/links";
import type { JobRow } from "@/lib/jobs/types";
import { copyMarkdown, downloadMarkdown, loadJobMarkdown } from "../markdown-actions";
import { useJobsActions } from "./context";
import { StatusItems } from "./status-menu";

export function RowActions({ job }: { job: JobRow }) {
  const { openJob, changeStatus } = useJobsActions();
  const posting = safeHref(job.postingUrl);
  const apply = safeHref(job.applyUrl);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon-sm" aria-label={`Actions for ${job.title}`} />}
      >
        <MoreHorizontal />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem onClick={() => openJob(job.jobId)}>Open details</DropdownMenuItem>
        {posting && (
          <DropdownMenuItem render={<a href={posting} target="_blank" rel="noopener noreferrer" />}>
            Open job posting
          </DropdownMenuItem>
        )}
        {apply && apply !== posting && (
          <DropdownMenuItem render={<a href={apply} target="_blank" rel="noopener noreferrer" />}>
            Open application page
          </DropdownMenuItem>
        )}
        {posting && (
          <DropdownMenuItem
            onClick={() =>
              navigator.clipboard.writeText(posting).then(
                () => toast.success("Link copied"),
                () => toast.error("Could not copy the link"),
              )
            }
          >
            Copy posting link
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          onClick={() =>
            loadJobMarkdown(job.jobId)
              .then((f) => copyMarkdown(f.markdown))
              .catch((e: Error) => toast.error(e.message))
          }
        >
          Copy as Markdown
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() =>
            loadJobMarkdown(job.jobId).then(downloadMarkdown).catch((e: Error) => toast.error(e.message))
          }
        >
          Download Markdown
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Change status</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-48">
            <StatusItems onSelect={(to) => changeStatus([job.applicationId], to)} />
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
