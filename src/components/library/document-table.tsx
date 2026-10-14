"use client";

import { Copy, Lock, MoreHorizontal, Star, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { IndexBadge } from "@/components/resume/index-badge";
import { formatDate } from "@/lib/jobs/format";
import { DeleteDialog } from "./delete-dialog";
import { ORIGIN_LABELS, type LibraryRow } from "./types";
import { useDocumentActions } from "./use-document-actions";

export function DocumentTable({ rows, emptyText }: { rows: LibraryRow[]; emptyText: string }) {
  const actions = useDocumentActions();
  const [deleting, setDeleting] = useState<LibraryRow | null>(null);

  if (rows.length === 0) return <p className="py-6 text-sm text-muted-foreground">{emptyText}</p>;
  const isResumes = rows[0].kind === "resume";

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Title</TableHead>
            <TableHead>For</TableHead>
            <TableHead>Date</TableHead>
            <TableHead>Source</TableHead>
            <TableHead className="text-right">Versions</TableHead>
            {isResumes && <TableHead>Search index</TableHead>}
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id} className="animate-in fade-in duration-200 motion-reduce:animate-none">
              <TableCell className="max-w-72">
                <div className="flex items-center gap-2">
                  <Link href={`/library/${r.id}`} className="truncate rounded-sm font-medium outline-none underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring">
                    {r.title}
                  </Link>
                  {r.isBase && <Badge variant="secondary">Base</Badge>}
                  {r.locked && (
                    <span title="Sent or used in an application, so it cannot be changed or deleted" className="inline-flex text-muted-foreground">
                      <Lock className="size-3.5" aria-hidden />
                      <span className="sr-only">Locked</span>
                    </span>
                  )}
                </div>
              </TableCell>
              <TableCell className="max-w-64 text-muted-foreground">
                <span className="block truncate">{[r.jobTitle ?? r.targetRole, r.companyName].filter(Boolean).join(" at ") || "-"}</span>
              </TableCell>
              <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(r.writtenOn ?? r.updatedAt) || "-"}</TableCell>
              <TableCell className="text-muted-foreground">{ORIGIN_LABELS[r.origin]}</TableCell>
              <TableCell className="text-right tabular-nums text-muted-foreground">{r.versionCount}</TableCell>
              {isResumes && (
                <TableCell>
                  <IndexBadge documentId={r.id} />
                </TableCell>
              )}
              <TableCell className="text-right">
                <DropdownMenu>
                  <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`Actions for ${r.title}`} loading={actions.busyId === r.id} />}>
                    <MoreHorizontal />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    <DropdownMenuItem render={<Link href={`/library/${r.id}`} />}>Open</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => actions.duplicate(r.id)}>
                      <Copy aria-hidden />
                      Duplicate
                    </DropdownMenuItem>
                    {r.kind === "resume" && !r.isBase && (
                      <DropdownMenuItem onClick={() => actions.setBase(r.id)}>
                        <Star aria-hidden />
                        Make base resume
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onClick={() => setDeleting(r)}>
                      <Trash2 aria-hidden />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <DeleteDialog
        title={deleting?.title ?? null}
        open={deleting !== null}
        busy={deleting !== null && actions.busyId === deleting.id}
        onOpenChange={(o) => !o && setDeleting(null)}
        onConfirm={() => deleting && void actions.remove(deleting.id, () => setDeleting(null))}
      />
    </>
  );
}
