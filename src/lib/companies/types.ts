import type { CompanyField, CompanyProvenance, CompanyResearchLog, CompanySource } from "@/lib/db/schema";

// Client-safe types and constants: no database imports.

export type { CompanyField, CompanyProvenance, CompanyResearchLog, CompanySource };

export const COMPANY_FIELDS: { key: CompanyField; label: string; hint: string }[] = [
  { key: "about", label: "What they do", hint: "Products, customers, size, history." },
  { key: "principles", label: "Mission, values and principles", hint: "e.g. paste Google's principles here; shown in your exports." },
  { key: "culture", label: "Culture and ways of working", hint: "How teams work, what they reward, benefits worth mentioning." },
];

export const MAX_FIELD_CHARS = 20_000;

/** The company profile as shown and exported. `parent` is the group it belongs to (one level). */
export type CompanyProfile = CompanyProfileBase & { parent: CompanyProfileBase | null };

export type CompanyProfileBase = {
  id: string;
  name: string;
  website: string;
  about: string;
  principles: string;
  culture: string;
  notes: string;
  provenance: CompanyProvenance;
  sources: CompanySource[];
  researchLog: CompanyResearchLog | null;
  researchedAt: string | null;
};

export type CompanySummary = {
  id: string;
  name: string;
  website: string;
  jobCount: number;
  aliases: string[];
  parentName: string | null;
  hasAbout: boolean;
  hasPrinciples: boolean;
  hasCulture: boolean;
  researchedAt: string | null;
  updatedAt: string;
};

export type CompanyDetail = CompanyProfile & {
  parentId: string | null;
  children: { id: string; name: string }[];
  aliases: string[];
  jobs: { jobId: string; title: string; status: string; createdAt: string }[];
};

/** What web research (or a posting) proposes for a company; applied only to fields the user has not edited. */
export type CompanyResearch = {
  website: string;
  about: string;
  principles: string;
  culture: string;
  sources: CompanySource[];
  via?: "company-site" | "web-search";
  log?: CompanyResearchLog;
};
