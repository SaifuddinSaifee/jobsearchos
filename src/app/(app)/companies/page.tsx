import { CompaniesTable } from "@/components/companies/companies-table";
import { listCompanies } from "@/lib/companies/service";

export const dynamic = "force-dynamic";

export default async function CompaniesPage() {
  const rows = await listCompanies();
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        One profile per employer, reused by every job there. What you write here is never overwritten by research, and it goes
        into your Markdown exports.
      </p>
      <CompaniesTable rows={rows} />
    </div>
  );
}
