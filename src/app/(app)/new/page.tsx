import { Suspense } from "react";
import { NewApplication } from "@/components/jobs/new-application";

export default function Page() {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">New Application</h1>
        <p className="text-sm text-muted-foreground">
          Add one or many job URLs. They are fetched, structured and saved in the background, so you can leave this page.
        </p>
      </div>
      <Suspense>
        <NewApplication />
      </Suspense>
    </div>
  );
}
