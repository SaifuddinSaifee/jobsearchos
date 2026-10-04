import { Suspense } from "react";
import { NewApplication } from "@/components/jobs/new-application";

export default function Page() {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">New Application</h1>
        <p className="text-sm text-muted-foreground">
          Paste a job posting URL. The app fetches it, structures it, and lets you review before saving.
        </p>
      </div>
      <Suspense>
        <NewApplication />
      </Suspense>
    </div>
  );
}
