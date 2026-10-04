import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listJobs } from "@/lib/jobs/service";

export const dynamic = "force-dynamic";

// Minimal list so saved jobs are visible; Stage 3 replaces it with the full tracker table.
export default async function JobsPage() {
  const rows = await listJobs();
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <h1 className="text-2xl font-semibold">Jobs</h1>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No jobs yet. <Link href="/new" className="underline">Add your first application</Link>.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Company</TableHead>
              <TableHead>Title</TableHead>
              <TableHead>Location</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Saved</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.company}</TableCell>
                <TableCell>{r.title}</TableCell>
                <TableCell>{r.location}</TableCell>
                <TableCell>
                  <Badge variant="secondary">{r.status.replace(/_/g, " ")}</Badge>
                </TableCell>
                <TableCell>{r.createdAt.toLocaleDateString()}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
