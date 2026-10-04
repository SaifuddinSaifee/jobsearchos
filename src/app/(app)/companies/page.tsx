import { CompaniesTable } from "@/components/companies/companies-table";
import { listCompanies } from "@/lib/companies/service";

export const dynamic = "force-dynamic";

export default async function CompaniesPage() {
  const rows = await listCompanies();
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Companies</h1>
        <p className="text-sm text-muted-foreground">
          One profile per employer, reused by every job there. What you write here is never overwritten by research, and it goes
          into your Markdown exports.
        </p>
      </div>
      <CompaniesTable rows={rows} />
    </div>
  );
}
