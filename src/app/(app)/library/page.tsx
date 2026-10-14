import { LibraryTabs } from "@/components/library/library-tabs";
import type { RecordSummary } from "@/components/career/types";
import { listDocumentOffers, type DocumentOffer } from "@/lib/career/offer";
import { getCareerStatus } from "@/lib/career/review";
import { getLatestRecord, listRecordVersions, listSourceInfo } from "@/lib/career/service";
import { listDocuments, listJobOptions } from "@/lib/documents/service";

export const dynamic = "force-dynamic";

export default async function LibraryPage() {
  const [docs, jobs, latest, versions, careerStatus, careerSources, offers] = await Promise.all([
    listDocuments(),
    listJobOptions(),
    getLatestRecord(),
    listRecordVersions(),
    getCareerStatus(),
    listSourceInfo(),
    listDocumentOffers(),
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
      offers={offers.filter((o): o is Extract<DocumentOffer, { state: "new" }> => o.state === "new")}
      handled={{
        inRecord: offers.filter((o) => o.state === "in-record" || o.state === "nothing-new").length,
        leftOut: offers.filter((o) => o.state === "left-out").length,
      }}
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
