import { LibraryTabs } from "@/components/library/library-tabs";
import type { RecordSummary } from "@/components/career/types";
import { getCareerStatus } from "@/lib/career/review";
import { getLatestRecord, listRecordVersions, listSourceInfo } from "@/lib/career/service";
import { listDocuments, listJobOptions } from "@/lib/documents/service";

export const dynamic = "force-dynamic";

export default async function LibraryPage() {
  const [docs, jobs, latest, versions, careerStatus, careerSources] = await Promise.all([
    listDocuments(),
    listJobOptions(),
    getLatestRecord(),
    listRecordVersions(),
    getCareerStatus(),
    listSourceInfo(),
  ]);
  const roles = latest?.record.employers.flatMap((e) => e.roles) ?? [];
  const record: RecordSummary | null = latest
    ? {
        version: latest.version,
        employers: latest.record.employers.length,
        roles: roles.length,
        facts: roles.reduce((n, r) => n + r.facts.length, 0),
        wordings: roles.reduce((n, r) => n + r.facts.reduce((m, f) => m + f.wordings.length, 0), 0),
        skills: latest.record.skills.length,
      }
    : null;
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
      record={record}
      careerStatus={careerStatus}
      careerRecord={latest?.record ?? null}
      careerSources={careerSources}
      recordVersions={versions.map((v) => ({
        id: v.id,
        version: v.version,
        reason: v.reason,
        changeNote: v.changeNote,
        createdAt: v.createdAt.toISOString(),
      }))}
    />
  );
}
