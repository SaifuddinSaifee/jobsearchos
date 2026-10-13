"use client";

import { ArrowLeft, Check, Copy,  Lock, Star, Trash2 } from "lucide-react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { restoreVersionAction, updateMetaAction } from "@/app/(app)/library/actions";
import { ExportMenu } from "@/components/documents/export-menu";
import { EditorSessionProvider } from "@/components/documents/editor/session";
import { IndexBadge } from "@/components/resume/index-badge";
import { RESUME_INDEXES_KEY } from "@/components/resume/use-resume-indexes";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapse } from "@/components/ui/collapse";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { formatDate } from "@/lib/jobs/format";
import { KIND_LABELS, REASON_LABELS, type DocumentKind, type DocumentOrigin, type VersionReason } from "@/lib/documents/types";
import { cn } from "@/lib/utils";
import { DeleteDialog } from "./delete-dialog";
import { ORIGIN_LABELS, type JobChoice } from "./types";
import { useDocumentActions } from "./use-document-actions";

type Doc = {
  id: string;
  kind: DocumentKind;
  origin: DocumentOrigin;
  title: string;
  isBase: boolean;
  jobId: string | null;
  jobLabel: string | null;
  companyName: string | null;
  targetRole: string | null;
  writtenOn: string | null;
  jdText: string | null;
  jdUrl: string | null;
};

type VersionItem = { id: string; version: number; reason: VersionReason; note: string | null; createdAt: string; locked: boolean; lockedAt: string | null; latest: boolean };

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    if (!ok) throw new Error("Could not copy to the clipboard");
  }
}

/** A document page: the sheet (passed in as children, rendered on the server), its details and its version history. */
export function DocumentView({
  doc,
  versions,
  viewing,
  editable,
  jobs,
  children,
}: {
  doc: Doc;
  versions: VersionItem[];
  /** The version number being previewed, or null when looking at the current content. */
  viewing: number | null;
  /** The document can be edited here: the sheet in `children` is the editor, and the outline is shown. */
  editable: boolean;
  jobs: JobChoice[];
  children: React.ReactNode;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const actions = useDocumentActions();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Shared with the editor: saving right now before an export.
  const flushRef = useRef<(() => Promise<boolean>) | null>(null);
  const locked = versions.some((v) => v.locked);
  const viewingId = viewing === null ? null : (versions.find((v) => v.version === viewing)?.id ?? null);

  /** Copies the document as Markdown. It asks the server, so it is always what is saved now, not what the page loaded with. */
  async function copy() {
    try {
      await flushRef.current?.();
      const res = await fetch(`/api/documents/${doc.id}/export`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ format: "md", versionId: viewingId }) });
      if (!res.ok) throw new Error("Could not read the document");
      await copyText(await res.text());
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
      toast.success("Copied as Markdown");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not copy");
    }
  }

  async function saveDetails(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const get = (k: string) => String(form.get(k) ?? "").trim();
    setSaving(true);
    const res = await updateMetaAction(doc.id, {
      title: get("title"),
      jobId: get("jobId") || null,
      companyName: get("companyName"),
      targetRole: get("targetRole"),
      writtenOn: get("writtenOn"),
      jdText: get("jdText"),
      jdUrl: get("jdUrl"),
    });
    setSaving(false);
    if (!res.ok) return void toast.error(res.error);
    toast.success("Saved");
    setDetailsOpen(false);
    router.refresh();
  }

  async function restore(versionId: string, version: number) {
    setRestoring(versionId);
    await flushRef.current?.();
    const res = await restoreVersionAction(doc.id, versionId);
    setRestoring(null);
    if (!res.ok) return void toast.error(res.error);
    toast.success(`Restored version ${version} as version ${res.version}`);
    router.replace(`/library/${doc.id}`);
    void queryClient.invalidateQueries({ queryKey: RESUME_INDEXES_KEY });
    router.refresh();
  }

  const subtitle = [doc.jobLabel, !doc.jobLabel && doc.targetRole, !doc.jobLabel && doc.companyName, doc.writtenOn && formatDate(doc.writtenOn)].filter(Boolean).join("  |  ");

  const lastLocked = versions.find((v) => v.locked);

  return (
    <EditorSessionProvider value={{ flushRef }}>
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <Link href="/library" className="inline-flex items-center gap-1 rounded-sm text-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
            <ArrowLeft className="size-3.5" aria-hidden /> Library
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-lg font-semibold">{doc.title}</h2>
            <Badge variant="outline">{KIND_LABELS[doc.kind]}</Badge>
            {doc.isBase && <Badge variant="secondary">Base</Badge>}
            {locked && (
              <Badge variant="outline" title="Sent or used in an application, so it cannot be deleted">
                <Lock aria-hidden /> Locked
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            {ORIGIN_LABELS[doc.origin]}
            {subtitle && <> | {subtitle}</>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {doc.kind === "resume" && <IndexBadge documentId={doc.id} />}
          <Button variant="outline" size="sm" onClick={copy}>
            {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
            {copied ? "Copied" : "Copy Markdown"}
          </Button>
          <ExportMenu documentId={doc.id} kind={doc.kind} versionId={viewingId} beforeExport={async () => void (await flushRef.current?.())} />
          <Button variant="outline" size="sm" loading={actions.busyId === doc.id} onClick={() => actions.duplicate(doc.id)}>
            <Copy aria-hidden /> Duplicate
          </Button>
          {doc.kind === "resume" && !doc.isBase && (
            <Button variant="outline" size="sm" onClick={() => actions.setBase(doc.id)}>
              <Star aria-hidden /> Make base
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => setConfirmDelete(true)}>
            <Trash2 aria-hidden /> Delete
          </Button>
        </div>
      </div>

      {viewing !== null && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/40 px-4 py-2.5 text-sm animate-in fade-in duration-200 motion-reduce:animate-none">
          <span>
            You are looking at <strong>version {viewing}</strong>, an older save. It is read only.
          </span>
          <Button size="xs" variant="outline" render={<Link href={`/library/${doc.id}`} />}>
            Back to current
          </Button>
          <Button
            size="xs"
            loading={restoring !== null}
            onClick={() => {
              const v = versions.find((x) => x.version === viewing);
              if (v) void restore(v.id, v.version);
            }}
          >
            Restore this version
          </Button>
        </div>
      )}

      <div className={cn("grid items-start gap-6", !editable && "lg:grid-cols-[minmax(0,1fr)_16rem]")}>
        <div className="min-w-0 space-y-3">
          {editable && lastLocked && (
            <p className="flex items-center gap-2 rounded-lg border bg-muted/40 px-4 py-2.5 text-sm">
              <Lock className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span>
                Version {lastLocked.version} was sent or used in an application on {formatDate(lastLocked.lockedAt)}. It stays as it was; anything you change from here is saved as a new version.
              </span>
            </p>
          )}
          {children}
        </div>

        <aside className={cn(editable ? "grid gap-6 md:grid-cols-2" : "space-y-5 lg:sticky lg:top-16")}>
          <section aria-labelledby="versions-heading" className="space-y-2">
            <h3 id="versions-heading" className="text-sm font-medium">
              Versions
            </h3>
            <ol className="divide-y rounded-lg border">
              {versions.map((v) => {
                const active = viewing === v.version || (viewing === null && v.latest);
                return (
                  <li key={v.id} className={cn("flex items-start justify-between gap-2 px-3 py-2 text-sm transition-colors", active && "bg-muted/50")}>
                    <div className="min-w-0">
                      <Link
                        href={v.latest ? `/library/${doc.id}` : `/library/${doc.id}?version=${v.id}`}
                        className="inline-flex items-center gap-1 rounded-sm font-medium outline-none underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                        aria-current={active ? "true" : undefined}
                      >
                        Version {v.version}
                        {v.locked && <Lock className="size-3 text-muted-foreground" aria-label="Locked" />}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {REASON_LABELS[v.reason]} | {formatDate(v.createdAt)}
                      </p>
                      {v.note && <p className="truncate text-xs text-muted-foreground">{v.note}</p>}
                    </div>
                    {!v.latest && (
                      <Button size="xs" variant="ghost" loading={restoring === v.id} onClick={() => restore(v.id, v.version)}>
                        Restore
                      </Button>
                    )}
                  </li>
                );
              })}
            </ol>
          </section>

          <section aria-labelledby="details-heading" className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 id="details-heading" className="text-sm font-medium">
                Details
              </h3>
              <Button size="xs" variant="ghost" aria-expanded={detailsOpen} onClick={() => setDetailsOpen((v) => !v)}>
                {detailsOpen ? "Close" : "Edit"}
              </Button>
            </div>
            <Collapse open={detailsOpen}>
              <form onSubmit={saveDetails} className="space-y-3 pb-1">
                <div className="space-y-1.5">
                  <Label htmlFor="d-title">Title</Label>
                  <Input id="d-title" name="title" defaultValue={doc.title} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="d-job">Written for a job</Label>
                  <NativeSelect id="d-job" name="jobId" defaultValue={doc.jobId ?? ""}>
                    <option value="">No job</option>
                    {doc.jobId && !jobs.some((j) => j.id === doc.jobId) && <option value={doc.jobId}>{doc.jobLabel ?? "Linked job"}</option>}
                    {jobs.map((j) => (
                      <option key={j.id} value={j.id}>
                        {j.label}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="d-company">Company</Label>
                  <Input id="d-company" name="companyName" defaultValue={doc.companyName ?? ""} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="d-role">Role</Label>
                  <Input id="d-role" name="targetRole" defaultValue={doc.targetRole ?? ""} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="d-date">Date</Label>
                  <Input id="d-date" name="writtenOn" type="date" defaultValue={doc.writtenOn ?? ""} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="d-url">Job posting URL</Label>
                  <Input id="d-url" name="jdUrl" defaultValue={doc.jdUrl ?? ""} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="d-jd">Job description</Label>
                  <Textarea id="d-jd" name="jdText" rows={5} defaultValue={doc.jdText ?? ""} />
                </div>
                <Button type="submit" size="sm" loading={saving}>
                  Save details
                </Button>
              </form>
            </Collapse>
            {!detailsOpen && (
              <dl className="space-y-1 text-sm text-muted-foreground">
                {doc.jobLabel && (
                  <div>
                    <dt className="sr-only">Job</dt>
                    <dd>{doc.jobId ? <Link href={`/jobs?job=${doc.jobId}`} className="underline-offset-4 hover:text-foreground hover:underline">{doc.jobLabel}</Link> : doc.jobLabel}</dd>
                  </div>
                )}
                {doc.companyName && <div>{doc.companyName}</div>}
                {doc.targetRole && <div>{doc.targetRole}</div>}
                {!doc.jobLabel && !doc.companyName && !doc.targetRole && <div>Not linked to a job.</div>}
              </dl>
            )}
          </section>
        </aside>
      </div>

      <DeleteDialog
        title={doc.title}
        open={confirmDelete}
        busy={actions.busyId === doc.id}
        onOpenChange={setConfirmDelete}
        onConfirm={() =>
          void actions.remove(doc.id, () => {
            setConfirmDelete(false);
            router.push("/library");
          })
        }
      />
    </div>
    </EditorSessionProvider>
  );
}
