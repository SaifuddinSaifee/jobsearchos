import { notFound } from "next/navigation";
import { z } from "zod";
import { CompanyEditor } from "@/components/companies/company-editor";
import { getCompanyDetail, listCompanies } from "@/lib/companies/service";

export const dynamic = "force-dynamic";

export default async function CompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const [company, all] = await Promise.all([getCompanyDetail(id), listCompanies()]);
  if (!company) notFound();
  return (
    <div className="mx-auto max-w-3xl">
      {/* Keyed by the last change so server-side updates (research, merge) reset the form. */}
      <CompanyEditor
        key={`${company.id}:${company.researchedAt}:${company.name}:${company.about.length}:${company.principles.length}:${company.culture.length}`}
        company={company}
        others={all.filter((c) => c.id !== id).map((c) => ({ id: c.id, name: c.name }))}
      />
    </div>
  );
}
