"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { createBlankAction, createFromTextAction } from "@/app/(app)/library/actions";
import { ResumeDropzone } from "@/components/profile/resume-dropzone";
import { RESUME_INDEXES_KEY } from "@/components/resume/use-resume-indexes";
import { Button } from "@/components/ui/button";
import { Collapse } from "@/components/ui/collapse";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { DocumentKind } from "@/lib/documents/types";
import { KIND_LABELS } from "@/lib/documents/types";
import { cn } from "@/lib/utils";
import type { JobChoice } from "./types";

type Mode = "upload" | "paste" | "blank";

const MODE_LABELS: Record<Mode, string> = { upload: "Upload a file", paste: "Paste text", blank: "Start blank" };

/** Adds a document: from a PDF or DOCX, from pasted text, or empty (a resume can also start as a copy of the base). */
export function AddDocument({ kind, jobs, hasBase, onDone }: { kind: DocumentKind; jobs: JobChoice[]; hasBase: boolean; onDone: () => void }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const modes: Mode[] = kind === "email" ? ["paste", "blank"] : ["upload", "paste", "blank"];
  const [mode, setMode] = useState<Mode>(modes[0]);
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [fromBase, setFromBase] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [duplicate, setDuplicate] = useState<{ id: string; title: string } | null>(null);
  const label = KIND_LABELS[kind].toLowerCase();

  function finish(id: string) {
    toast.success(`Added to your library`, { action: { label: "Open", onClick: () => router.push(`/library/${id}`) } });
    setFile(null);
    setText("");
    setDuplicate(null);
    onDone();
    void queryClient.invalidateQueries({ queryKey: RESUME_INDEXES_KEY });
    router.refresh();
  }

  async function submit(formElement: HTMLFormElement, force = false) {
    const form = new FormData(formElement);
    const get = (k: string) => String(form.get(k) ?? "").trim();
    setBusy(true);
    try {
      if (mode === "upload") {
        if (!file) return void toast.error("Choose a file first");
        const body = new FormData();
        body.set("file", file);
        body.set("kind", kind);
        for (const k of ["title", "jobId", "companyName", "targetRole", "writtenOn", "jdText"]) body.set(k, get(k));
        if (force) body.set("force", "1");
        const res = await fetch("/api/documents", { method: "POST", body });
        const data = await res.json().catch(() => ({}));
        if (res.status === 409 && data.duplicateOf) return void setDuplicate(data.duplicateOf);
        if (!res.ok) throw new Error(data.error ?? "Upload failed");
        return finish(data.id);
      }
      const details = { title: get("title"), jobId: get("jobId") || null, companyName: get("companyName"), targetRole: get("targetRole"), writtenOn: get("writtenOn"), jdText: get("jdText") };
      const res = mode === "paste" ? await createFromTextAction({ ...details, kind, text }) : await createBlankAction({ ...details, kind, fromBase });
      if (!res.ok) throw new Error(res.error);
      finish(res.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add the document");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit(e.currentTarget);
      }}
      className="space-y-4 rounded-lg border bg-card p-4">
      <div role="tablist" aria-label="How to add" className="inline-flex rounded-lg bg-muted p-[3px]">
        {modes.map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => {
              setMode(m);
              setDuplicate(null);
            }}
            className={cn(
              "rounded-md px-3 py-1 text-sm font-medium text-muted-foreground outline-none transition-[background-color,color,box-shadow,scale] duration-150 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97]",
              mode === m && "bg-background text-foreground shadow-sm",
            )}
          >
            {MODE_LABELS[m]}
          </button>
        ))}
      </div>

      <div key={mode} className="space-y-4 animate-in fade-in duration-200 motion-reduce:animate-none">
        {mode === "upload" && (
          <ResumeDropzone compact onFile={setFile} label={file ? `Selected: ${file.name}` : `Choose a ${label} (PDF or DOCX)`} />
        )}
        {mode === "paste" && (
          <div className="space-y-1.5">
            <Label htmlFor={`text-${kind}`}>{kind === "email" ? "Email (start with Subject: to set the subject)" : `Your ${label}`}</Label>
            <Textarea id={`text-${kind}`} value={text} onChange={(e) => setText(e.target.value)} rows={8} />
          </div>
        )}
        {mode === "blank" && kind === "resume" && (
          <label className={cn("flex items-center gap-2 text-sm", !hasBase && "text-muted-foreground")}>
            <input type="checkbox" checked={fromBase} disabled={!hasBase} onChange={(e) => setFromBase(e.target.checked)} className="size-4 accent-primary" />
            Start as a copy of my base resume {!hasBase && "(you do not have one yet)"}
          </label>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor={`title-${kind}`}>Title</Label>
            <Input id={`title-${kind}`} name="title" placeholder={mode === "upload" ? "Defaults to the file name" : undefined} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`job-${kind}`}>Written for a job (optional)</Label>
            <NativeSelect id={`job-${kind}`} name="jobId" defaultValue="">
              <option value="">No job</option>
              {jobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.label}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>

        <Button type="button" variant="link" size="sm" className="px-0" aria-expanded={moreOpen} onClick={() => setMoreOpen((v) => !v)}>
          {moreOpen ? "Fewer details" : "More details"}
        </Button>
        <Collapse open={moreOpen}>
          <div className="space-y-3 pb-1">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor={`company-${kind}`}>Company</Label>
                <Input id={`company-${kind}`} name="companyName" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`role-${kind}`}>Role</Label>
                <Input id={`role-${kind}`} name="targetRole" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`date-${kind}`}>Date</Label>
                <Input id={`date-${kind}`} name="writtenOn" type="date" />
              </div>
            </div>
            {kind !== "email" && (
              <div className="space-y-1.5">
                <Label htmlFor={`jd-${kind}`}>Job description it was written for</Label>
                <Textarea id={`jd-${kind}`} name="jdText" rows={4} />
              </div>
            )}
          </div>
        </Collapse>
      </div>

      <Collapse open={duplicate !== null}>
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
          <span>
            You already have this file as <strong>{duplicate?.title}</strong>.
          </span>
          <Button type="button" size="xs" variant="outline" onClick={() => duplicate && router.push(`/library/${duplicate.id}`)}>
            Open it
          </Button>
          <Button type="button" size="xs" onClick={(e) => e.currentTarget.form && void submit(e.currentTarget.form, true)}>
            Add it again
          </Button>
        </div>
      </Collapse>

      <Button type="submit" loading={busy}>
        {busy ? "Adding..." : `Add ${label}`}
      </Button>
    </form>
  );
}
