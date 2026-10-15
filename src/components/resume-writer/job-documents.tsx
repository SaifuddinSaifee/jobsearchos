"use client";

import { Lock } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate } from "@/lib/jobs/format";
import { KIND_LABELS } from "@/lib/documents/types";
import { ORIGIN_LABELS } from "@/components/library/types";
import type { DocumentOrigin } from "@/lib/documents/types";
import { useJobResume } from "./use-job-resume";

/** The resumes and cover letters linked to a job, each opening in the editor. */
export function JobDocuments({ jobId }: { jobId: string }) {
  const { data, isLoading } = useJobResume(jobId);
  if (isLoading || !data) return <Skeleton className="h-9 w-full" />;
  if (data.documents.length === 0) return <p className="text-sm text-muted-foreground">No resume or cover letter is linked to this job yet.</p>;
  return (
    <ul className="divide-y rounded-lg border">
      {data.documents.map((d) => (
        <li key={d.id}>
          <Link
            href={`/library/${d.id}`}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm outline-none transition-colors duration-150 hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="min-w-0 flex-1 truncate font-medium">{d.title}</span>
            <Badge variant="outline">{KIND_LABELS[d.kind]}</Badge>
            <span className="text-xs text-muted-foreground">
              {ORIGIN_LABELS[d.origin as DocumentOrigin] ?? d.origin} | version {d.version} | {formatDate(d.updatedAt)}
            </span>
            {d.locked && <Lock className="size-3.5 text-muted-foreground" aria-label="Locked: it was used in an application" />}
          </Link>
        </li>
      ))}
    </ul>
  );
}
