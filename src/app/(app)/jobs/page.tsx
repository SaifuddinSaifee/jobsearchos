import Link from "next/link";
import { Suspense } from "react";
import { JobsTable } from "@/components/jobs/table/jobs-table";
import { Button } from "@/components/ui/button";
import { listJobRows } from "@/lib/jobs/tracker";

export const dynamic = "force-dynamic";

export default async function JobsPage() {
  const rows = await listJobRows();
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          {rows.length} saved job{rows.length === 1 ? "" : "s"}. Track each one from saved to offer.
        </p>
        <Button nativeButton={false} render={<Link href="/new" />}>New application</Button>
      </div>
      <Suspense>
        <JobsTable rows={rows} />
      </Suspense>
    </div>
  );
}
