import { DiscoverList } from "@/components/discover/discover-list";
import { listDiscovered } from "@/lib/discover/service";

export const dynamic = "force-dynamic";

export default async function DiscoverPage() {
  const jobs = await listDiscovered();
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Jobs found for you outside this app. Today they come from the Daily Job Shortlist on claude.ai: click Saved to JSOS
        there, and the job is read and saved to Jobs, with the shortlist&apos;s reasoning in its notes.
      </p>
      <DiscoverList jobs={jobs} />
    </div>
  );
}
