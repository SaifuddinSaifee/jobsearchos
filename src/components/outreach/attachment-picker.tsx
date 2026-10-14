"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, ExternalLink, FileText, ImageIcon, Paperclip, Plus, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ResumeDropzone } from "@/components/profile/resume-dropzone";
import { IndexBadge } from "@/components/resume/index-badge";
import { RESUME_INDEXES_KEY } from "@/components/resume/use-resume-indexes";
import { Button } from "@/components/ui/button";
import { Collapse } from "@/components/ui/collapse";
import {
  ATTACHABLE_TYPES,
  attachmentKey,
  BIG_ATTACHMENT_BYTES,
  formatBytes,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS,
  type AttachmentOption,
  type DraftAttachmentDTO,
} from "@/lib/outreach/types";
import { cn } from "@/lib/utils";

const KIND_LABEL: Record<AttachmentOption["kind"], string> = { base: "Default", job: "For this job", past: "Library", upload: "Uploaded" };

const ACCEPT_ANY = [...Object.keys(ATTACHABLE_TYPES).map((e) => `.${e}`), ...new Set(Object.values(ATTACHABLE_TYPES))].join(",");

/** How long a removed chip takes to fade out before it leaves the list. */
const LEAVE_MS = 150;

const rowClass =
  "flex w-full items-start gap-3 px-3 py-2 text-left text-sm outline-none transition-[background-color,scale,opacity] hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset active:scale-[0.995] disabled:pointer-events-none disabled:opacity-50";

function Size({ a }: { a: AttachmentOption }) {
  return (
    <span className={cn("shrink-0 text-xs text-muted-foreground", a.size !== null && a.size > BIG_ATTACHMENT_BYTES && "font-medium text-amber-700 dark:text-amber-400")}>
      {a.size !== null ? formatBytes(a.size) : "PDF made when sent"}
    </span>
  );
}

/**
 * What goes with the email: any number of library resumes and cover letters (the base resume is chosen by default),
 * a new resume uploaded for this job (stored, filed under the job and indexed), and other files uploaded for this
 * email alone (a proposal, a writing sample), which go exactly as they are.
 */
export function AttachmentPicker({
  jobId,
  options,
  selected,
  onAdd,
  onRemove,
  onResumeUploaded,
}: {
  jobId: string;
  /** Library resumes and cover letters that can be attached. */
  options: AttachmentOption[];
  /** What is attached, in order. */
  selected: DraftAttachmentDTO[];
  onAdd: (a: AttachmentOption) => void;
  onRemove: (a: AttachmentOption) => void;
  /** A resume uploaded here is new in the library: add it to the options and attach it. */
  onResumeUploaded: (resume: AttachmentOption) => void;
}) {
  const [open, setOpen] = useState(false);
  const [uploadingResume, setUploadingResume] = useState(false);
  const [uploadingFiles, setUploadingFiles] = useState(0);
  const [leaving, setLeaving] = useState<Set<string>>(() => new Set());
  const queryClient = useQueryClient();

  const chosen = new Set(selected.map(attachmentKey));
  const full = selected.length >= MAX_ATTACHMENTS;
  const known = selected.reduce((n, a) => n + (a.size ?? 0), 0);
  const pending = selected.filter((a) => a.size === null).length;
  const resumes = options.filter((o) => o.docKind === "resume");
  const letters = options.filter((o) => o.docKind === "cover_letter");

  async function post(url: string, file: File) {
    const body = new FormData();
    body.set("file", file);
    body.set("jobId", jobId);
    const res = await fetch(url, { method: "POST", body });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? "Upload failed");
    return data;
  }

  async function uploadResume(file: File) {
    setUploadingResume(true);
    try {
      const data = await post("/api/outreach/resume", file);
      onResumeUploaded(data.resume as AttachmentOption);
      void queryClient.invalidateQueries({ queryKey: RESUME_INDEXES_KEY });
      toast.success("Resume uploaded and attached. It is saved in your library and being indexed for search.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploadingResume(false);
    }
  }

  async function uploadFile(file: File) {
    setUploadingFiles((n) => n + 1);
    try {
      const data = await post("/api/outreach/attachment", file);
      onAdd(data.attachment as AttachmentOption);
      toast.success(`Attached ${file.name}`);
    } catch (err) {
      toast.error(`${file.name}: ${err instanceof Error ? err.message : "Upload failed"}`);
    } finally {
      setUploadingFiles((n) => n - 1);
    }
  }

  function remove(a: AttachmentOption) {
    const key = attachmentKey(a);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return onRemove(a);
    setLeaving((s) => new Set(s).add(key));
    setTimeout(() => {
      onRemove(a);
      setLeaving((s) => {
        const next = new Set(s);
        next.delete(key);
        return next;
      });
    }, LEAVE_MS);
  }

  function toggle(o: AttachmentOption) {
    if (chosen.has(attachmentKey(o))) remove(selected.find((a) => attachmentKey(a) === attachmentKey(o)) ?? o);
    else onAdd(o);
  }

  // A plain render helper, not a component, so the lists are not remounted (losing their scroll) on every change.
  function group(title: string, list: AttachmentOption[]) {
    return (
      <div role="group" aria-label={title} className="space-y-1">
        <p className="text-xs font-medium text-muted-foreground">{title}</p>
        <div className="max-h-56 divide-y overflow-y-auto rounded-lg border">
          {list.map((o) => {
            const on = chosen.has(attachmentKey(o));
            return (
              <button key={attachmentKey(o)} type="button" role="checkbox" aria-checked={on} disabled={!on && full} onClick={() => toggle(o)} className={cn(rowClass, on && "bg-muted/50")}>
                <span aria-hidden className={cn("mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-sm border transition-colors", on && "border-primary bg-primary text-primary-foreground")}>
                  {on && <Check className="size-3 animate-in zoom-in-50 duration-150 motion-reduce:animate-none" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-2">
                    <span className="truncate font-medium">{o.name}</span>
                    <span className="text-xs text-muted-foreground">{o.size !== null ? formatBytes(o.size) : "PDF made when sent"}</span>
                    <span className="rounded-full bg-muted px-1.5 text-[11px] text-muted-foreground">{KIND_LABEL[o.kind]}</span>
                  </span>
                  <span className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                    <span className="truncate">{o.label}</span>
                    {o.docKind === "resume" && o.documentId && <IndexBadge documentId={o.documentId} />}
                  </span>
                </span>
              </button>
            );
          })}
          {list.length === 0 && <p className="px-3 py-2 text-sm text-muted-foreground">None in your library yet.</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {selected.length > 0 ? (
        <ul aria-label="Attachments" className="flex flex-wrap items-center gap-2">
          {selected.map((a) => {
            const key = attachmentKey(a);
            const Icon = a.mime.startsWith("image/") ? ImageIcon : FileText;
            const href = a.fileId ? `/api/files/${a.fileId}` : `/library/${a.documentId}`;
            return (
              <li
                key={key}
                className={cn(
                  "inline-flex max-w-full min-w-0 items-center gap-2 rounded-lg border bg-muted/40 py-1 pr-1 pl-2 animate-in fade-in zoom-in-95 duration-200 motion-reduce:animate-none",
                  leaving.has(key) && "pointer-events-none animate-out fade-out zoom-out-95 fill-mode-forwards duration-150",
                )}
              >
                <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="truncate font-medium">{a.name}</span>
                <Size a={a} />
                <a
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={a.fileId ? `Open ${a.name}` : `Open ${a.label} in your library`}
                  className="inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground outline-none transition-[background-color,color,scale] hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.92]"
                >
                  <ExternalLink className="size-3.5" aria-hidden />
                </a>
                <button
                  type="button"
                  onClick={() => remove(a)}
                  aria-label={`Remove ${a.name}`}
                  className="inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground outline-none transition-[background-color,color,scale] hover:bg-destructive/10 hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.92]"
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <span className="inline-flex items-center gap-2 text-muted-foreground">
          <Paperclip className="size-4" aria-hidden /> No attachments
        </span>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Button type="button" size="xs" variant="outline" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          <Plus aria-hidden /> {selected.length > 0 ? "Add or change" : "Attach files"}
          <ChevronDown className={cn("transition-transform duration-200", open && "rotate-180")} aria-hidden />
        </Button>
        {selected.length > 1 && (
          <span key={`${selected.length}-${known}`} className={cn("text-xs text-muted-foreground animate-in fade-in duration-200 motion-reduce:animate-none", known > MAX_ATTACHMENT_BYTES && "font-medium text-destructive")}>
            {selected.length} files, {formatBytes(known)}
            {pending > 0 && ` plus ${pending} ${pending === 1 ? "PDF" : "PDFs"} made when sent`}
            {known > MAX_ATTACHMENT_BYTES && ". Over the 5 MB one email can carry."}
          </span>
        )}
      </div>

      <Collapse open={open}>
        <div className="space-y-3 pt-1 pb-2">
          {group("Resumes", resumes)}
          {letters.length > 0 && group("Cover letters", letters)}
          {full ? (
            <p className="text-sm text-muted-foreground">An email can carry at most {MAX_ATTACHMENTS} attachments. Remove one to add another.</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              <ResumeDropzone compact busy={uploadingResume} busyLabel="Uploading..." onFile={uploadResume} label="Upload a resume for this job" hint="PDF or DOCX, up to 5 MB. Saved to your Library." />
              <ResumeDropzone
                compact
                multiple
                busy={uploadingFiles > 0}
                busyLabel="Uploading..."
                onFile={uploadFile}
                accept={ACCEPT_ANY}
                label="Upload other files"
                hint="A proposal, a writing sample... PDF, Word, text, slides or images. Sent as they are."
              />
            </div>
          )}
        </div>
      </Collapse>
    </div>
  );
}
