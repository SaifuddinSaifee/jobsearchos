"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Download, FileCode2, FileText, Type } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { RESUME_INDEXES_KEY } from "@/components/resume/use-resume-indexes";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { FORMAT_INFO, type ExportFormat } from "@/lib/documents/export/formats";
import type { DocumentKind } from "@/lib/documents/types";

const ICONS: Record<ExportFormat, typeof FileText> = { pdf: FileText, docx: FileText, md: FileCode2, txt: Type };

/** "Name - Acme.pdf" from a Content-Disposition header, using the UTF-8 form when there is one. */
function filenameFrom(header: string | null, fallback: string): string {
  const star = header?.match(/filename\*=UTF-8''([^;]+)/i);
  if (star) return decodeURIComponent(star[1]);
  return header?.match(/filename="([^"]+)"/i)?.[1] ?? fallback;
}

/**
 * Downloads a document as a file. PDF and Word are made on the server from the content as it is now (and saved as a
 * version); a PDF that runs over the page limit is saved anyway, with a warning saying how many pages it came to.
 */
export function ExportMenu({
  documentId,
  kind,
  versionId,
  disabled,
  beforeExport,
  size = "sm",
}: {
  documentId: string;
  kind: DocumentKind;
  /** Export this saved version instead of the current content. */
  versionId?: string | null;
  disabled?: boolean;
  /** Runs first, so unsaved edits are on the server before the file is made. */
  beforeExport?: () => Promise<void>;
  size?: "sm" | "default";
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  const formats: ExportFormat[] = kind === "email" ? ["md", "txt"] : ["pdf", "docx", "md", "txt"];

  async function run(format: ExportFormat) {
    setBusy(format);
    try {
      await beforeExport?.();
      const res = await fetch(`/api/documents/${documentId}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format, versionId: versionId ?? null }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Could not make that file");
      const blob = await res.blob();
      const name = filenameFrom(res.headers.get("Content-Disposition"), `document.${FORMAT_INFO[format].ext}`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);

      const pages = Number(res.headers.get("X-Page-Count"));
      // Only warn when the document is set to stay on one page; otherwise any length is fine.
      if (pages > 1 && res.headers.get("X-Fit-One-Page") === "1") toast.warning(`${name} runs to ${pages} pages.`, { description: "Shorten it, or turn off Keep to one page in Page settings." });
      else toast.success(`Downloaded ${name}`);
      if (res.headers.get("X-Version")) {
        void queryClient.invalidateQueries({ queryKey: RESUME_INDEXES_KEY });
        router.refresh();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not make that file");
    } finally {
      setBusy(null);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" size={size} loading={busy !== null} disabled={disabled} />}>
        <Download aria-hidden />
        Export
        <ChevronDown aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {formats.map((f) => {
          const Icon = ICONS[f];
          return (
            <DropdownMenuItem key={f} disabled={busy !== null} onClick={() => void run(f)}>
              <Icon aria-hidden />
              {FORMAT_INFO[f].label}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
