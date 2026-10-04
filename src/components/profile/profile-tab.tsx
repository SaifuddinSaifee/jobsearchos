"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { emptyProfile, type Profile } from "@/lib/profile/schema";
import { ProfileEditor } from "./profile-editor";
import { ResumeDropzone } from "./resume-dropzone";

type Draft = {
  key: number;
  fileName: string;
  fileId: string;
  text: string;
  profile: Profile;
};

export function ProfileTab({
  profile,
  hasProfile,
  baseResumeFileId,
}: {
  profile: Profile;
  hasProfile: boolean;
  baseResumeFileId: string | null;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [blank, setBlank] = useState(false);
  const [busy, setBusy] = useState(false);

  async function importResume(file: File) {
    setBusy(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/resume/parse", { method: "POST", body });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not parse the resume");
      setDraft({ key: Date.now(), fileName: file.name, ...data });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not parse the resume");
    } finally {
      setBusy(false);
    }
  }

  if (draft) {
    return (
      <div className="space-y-4 animate-in fade-in slide-in-from-bottom-1 duration-300 motion-reduce:animate-none">
        <div className="flex items-center justify-between rounded-lg border bg-muted/40 px-4 py-3 text-sm">
          <span>
            Draft imported from <strong>{draft.fileName}</strong>. Review it against the original
            text, fix anything wrong, then save.
          </span>
          <Button variant="ghost" size="sm" onClick={() => setDraft(null)}>
            Discard draft
          </Button>
        </div>
        <div className="grid gap-6 lg:grid-cols-[1fr_24rem]">
          <ProfileEditor
            key={draft.key}
            initial={draft.profile}
            baseResumeFileId={draft.fileId}
            changeNote={`Imported from ${draft.fileName}`}
            onSaved={() => {
              setDraft(null);
              router.refresh();
            }}
          />
          <aside className="lg:sticky lg:top-16 lg:self-start">
            <h3 className="mb-2 text-sm font-medium">Original resume text</h3>
            <ScrollArea className="h-[70vh] rounded-lg border">
              <pre className="whitespace-pre-wrap p-3 text-xs">{draft.text}</pre>
            </ScrollArea>
          </aside>
        </div>
      </div>
    );
  }

  if (!hasProfile && !blank) {
    return (
      <div className="max-w-xl space-y-4">
        <p className="text-sm text-muted-foreground">
          Upload your base resume. The AI will structure it into a profile that you can review and
          edit before saving.
        </p>
        <ResumeDropzone onFile={importResume} busy={busy} />
        <Button variant="link" className="px-0" onClick={() => setBlank(true)}>
          Or start with a blank profile
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="max-w-md">
        <ResumeDropzone
          compact
          busy={busy}
          onFile={importResume}
          label="Re-import from a resume (creates a draft, nothing is overwritten until you save)"
        />
      </div>
      <ProfileEditor
        initial={hasProfile ? profile : emptyProfile()}
        baseResumeFileId={baseResumeFileId}
        onSaved={() => {
          setBlank(false);
          router.refresh();
        }}
      />
    </div>
  );
}
