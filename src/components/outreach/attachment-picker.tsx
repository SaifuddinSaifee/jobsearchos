"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, ExternalLink, FileText, Paperclip } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ResumeDropzone } from "@/components/profile/resume-dropzone";
import { IndexBadge } from "@/components/resume/index-badge";
import { RESUME_INDEXES_KEY } from "@/components/resume/use-resume-indexes";
import { Button } from "@/components/ui/button";
import { Collapse } from "@/components/ui/collapse";
import { BIG_ATTACHMENT_BYTES, formatBytes, type DraftAttachmentDTO, type ResumeOption } from "@/lib/outreach/types";
import { cn } from "@/lib/utils";

const KIND_LABEL: Record<ResumeOption["kind"], string> = { base: "Default", job: "For this job", past: "Library" };

/**
 * Which resume goes with the email. The base resume is chosen by default; any resume from the library can be picked
 * instead, a new one can be uploaded (it is stored, filed under this job and indexed), or nothing can be attached.
 */
export function AttachmentPicker({
  jobId,
  resumes,
  selected,
  onSelect,
  onUploaded,
}: {
  jobId: string;
  resumes: ResumeOption[];
  /** The attached resume, or null for none. */
  selected: DraftAttachmentDTO | null;
  onSelect: (documentId: string | null) => void;
  onUploaded: (resume: ResumeOption) => void;
}) {
  const [open, setOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const queryClient = useQueryClient();

  async function upload(file: File) {
    setUploading(true);
    try {
      const body = new FormData();
      body.set("file", file);
      body.set("jobId", jobId);
      const res = await fetch("/api/outreach/resume", { method: "POST", body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Upload failed");
      onUploaded(data.resume as ResumeOption);
      void queryClient.invalidateQueries({ queryKey: RESUME_INDEXES_KEY });
      toast.success("Resume uploaded and attached. It is saved in your library and being indexed for search.");
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {selected ? (
          <span key={selected.documentId} className="inline-flex min-w-0 items-center gap-2 rounded-lg border bg-muted/40 py-1 pr-1 pl-2 animate-in fade-in duration-200 motion-reduce:animate-none">
            <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="truncate font-medium">{selected.name}</span>
            <span className={cn("shrink-0 text-xs text-muted-foreground", selected.size !== null && selected.size > BIG_ATTACHMENT_BYTES && "font-medium text-amber-700 dark:text-amber-400")}>
              {selected.size !== null ? formatBytes(selected.size) : "PDF made when sent"}
            </span>
            <a
              href={selected.fileId ? `/api/files/${selected.fileId}` : `/library/${selected.documentId}`}
              target="_blank"
              rel="noreferrer"
              aria-label={selected.fileId ? `Open ${selected.name}` : `Open ${selected.label} in your library`}
              className="inline-flex size-6 items-center justify-center rounded text-muted-foreground outline-none transition-[background-color,color,scale] hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.92]"
            >
              <ExternalLink className="size-3.5" aria-hidden />
            </a>
          </span>
        ) : (
          <span className="inline-flex items-center gap-2 text-muted-foreground">
            <Paperclip className="size-4" aria-hidden /> No attachment
          </span>
        )}
        <Button type="button" size="xs" variant="outline" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {selected ? "Change" : "Attach a resume"}
          <ChevronDown className={cn("transition-transform duration-200", open && "rotate-180")} aria-hidden />
        </Button>
      </div>

      <Collapse open={open}>
        <div className="space-y-3 pt-1 pb-2">
          <div role="radiogroup" aria-label="Resume to attach" className="max-h-56 divide-y overflow-y-auto rounded-lg border">
            {resumes.map((r) => {
              const on = selected?.documentId === r.documentId;
              return (
                <button
                  key={r.documentId}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => {
                    onSelect(r.documentId);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-start gap-3 px-3 py-2 text-left text-sm outline-none transition-[background-color,scale] hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset active:scale-[0.995]",
                    on && "bg-muted/50",
                  )}
                >
                  <span aria-hidden className={cn("mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors", on && "border-primary bg-primary text-primary-foreground")}>
                    {on && <Check className="size-3" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-2">
                      <span className="truncate font-medium">{r.name}</span>
                      <span className="text-xs text-muted-foreground">{r.size !== null ? formatBytes(r.size) : "PDF made when sent"}</span>
                      <span className="rounded-full bg-muted px-1.5 text-[11px] text-muted-foreground">{KIND_LABEL[r.kind]}</span>
                    </span>
                    <span className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                      <span className="truncate">{r.label}</span>
                      <IndexBadge documentId={r.documentId} />
                    </span>
                  </span>
                </button>
              );
            })}
            {resumes.length === 0 && <p className="px-3 py-2 text-sm text-muted-foreground">No resumes yet. Upload one below, or add your base resume on the Profile page.</p>}
            <button
              type="button"
              role="radio"
              aria-checked={!selected}
              onClick={() => {
                onSelect(null);
                setOpen(false);
              }}
              className={cn(
                "flex w-full items-center gap-3 px-3 py-2 text-left text-sm outline-none transition-[background-color,scale] hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset active:scale-[0.995]",
                !selected && "bg-muted/50",
              )}
            >
              <span aria-hidden className={cn("flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors", !selected && "border-primary bg-primary text-primary-foreground")}>
                {!selected && <Check className="size-3" />}
              </span>
              No attachment
            </button>
          </div>
          <ResumeDropzone compact busy={uploading} busyLabel="Uploading..." onFile={upload} label="Upload a different resume for this email" />
        </div>
      </Collapse>
    </div>
  );
}
