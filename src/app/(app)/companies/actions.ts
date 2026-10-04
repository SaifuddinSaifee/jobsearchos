"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { companySiteBase, researchCompany } from "@/lib/companies/research";
import { renderPage } from "@/lib/jobs/fetch/browser";
import { webSearch } from "@/lib/companies/search";
import {
  applyResearch,
  companyJobUrls,
  createCompany,
  getCompanyDetail,
  mergeCompanies,
  updateCompany,
} from "@/lib/companies/service";
import { MAX_FIELD_CHARS, type CompanyField } from "@/lib/companies/types";

const Id = z.uuid();
const Text = z.string().max(MAX_FIELD_CHARS);

export type CompanyResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

async function run<T extends object>(fn: () => Promise<T>): Promise<CompanyResult<T>> {
  try {
    const out = await fn();
    revalidatePath("/companies");
    revalidatePath("/jobs");
    return { ok: true, ...out };
  } catch (err) {
    if (err instanceof z.ZodError) return { ok: false, error: "Invalid request" };
    return { ok: false, error: err instanceof Error ? err.message : "Something went wrong" };
  }
}

export async function createCompanyAction(name: string) {
  return run(async () => ({ id: (await createCompany(z.string().min(1).max(200).parse(name))).id }));
}

const EditSchema = z.object({
  name: z.string().max(200).optional(),
  website: z.string().max(500).optional(),
  about: Text.optional(),
  principles: Text.optional(),
  culture: Text.optional(),
  notes: Text.optional(),
  aliases: z.array(z.string().max(200)).max(50).optional(),
});

export async function updateCompanyAction(id: string, edit: unknown) {
  return run(async () => {
    await updateCompany(Id.parse(id), EditSchema.parse(edit));
    return {};
  });
}

export async function mergeCompaniesAction(sourceId: string, targetId: string) {
  return run(async () => {
    await mergeCompanies(Id.parse(sourceId), Id.parse(targetId));
    return {};
  });
}

/** Searches the web for this company and fills every field the user has not edited. */
export async function researchCompanyAction(id: string) {
  return run(async () => {
    const company = await getCompanyDetail(Id.parse(id));
    if (!company) throw new Error("Company not found");
    // Free sources first (the company's own site); the search API is only used if those are thin.
    const siteBase = companySiteBase(company.name, [company.website, ...(await companyJobUrls(company.id))]);
    const research = await researchCompany(company.name, {
      search: webSearch(),
      siteBase,
      postingAbout: company.about,
      render: renderPage,
    });
    const applied: CompanyField[] = await applyResearch(company.id, research);
    return { applied, via: research.via };
  });
}
