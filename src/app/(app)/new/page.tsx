import { Suspense } from "react";
import { NewApplication } from "@/components/jobs/new-application";

export default function Page() {
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Add one or many job URLs. They are fetched, structured and saved in the background, so you can leave this page.
      </p>
      <Suspense>
        <NewApplication />
      </Suspense>
    </div>
  );
}
