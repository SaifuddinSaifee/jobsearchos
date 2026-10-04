import type { CompanyField, CompanyProvenance, CompanySource } from "@/lib/db/schema";

// Client-safe types and constants: no database imports.

export type { CompanyField, CompanyProvenance, CompanySource };

export const COMPANY_FIELDS: { key: CompanyField; label: string; hint: string }[] = [
  { key: "about", label: "What they do", hint: "Products, customers, size, history." },
  { key: "principles", label: "Mission, values and principles", hint: "e.g. paste Google's principles here; shown in your exports." },
  { key: "culture", label: "Culture and ways of working", hint: "How teams work, what they reward, benefits worth mentioning." },
];

export const MAX_FIELD_CHARS = 20_000;

/** The company profile as shown and exported. */
export type CompanyProfile = {
  id: string;
  name: string;
  website: string;
  about: string;
  principles: string;
  culture: string;
  notes: string;
  provenance: CompanyProvenance;
  sources: CompanySource[];
  researchedAt: string | null;
};

export type CompanySummary = {
  id: string;
  name: string;
  website: string;
  jobCount: number;
  aliases: string[];
  hasAbout: boolean;
  hasPrinciples: boolean;
  hasCulture: boolean;
  researchedAt: string | null;
  updatedAt: string;
};

export type CompanyDetail = CompanyProfile & {
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
};
