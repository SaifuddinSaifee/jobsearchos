import { LibraryTabs } from "@/components/library/library-tabs";
import { listDocuments, listJobOptions } from "@/lib/documents/service";

export const dynamic = "force-dynamic";

export default async function LibraryPage() {
  const [docs, jobs] = await Promise.all([listDocuments(), listJobOptions()]);
  return (
    <LibraryTabs
      rows={docs.map((d) => ({
        id: d.id,
        kind: d.kind,
        origin: d.origin,
        title: d.title,
        isBase: d.isBase,
        jobId: d.jobId,
        jobTitle: d.jobTitle,
        companyName: d.companyName,
        targetRole: d.targetRole,
        writtenOn: d.writtenOn,
        versionCount: d.versionCount,
        locked: d.locked,
        updatedAt: d.updatedAt.toISOString(),
      }))}
      jobs={jobs}
    />
  );
}
