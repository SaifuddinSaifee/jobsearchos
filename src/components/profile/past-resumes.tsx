"use client";

import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { deletePastResumeAction } from "@/app/(app)/profile/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { ResumeDropzone } from "./resume-dropzone";

export type PastResumeSummary = {
  id: string;
  title: string;
  company: string | null;
  role: string | null;
  appliedAt: string | null;
  hasJd: boolean;
  chars: number;
};

const FIELDS = [
  { name: "title", label: "Title (optional)" },
  { name: "company", label: "Company" },
  { name: "role", label: "Role" },
  { name: "jdUrl", label: "Job posting URL" },
] as const;

export function PastResumes({ rows }: { rows: PastResumeSummary[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleting, startDelete] = useTransition();

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!file) return toast.error("Choose a resume file first");
    const body = new FormData(e.currentTarget);
    body.set("file", file);
    setBusy(true);
    try {
      const res = await fetch("/api/past-resumes", { method: "POST", body });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Upload failed");
      toast.success("Past resume saved");
      setFile(null);
      setOpen(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <p className="max-w-xl text-sm text-muted-foreground">
          Resumes you have sent before. They become reference material when generating new ones.
          Adding the job description each one was written for makes retrieval much better.
        </p>
        <Button onClick={() => setOpen((v) => !v)} variant={open ? "outline" : "default"}>
          <Plus /> Add past resume
        </Button>
      </div>

      {open && (
        <Card>
          <CardContent>
            <form onSubmit={submit} className="space-y-4">
              <ResumeDropzone
                compact
                onFile={setFile}
                label={file ? `Selected: ${file.name}` : "Choose a resume (PDF or DOCX)"}
              />
              <div className="grid gap-3 sm:grid-cols-2">
                {FIELDS.map((f) => (
                  <div key={f.name} className="space-y-1.5">
                    <Label htmlFor={f.name}>{f.label}</Label>
                    <Input id={f.name} name={f.name} />
                  </div>
                ))}
                <div className="space-y-1.5">
                  <Label htmlFor="appliedAt">Applied on</Label>
                  <Input id="appliedAt" name="appliedAt" type="date" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="jdText">Job description (optional)</Label>
                <Textarea id="jdText" name="jdText" rows={5} />
              </div>
              <Button type="submit" disabled={busy}>
                {busy ? "Saving…" : "Save past resume"}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No past resumes yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Company</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Applied</TableHead>
              <TableHead>JD</TableHead>
              <TableHead className="text-right">Text size</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.title}</TableCell>
                <TableCell>{r.company ?? "—"}</TableCell>
                <TableCell>{r.role ?? "—"}</TableCell>
                <TableCell>{r.appliedAt ? r.appliedAt.slice(0, 10) : "—"}</TableCell>
                <TableCell>{r.hasJd ? "Yes" : "No"}</TableCell>
                <TableCell className="text-right">{r.chars.toLocaleString()} chars</TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={deleting}
                    onClick={() =>
                      startDelete(async () => {
                        await deletePastResumeAction(r.id);
                        toast.success("Removed");
                      })
                    }
                  >
                    <Trash2 />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
