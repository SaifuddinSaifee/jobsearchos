import { notFound } from "next/navigation";
import { z } from "zod";
import { DocumentPage } from "@/components/documents/document-page";
import { EditorLoader } from "@/components/documents/editor-loader";
import { AutoRefresh } from "@/components/library/auto-refresh";
import { DocumentView } from "@/components/library/document-view";
import { parsePageSettings } from "@/lib/documents/page-settings";
import { hasStructure } from "@/lib/documents/read";
import { getEditorData, getVersion, latestVersion, listJobOptions } from "@/lib/documents/service";
import { getIndexRowForVersion } from "@/lib/resume/indexing";

export const dynamic = "force-dynamic";

export default async function DocumentRoute({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ version?: string }> }) {
  const { id } = await params;
  const { version: versionId } = await searchParams;
  if (!z.uuid().safeParse(id).success) notFound();
  const [data, jobs] = await Promise.all([getEditorData(id), listJobOptions()]);
  if (!data) notFound();

  const requested = versionId && z.uuid().safeParse(versionId).success ? await getVersion(versionId) : null;
  const viewed = requested && requested.documentId === id ? requested : null;
  const { document: doc } = data;
  // A resume that was just uploaded is still being read into sections by the AI. Editing now would race with that, so
  // the page waits (and then becomes the editor on its own).
  const latest = viewed ? null : await latestVersion(id);
  const index = latest && doc.kind === "resume" ? await getIndexRowForVersion(latest.id) : null;
  const fromUpload = doc.origin === "uploaded" || doc.origin === "pasted" || doc.legacyPastResumeId !== null;
  const structuring = Boolean(latest && index && (index.status === "queued" || index.status === "running") && fromUpload && !hasStructure(latest.content) && latest.plainText.length >= 80);
  const sheet = <DocumentPage content={viewed ? viewed.content : data.draft.content} settings={viewed ? parsePageSettings(viewed.pageSettings) : data.pageSettings} />;
  // The editor is rebuilt only when a version is restored (its content then changes under it), never after a save.
  const editorKey = data.versions.find((v) => v.reason === "restore")?.id ?? "live";

  return (
    <DocumentView
      doc={{
        id: doc.id,
        kind: doc.kind,
        origin: doc.origin,
        title: doc.title,
        isBase: doc.isBase,
        jobId: doc.jobId,
        jobLabel: data.job ? `${data.job.title} at ${data.job.company}` : null,
        companyName: doc.companyName,
        targetRole: doc.targetRole,
        writtenOn: doc.writtenOn,
        jdText: doc.jdText,
        jdUrl: doc.jdUrl,
      }}
      versions={data.versions.map((v, i) => ({
        id: v.id,
        version: v.version,
        reason: v.reason,
        note: v.note,
        createdAt: v.createdAt.toISOString(),
        locked: v.lockedAt !== null,
        lockedAt: v.lockedAt?.toISOString() ?? null,
        latest: i === 0,
      }))}
      viewing={viewed ? viewed.version : null}
      editable={!viewed && !structuring}
      jobs={jobs}
    >
      {structuring ? (
        <div className="space-y-3">
          <AutoRefresh message="Reading your resume into sections. You can edit it in a moment." />
          {sheet}
        </div>
      ) : viewed ? (
        <>
          {viewed.subject && (
            <p className="mb-3 rounded-lg border bg-muted/30 px-3 py-2 text-sm">
              <span className="text-muted-foreground">Subject: </span>
              {viewed.subject}
            </p>
          )}
          {sheet}
        </>
      ) : (
        <EditorLoader
          key={editorKey}
          documentId={doc.id}
          kind={doc.kind}
          initialContent={data.draft.content}
          initialSubject={data.draft.subject}
          initialRevision={data.draft.revision}
          initialSettings={data.pageSettings}
          fallback={sheet}
        />
      )}
    </DocumentView>
  );
}
