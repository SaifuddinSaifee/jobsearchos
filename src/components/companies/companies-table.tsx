"use client";

import { Loader2, Plus, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { createCompanyAction } from "@/app/(app)/companies/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { CompanySummary } from "@/lib/companies/types";
import { formatDate } from "@/lib/jobs/format";

function NewCompany() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    const res = await createCompanyAction(name);
    setBusy(false);
    if (!res.ok) return void toast.error(res.error);
    setOpen(false);
    setName("");
    router.push(`/companies/${res.id}`);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>
        <Plus /> New company
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>New company</DialogTitle>
          <DialogDescription>
            Add a company before you apply, e.g. to paste its principles. Jobs at this company will link to it automatically.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim() && !busy) void create();
          }}
        >
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Google" aria-label="Company name" />
          <Button type="submit" disabled={!name.trim() || busy}>
            {busy && <Loader2 className="animate-spin" />}
            Create
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function CompaniesTable({ rows }: { rows: CompanySummary[] }) {
  const [q, setQ] = useState("");
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = rows.filter((r) => {
    const hay = `${r.name} ${r.aliases.join(" ")} ${r.website}`.toLowerCase();
    return terms.every((t) => hay.includes(t));
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search companies…" aria-label="Search companies" className="pl-8" />
        </div>
        <NewCompany />
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          No companies yet. They are added automatically when you save a job, or you can add one above.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Company</TableHead>
                <TableHead>Jobs</TableHead>
                <TableHead>Profile</TableHead>
                <TableHead>Researched</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="h-20 text-center text-muted-foreground">
                    No matches.
                  </TableCell>
                </TableRow>
              )}
              {shown.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <Link href={`/companies/${r.id}`} className="font-medium underline-offset-4 hover:underline">
                      {r.name}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      {[r.website.replace(/^https?:\/\//, ""), r.aliases.length ? `also ${r.aliases.join(", ")}` : ""]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </TableCell>
                  <TableCell className="tabular-nums">{r.jobCount}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Badge variant={r.hasAbout ? "secondary" : "outline"}>About</Badge>
                      <Badge variant={r.hasPrinciples ? "secondary" : "outline"}>Principles</Badge>
                      <Badge variant={r.hasCulture ? "secondary" : "outline"}>Culture</Badge>
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {r.researchedAt ? formatDate(r.researchedAt) : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
