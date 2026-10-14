import { z } from "zod";
import { chatStructured } from "@/lib/llm/structured";
import { CONTACT_KINDS, type ContactKind } from "./types";

export type Candidate = {
  /** Index into the candidate list; the model refers to people by it. */
  id: number;
  name: string;
  title: string;
  department: string;
  seniority: string;
  /** "posting" candidates were named by the job posting itself. */
  fromPosting: boolean;
  /** How we know this person (for example "founder listed on the company's Y Combinator page"). */
  note?: string;
};

export type Ranked = { id: number; kind: ContactKind; score: number; reason: string };

const Schema = z.object({
  ranked: z.array(
    z.object({
      id: z.number().int(),
      kind: z.enum(CONTACT_KINDS),
      score: z.number().min(0).max(100),
      reason: z.string(),
    }),
  ),
});

const MAX_CANDIDATES = 40;

/** Orders candidates by how likely they are to own this hiring decision, with a one-line reason each. */
export async function rankCandidates(
  job: { title: string; company: string; responsibilities: string[]; context?: string[] },
  candidates: Candidate[],
): Promise<Ranked[]> {
  if (candidates.length === 0) return [];
  const list = candidates.slice(0, MAX_CANDIDATES);
  const out = await chatStructured(
    Schema,
    {
      system: `You decide whom a job applicant should cold-email about a specific role. Rate each candidate from 0 to 100 and give a one-sentence reason.
Preference order, best first:
1. The hiring manager for this team (the person the role reports to), or a head of the function (VP, Director, Head of ...).
2. At a small company (the list has founders or a CEO and few other people), the founder or CEO is usually the hiring manager.
3. A team lead or senior member of the same function as the role.
4. A technical recruiter or talent partner who hires for this function.
5. A general recruiter.
Low scores (under 25) for people who are unrelated to hiring for this role: finance, legal, sales, support, marketing (unless the role is marketing), or interns.
A person named in the job posting ("fromPosting": true) is the strongest signal; score them high unless their title clearly says otherwise. When the posting names only a first name and exactly one candidate has that first name, that candidate is who it means.
In a team of about ten people or fewer, a founder is the hiring manager. Prefer the founder the posting points to ("Intro call with Ray") over other founders, and over everyone else.
Use each candidate's "note" as evidence, and do not repeat it back: the reason says why this person fits this role.
"kind" is your best classification of the person. "reason" is concrete and short, e.g. "Heads the data platform team this role sits in." Never claim facts that are not in the candidate's title, department or seniority.
Return one entry per candidate id, using the ids given.`,
      user: JSON.stringify({
        role: { title: job.title, company: job.company, responsibilities: job.responsibilities.slice(0, 6), context: job.context ?? [] },
        candidates: list,
      }),
    },
    { maxTokens: 4000, step: "rank-contacts" },
  );
  const known = new Set(list.map((c) => c.id));
  const seen = new Set<number>();
  return out.ranked
    .filter((r) => known.has(r.id) && !seen.has(r.id) && seen.add(r.id))
    .map((r) => ({ ...r, reason: r.reason.trim() }));
}
