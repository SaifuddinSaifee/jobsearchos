import { mergeProvenance, type CareerRecord } from "@/lib/career/schema";
import { buildRequirements, type JobInput } from "@/lib/resume-writer/context";
import type { Requirement } from "@/lib/resume-writer/types";
import { employer, fact, recordWith, role } from "./career-helpers";

export const job: JobInput = {
  title: "Product Manager",
  company: "Stripe",
  location: "Remote",
  technologies: [],
  responsibilities: ["Own the payments roadmap"],
  requirements: { required: ["Experience launching payments products", "Strong SQL"], preferred: [] },
  keywords: [],
  aboutCompany: "Payments infrastructure for the internet.",
  companyProfile: null,
};

export const framing = (id: string, title: string, angle: string, targetRoles: string[] = []) => ({ id, title, angle, targetRoles, sources: [], provenance: mergeProvenance() });

/** Two employers: a recent role told two ways (engineering and product), and an older one. */
export function record(): CareerRecord {
  return {
    ...recordWith(
      employer(
        "Acme",
        [
          role({
            id: "roleA",
            start: "Jan 2021",
            end: "",
            current: true,
            framings: [framing("fEng", "Software Engineer", "Engineering"), framing("fPm", "Product Manager", "Product")],
            facts: [
              fact("fact1", [["w1", "Built the billing service in TypeScript"], ["w1b", "Launched self-serve billing for 2,000 merchants"]]),
              fact("fact2", [["w2", "Cut build times by 40%"]]),
              fact("fact3", [["w3", "Mentored four junior engineers"]]),
            ],
          }),
        ],
        { id: "empA" },
      ),
      employer(
        "Initech",
        [role({ id: "roleB", start: "Jun 2018", end: "Dec 2019", facts: [fact("fact4", [["w4", "Wrote internal reporting tools in SQL"]])] })],
        { id: "empB" },
      ),
    ),
    skills: [
      { id: "skill1", name: "SQL", category: "Databases", sources: [], provenance: mergeProvenance() },
      { id: "skill2", name: "Figma", category: "Design", sources: [], provenance: mergeProvenance() },
    ],
    projects: [
      { id: "proj1", name: "Ledger toy", description: "A payments ledger", url: "", technologies: ["SQL"], wordings: [], seen: [], sources: [], provenance: mergeProvenance() },
      { id: "proj2", name: "Garden app", description: "Plant watering reminders", url: "", technologies: ["Swift"], wordings: [], seen: [], sources: [], provenance: mergeProvenance() },
    ],
    certifications: [{ id: "cert1", name: "AWS Solutions Architect", issuer: "Amazon", date: "2023", sources: [], provenance: mergeProvenance() }],
    education: [{ id: "edu1", institution: "State University", degree: "BSc", field: "Computer Science", start: "2014", end: "2018", details: "", sources: [], provenance: mergeProvenance() }],
  };
}

export const withMap = (over: Partial<Requirement>[] = []): Requirement[] => buildRequirements(job).map((r, i) => ({ ...r, ...(over[i] ?? {}) }));

