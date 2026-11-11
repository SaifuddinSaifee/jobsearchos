import { z } from "zod";
import { wordingFitsFraming } from "@/lib/career/framing";
import { pickEducation, uniqueCertifications } from "@/lib/career/dedupe";
import { guessAngle } from "@/lib/career/match";
import { balanceBrackets, normalizeText, titleSimilarity, tokens } from "@/lib/career/normalize";
import { toSpan } from "@/lib/career/dates";
import type { CareerRecord, Education, Framing, Role, Wording } from "@/lib/career/schema";
import { findBanned } from "@/lib/outreach/checks";
import type { GenerationInstructions } from "@/lib/profile/schema";
import { wordingsConflict } from "./clashes";
import { clip, containsPhrase, indexSource, jobTerms, mentionsTerm, type JobInput } from "./context";
import { namesIn, numbersIn, proofStrength, STRONG_PROOF } from "./proof";
import { composeSkills, isNamed, skillWanted, type SkillLine } from "./skills";
import { REQUIREMENT_KIND_LABEL, requirementUse, type GenerationChoices, type Requirement } from "./types";

// What the resume is written from, and how the model is asked. Code chooses what the model may draw on (which roles,
// which facts and which of their wordings, in what order, how many bullets) and the model edits the candidate's own
// wording for the job: it does not write new text. Everything it writes is tied back to the record by id: a bullet names
// the facts it came from, and employers, titles, dates, schools, certifications and achievements are filled in from the
// record by code, so the model never types any of them. The loop that writes, reviews and revises is in writer.ts.

export const DEFAULT_TOTAL_BULLETS = 14;
/**
 * The longest a bullet may be. Most stay far shorter; the ones that answer the job's top requirements may use this much.
 * At 440, a role with few bullets packed two or three stories into each; more bullets of one story each read better in
 * the same space.
 */
export const DEFAULT_BULLET_CHARS = 320;
/** About how long the supporting bullets should stay, in characters. */
export const SUPPORT_BULLET_CHARS = 220;
export const MAX_ROLES = 5;
const MAX_PROJECTS = 3;
const MAX_ACHIEVEMENTS = 4;
const TEXTS_PER_FACT = 2;
const WORDING_CHARS = 600;
/** The longest the summary should be: three sentences. A longer one is flagged for the revision, never a reason to throw the draft away. */
export const MAX_SUMMARY_CHARS = 560;
/** Bullets per project. */
const PROJECT_BULLETS = 2;
/** Wordings offered per project. */
const PROJECT_TEXTS = 3;
/** Bullets a role may run past its count when a line of the candidate's is split into two stories. */
const MAX_SPLITS = 2;
/** Shorter than this, a bullet says nothing: it is dropped. */
const MIN_BULLET_CHARS = 10;
const MAX_CERTIFICATIONS = 4;

/**
 * A must-have or nice-to-have that is about a field rather than work ("you're into fandom, reading or fanfiction"). When
 * the user ticks it, it is an interest of theirs: it goes in the Interests line, never in a bullet.
 */
export const isInterest = (r: Pick<Requirement, "kind" | "use">): boolean => (r.kind === "must" || r.kind === "nice") && r.use === "domain";

/**
 * A fact offered to the writer: its candidate wordings, what it answers of the job (`weight`) and how much it proves
 * (`proof`). `keep` marks one of the role's strongest measured results, which goes on the page whatever else does.
 */
export type PlanFact = { alias: string; factId: string; texts: string[]; weight: number; proof: number; keep: boolean };
export type PlanRole = {
  alias: string;
  roleId: string;
  employer: string;
  /** The title of the framing that fits this job best. */
  title: string;
  start: string;
  end: string;
  current: boolean;
  location: string;
  facts: PlanFact[];
  budget: number;
};
export type PlanProject = { alias: string; projectId: string; name: string; description: string; url: string; technologies: string[]; texts: string[] };
export type PlanCertification = { alias: string; id: string; name: string; issuer: string; date: string };
export type PlanAchievement = { alias: string; id: string; text: string };
/** Something about the candidate outside work that the job asks for and the user ticked ("into fanfiction"), with their note. */
export type PlanInterest = { requirementId: string; text: string; note: string };
/** Something the user said they have ("I have this"), to be worked in. */
export type PlanUser = {
  alias: string;
  requirementId: string;
  text: string;
  note: string;
  /**
   * How it reads in a skills line ("Kafka", not "Experience with Kafka"; "Rails" and "TypeScript" for "Rails and
   * TypeScript experience"), or none when it is not a skill. A claim with a note is proven in a bullet, so only a named
   * technology it names goes here (not a product area such as "Video streaming"); a claim with no note may go here as written.
   */
  skills: string[];
  /** Ticked with no note: true, but with no detail to prove it in a bullet of its own. */
  bare: boolean;
  /** How much the requirement counts toward the job, so a bullet that covers it ranks with the rest. */
  weight: number;
};

export type WritingPlan = {
  roles: PlanRole[];
  projects: PlanProject[];
  /** The skills section, written by code (skills.ts): the model never chooses or groups skills. */
  skills: SkillLine[];
  certifications: PlanCertification[];
  users: PlanUser[];
  achievements: PlanAchievement[];
  /** What the user ticked about themselves outside work, for one short Interests line and nowhere else. */
  interests: PlanInterest[];
  /** Conditions of the job the user asked to mention ("willing to relocate"), for one short line in the header. */
  mentions: string[];
  /** The job's location as posted ("Canada, Remote"), or "". */
  jobLocation: string;
  /** The candidate's own notes on the conditions they ticked: the only words the header's mention may draw on. */
  conditionNotes: string[];
  education: Education[];
  /** The tools and skills the job names that the candidate has, in the job's wording: what the resume is asked to use. */
  terms: string[];
  /**
   * The terms no line offered to the writer mentions (nor a note of the candidate's): the record has them only in its
   * skills list, so the skills section is where they go. Asked to place every term, the writer spent thousands of
   * tokens of thinking looking for a bullet that could carry "AI agents", then pushed it into a line about other work.
   */
  listedOnly: string[];
  /** The requirements the record shows only through its skills list (see `Requirement.skillsOnly`), by id. */
  skillsOnly: string[];
  /**
   * The result the summary leads with, chosen in code: of the facts that state a measured result, the one that best
   * answers the job's core, in its strongest wording narrowed to its strongest clause (a line joined by a semicolon holds
   * two results). Null with no facts.
   */
  summaryProof: { alias: string; text: string } | null;
  totalBullets: number;
  bulletChars: number;
};

/**
 * A long wording cut at the last sentence that fits, never mid-sentence. A wording cut with "..." was copied onto the
 * page as it was, or put back there by code, and the resume read "Made history immutable from day one: profile...".
 * One with no sentence end in reach is cut at the last clause break, then the last word, still without dots.
 */
export function clipAtSentence(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const head = t.slice(0, max);
  const end = Math.max(head.lastIndexOf(". "), head.lastIndexOf("! "), head.lastIndexOf("? "));
  if (end >= max / 3) return head.slice(0, end + 1);
  const clause = Math.max(head.lastIndexOf("; "), head.lastIndexOf(", "));
  if (clause >= max / 2) return head.slice(0, clause);
  return head.slice(0, head.lastIndexOf(" ")).replace(/[,;:]$/, "");
}

/** A line that lists tools ("Technologies: Python, SQL") is a skills line kept as a bullet, not something that was done. */
const isSkillsLine = (text: string) => /^\s*(technologies|tech stack|skills)\s*:/i.test(text);

/**
 * The wordings of a fact that can be written as a bullet under a framing. A fact left with no bullet wording (a tidy can
 * leave only its statement) offers its statement, which fits any framing.
 */
function bulletWordings(role: Role, fact: Role["facts"][number], framingId: string | null): Wording[] {
  const bullets = fact.wordings.filter((w) => w.form === "bullet" && !isSkillsLine(w.text));
  if (bullets.length === 0 && fact.statement.trim()) {
    return [{ id: `${fact.id}-statement`, text: fact.statement.trim(), framingId: null, form: "bullet", sources: fact.sources, provenance: fact.provenance }];
  }
  return bullets.filter((w) => framingId === null || wordingFitsFraming(role, w, framingId));
}

/** How much a fact answers of the job: the weight of the requirements it was matched to. */
export const factWeigher = (requirements: Pick<Requirement, "refs" | "weight">[]) => (factId: string) =>
  requirements.filter((r) => r.refs.includes(factId)).reduce((n, r) => n + r.weight, 0);

/**
 * How much a telling of a role can prove for this job: for each fact it has wording for, the weight of the requirements
 * the fact answers and the proof in its strongest wording.
 */
function framingEvidence(role: Role, framingId: string, weightOf: (factId: string) => number): number {
  return role.facts.reduce((n, f) => {
    const fitting = bulletWordings(role, f, framingId);
    return fitting.length === 0 ? n : n + weightOf(f.id) + Math.max(...fitting.map((w) => proofStrength(w.text)));
  }, 0);
}

/**
 * The framing of a role that suits the job best: the same angle as the job's title, the closest title or target role,
 * and the telling that proves the most of what the job asks for (its share of the best telling's evidence). For a
 * "Product Engineer" the engineering telling wins on angle, and where its wordings carry the results it wins on evidence.
 */
export function pickFraming(role: Role, jobTitle: string, weightOf: (factId: string) => number = () => 0): Framing | null {
  if (role.framings.length <= 1) return role.framings[0] ?? null;
  const angle = guessAngle(jobTitle).toLowerCase();
  const evidence = new Map(role.framings.map((f) => [f.id, framingEvidence(role, f.id, weightOf)]));
  const most = Math.max(...evidence.values(), 0);
  const score = (f: Framing) =>
    (angle && f.angle.toLowerCase() === angle ? 1 : 0) +
    Math.max(titleSimilarity(f.title, jobTitle), ...f.targetRoles.map((t) => titleSimilarity(t, jobTitle)), 0) +
    (most > 0 ? (evidence.get(f.id) ?? 0) / most : 0);
  return [...role.framings].sort((a, b) => score(b) - score(a))[0];
}

/** The framing the review screen recommends for a role, for a job and what it asks for. */
export const recommendFraming = (role: Role, jobTitle: string, requirements: Pick<Requirement, "refs" | "weight">[]): Framing | null =>
  pickFraming(role, jobTitle, factWeigher(requirements));

/** The framing to write a role from: the user's choice when it is one of the role's, else the recommended one. */
export function chosenFraming(role: Role, jobTitle: string, requirements: Pick<Requirement, "refs" | "weight">[], choices?: GenerationChoices | null): Framing | null {
  const picked = choices?.framings[role.id];
  return role.framings.find((f) => f.id === picked) ?? recommendFraming(role, jobTitle, requirements);
}

/** How bullets fall to roles that no requirement points at: more for the latest role, fewer for older ones. */
const RECENCY_SHARE = [5, 4, 3, 2, 2];

/**
 * Bullets for each role (most recent first), within the total, by how much each has to say for this job: its `demand`
 * is the number of its facts that answer the job or state a strong result. A fixed share for the latest role fitted one
 * resume and broke the next: a candidate whose second job is the relevant one, or who has one long role. A role gets at
 * most `cap` (the facts it offers) and never less than one, since it is part of the history; what is left over goes to
 * the roles with the most to say that still have room. With nothing matched anywhere, the latest roles get the most.
 */
export function shareBullets(roles: { demand: number; cap: number }[], total: number): number[] {
  if (roles.length === 0) return [];
  const asked = roles.reduce((n, r) => n + r.demand, 0);
  const demand = roles.map((r, i) => (asked > 0 ? r.demand : (RECENCY_SHARE[i] ?? 2)));
  const sum = demand.reduce((n, d) => n + d, 0);
  const caps = roles.map((r) => Math.max(1, r.cap));
  const exact = demand.map((d) => (total * d) / sum);
  const out = exact.map((x, i) => Math.min(caps[i], Math.max(1, Math.floor(x))));
  // Leftover bullets go by the largest share left unpaid, then by demand, to a role with room.
  for (let left = total - out.reduce((n, b) => n + b, 0); left > 0; left--) {
    const open = out.map((b, i) => i).filter((i) => out[i] < caps[i]);
    if (open.length === 0) break;
    const next = open.sort((a, b) => exact[b] - out[b] - (exact[a] - out[a]) || demand[b] - demand[a] || a - b)[0];
    out[next]++;
  }
  // The one-bullet floor can run past a small total: take back from the roles with least to say, oldest first.
  for (let over = out.reduce((n, b) => n + b, 0) - total; over > 0; over--) {
    const giving = out.map((b, i) => i).filter((i) => out[i] > 1);
    if (giving.length === 0) break;
    out[giving.sort((a, b) => demand[a] - demand[b] || b - a)[0]]--;
  }
  return out;
}

/** Most recent first; a role whose dates cannot be read goes last. */
function byRecency(a: { role: Role }, b: { role: Role }): number {
  const key = (r: Role) => {
    const span = toSpan(r);
    return span ? [span.to ?? Number.MAX_SAFE_INTEGER, span.from] : [-1, -1];
  };
  const [ta, fa] = key(a.role);
  const [tb, fb] = key(b.role);
  return tb - ta || fb - fa;
}

/**
 * What a requirement the user has reads as in a skills line: every technology of the job it names, in the job's order
 * ("Rails and TypeScript experience" gives Rails and TypeScript), or the keyword itself when the job means it as a skill.
 * A name inside a longer one it also names ("React" in "React Native") is left out. A field ("Books apps") or a way of
 * working ("Adaptability") is never a skill.
 */
export function skillTerms(r: Pick<Requirement, "text" | "kind" | "use">, technologies: string[]): string[] {
  const key = normalizeText(r.text);
  const named = [...new Set(technologies)].filter((t) => normalizeText(t) && containsPhrase(key, normalizeText(t)));
  const own = named.filter((t) => !named.some((other) => other.length > t.length && containsPhrase(normalizeText(other), normalizeText(t))));
  if (own.length > 0) return own;
  if (requirementUse(r) !== "skill") return [];
  return r.kind === "keyword" || r.text.split(/\s+/).length <= 2 ? [r.text] : [];
}

const limitFor = (instructions: GenerationInstructions | null | undefined, name: RegExp) => instructions?.sectionLimits.find((l) => name.test(l.section));

/** Facts with the strongest proof a role always offers the writer, whatever they answer of the job. */
const STRONGEST_KEPT = 2;

/**
 * The clause of a line that proves the most: a line joining two results with a semicolon ("3x traffic from the
 * migration; 36% fewer tickets with a chatbot") holds two achievements, and a summary sentence carries one.
 */
export function strongestClause(text: string): string {
  const clauses = text.split(/;\s+/).map((c) => c.trim()).filter(Boolean);
  return clauses.length <= 1 ? text.trim() : [...clauses].sort((a, b) => proofStrength(b) - proofStrength(a))[0];
}

/**
 * The result a summary sentence carries, without the method: "Increased user activation by 45% by owning the
 * onboarding redesign" from a line that goes on to list the interviews, funnels and tools behind it. Given the whole
 * line, the writer copied the bullet into the summary. A line whose result is not before its colon is kept whole.
 */
export function resultClause(text: string): string {
  const clause = strongestClause(text);
  const colon = clause.indexOf(": ");
  const head = colon > 0 ? clause.slice(0, colon) : "";
  return numbersIn(head).length > 0 && proofStrength(head) >= 2 ? head : clause;
}

/** The roles a resume is written from: the most recent ones that have something to say, with their employer. */
export function recentRoles(record: CareerRecord): { employer: string; role: Role }[] {
  return record.employers
    .flatMap((e) => e.roles.map((role) => ({ employer: e.name, role })))
    .filter((c) => c.role.facts.length > 0)
    .sort(byRecency)
    .slice(0, MAX_ROLES);
}

/**
 * What the model may draw on, chosen by code. For each of the most recent roles: the framing the user chose or the one
 * that fits the job, and only the facts that have wording for it (a role told both as engineering and as product keeps
 * its engineering facts for an engineering job), ranked by what they answer of the job and how much they prove, with the
 * wording that carries the result first. Plus the projects that answer the job, the skills and certifications with
 * repeats and broken brackets mended, the education a resume carries, and what the user says they have.
 */
export function planWriting(
  record: CareerRecord,
  job: Pick<JobInput, "title"> & Partial<Pick<JobInput, "technologies" | "location">>,
  requirements: Requirement[],
  instructions?: GenerationInstructions | null,
  choices?: GenerationChoices | null,
): WritingPlan {
  const experience = limitFor(instructions, /experience|work/i);
  const totalBullets = experience?.maxBullets ?? DEFAULT_TOTAL_BULLETS;
  const bulletChars = experience?.maxChars ?? DEFAULT_BULLET_CHARS;

  const weightOf = factWeigher(requirements);
  const coreOf = factWeigher(requirements.filter((r) => r.core));

  const chosen = recentRoles(record);

  // A technology the job names only inside a sentence is the candidate's when the record says it.
  const items = indexSource(record);
  const terms = jobTerms({ technologies: job.technologies ?? [] }, requirements, (key) => items.some((i) => containsPhrase(i.normalized, key)));
  // Of a fact's wordings, the one that says the most of what the job asks for comes first: the model starts from it.
  const wantedWords = tokens([...terms, ...askedFor(requirements).map((r) => r.text)].join(" "));
  const fitScore = (text: string) => [...tokens(text)].filter((t) => wantedWords.has(t)).length;

  let factN = 0;
  // Every fact offered, with its strongest wording and how well it would lead the summary.
  const leads: { alias: string; text: string; proof: number; score: number }[] = [];
  const told = chosen.map(({ employer, role }) => {
    const framing = chosenFraming(role, job.title, requirements, choices);
    const readFacts = (strict: boolean) =>
      role.facts
        .map((f, order) => {
          const bullets = bulletWordings(role, f, null);
          const fitting = framing ? bulletWordings(role, f, framing.id) : bullets;
          // Where the record disagrees with itself, the wording the user picked comes first and the ones that give the
          // other number are left out; then the wording that says the most of what the job asks for and proves the most.
          const picked = choices?.wordings[f.id];
          const pickedText = f.wordings.find((w) => w.id === picked)?.text;
          const agrees = (w: { text: string }) => !pickedText || !wordingsConflict(pickedText, w.text);
          // A fact matched to the job's core is offered whatever telling its wording belongs to: the one line that shows
          // daily agentic coding was written for the product telling of a role being written as engineering.
          const offered = (strict && coreOf(f.id) === 0 ? fitting : fitting.length > 0 ? fitting : bullets).filter(agrees);
          const pickedWording = f.wordings.find((w) => w.id === picked && w.form === "bullet");
          const ranked = (pickedWording && !offered.includes(pickedWording) ? [pickedWording, ...offered] : offered)
            .map((w, n) => ({ w, n, score: fitScore(w.text) + proofStrength(w.text) }))
            .sort((a, b) => Number(b.w.id === picked) - Number(a.w.id === picked) || b.score - a.score || a.n - b.n)
            .slice(0, TEXTS_PER_FACT);
          const proof = Math.max(0, ...ranked.map(({ w }) => proofStrength(w.text)));
          return { factId: f.id, texts: ranked.map(({ w }) => clipAtSentence(w.text, WORDING_CHARS)), weight: weightOf(f.id), core: coreOf(f.id), proof, order };
        })
        .filter((f) => f.texts.length > 0);
    // A role none of whose facts fit the framing is still part of the history, so it falls back to all of its wording.
    const picked = readFacts(true).length > 0 ? readFacts(true) : readFacts(false);
    // Ranked by what a fact answers of the job and how much it proves, so a measured result is never lost to a line that
    // only names the right things; the role's strongest proof is offered whatever it answers.
    const ranked = [...picked].sort((a, b) => b.weight + b.proof - (a.weight + a.proof) || a.order - b.order);
    return { employer, role, framing, picked, ranked };
  });
  const budget = shareBullets(
    told.map((r) => ({ demand: r.ranked.filter((f) => f.weight > 0 || f.proof >= STRONG_PROOF).length, cap: r.ranked.length })),
    totalBullets,
  );
  const roles: PlanRole[] = told.map(({ employer, role, framing, picked, ranked }, i) => {
    const kept = ranked.slice(0, Math.max(6, budget[i] * 2));
    const strongest = [...picked].sort((a, b) => b.proof - a.proof || a.order - b.order).slice(0, STRONGEST_KEPT);
    for (const strong of strongest) {
      if (!kept.includes(strong)) kept.push(strong);
    }
    // The strongest measured results the role's bullets have room for are marked to keep: left to the writer, the 3x
    // traffic result gave way to a bullet chosen to carry a job term.
    const keep = new Set(strongest.filter((f) => f.proof >= STRONG_PROOF).slice(0, budget[i]).map((f) => f.factId));
    const facts: PlanFact[] = kept.map((f) => {
      const alias = `f${++factN}`;
      const strongest = [...f.texts].sort((a, b) => proofStrength(b) - proofStrength(a))[0];
      leads.push({ alias, text: strongest, proof: f.proof, score: 2 * f.core + f.weight + f.proof });
      return { alias, factId: f.factId, texts: f.texts, weight: f.weight, proof: f.proof, keep: keep.has(f.factId) };
    });
    return {
      alias: `e${i + 1}`,
      roleId: role.id,
      employer,
      title: framing?.title || "",
      start: role.start,
      end: role.end,
      current: role.current,
      location: role.location,
      facts,
      budget: budget[i],
    };
  });

  // A project is chosen for the requirements it answers (found by matching) and for how much of the job's wording it
  // contains, so a long write-up is not at a disadvantage against a short one.
  const wanted = tokens(requirements.filter((r) => r.kind === "must" || r.kind === "nice").map((r) => r.text).join(" "));
  const contained = (p: CareerRecord["projects"][number]) => {
    if (wanted.size === 0) return 0;
    const own = tokens([p.name, p.description, p.technologies.join(" "), ...p.wordings.map((w) => w.text)].join(" "));
    return [...wanted].filter((t) => own.has(t)).length / wanted.size;
  };
  const projects: PlanProject[] = record.projects
    .map((p) => ({ p, weight: weightOf(p.id), share: contained(p) }))
    .filter((x) => x.weight > 0 || x.share > 0)
    .sort((a, b) => b.weight - a.weight || b.share - a.share)
    .slice(0, MAX_PROJECTS)
    .map(({ p }, i) => ({
      alias: `p${i + 1}`,
      projectId: p.id,
      name: p.name,
      description: p.description,
      url: p.url,
      technologies: p.technologies,
      // The wordings that prove the most come first: of fourteen for one project, the first three were its plans
      // ("a customer validation plan") and the one with its 248 tests and the bug they caught was never offered.
      texts: p.wordings
        .map((w, n) => ({ text: w.text, n, score: fitScore(w.text) + proofStrength(w.text) }))
        .sort((a, b) => b.score - a.score || a.n - b.n)
        .slice(0, PROJECT_TEXTS)
        .map((w) => clipAtSentence(w.text, WORDING_CHARS)),
    }));

  // The company's own values are its words, for tone: never something the candidate is said to have. A note the user
  // added to something the record already shows is detail to prove it with, so it is worked in the same way. A claim
  // with a note is proven in a bullet, so it reaches the skills lines only through a named technology it names ("Video
  // streaming" with a note about LiveKit is work, not a skill); one with no note has only the skills lines, as written.
  const technologies = new Set(job.technologies ?? []);
  const users: PlanUser[] = requirements
    .filter((r) => (r.userHas || (r.verdict === "met" && r.note.trim() !== "")) && r.kind !== "company" && r.use !== "logistics" && !isInterest(r))
    .map((r, i) => {
      const bare = r.note.trim() === "";
      const named = skillTerms(r, job.technologies ?? []);
      return { alias: `u${i + 1}`, requirementId: r.id, text: r.text, note: r.note, skills: (bare ? named : named.filter((t) => technologies.has(t) && isNamed(t))).map(balanceBrackets), bare, weight: r.weight };
    });

  // The summary leads with a result, so a fact that states one wins over one that only answers more of the job: a line
  // that owns internal tools end to end answers many requirements and proves none of them with a number.
  const results = leads.filter((l) => l.proof >= STRONG_PROOF);
  const best = [...(results.length > 0 ? results : leads)].sort((a, b) => b.score - a.score)[0];
  const summaryProof = best ? { alias: best.alias, text: resultClause(best.text) } : null;
  const skillIds = new Set(record.skills.map((s) => s.id));
  const offeredText = normalizeText(
    [...roles.flatMap((r) => r.facts.flatMap((f) => f.texts)), ...projects.flatMap((p) => [p.description, ...p.texts]), ...users.map((u) => u.note)].join(" "),
  );
  // A term counts as mentioned when a line has it (see `mentionsTerm`), or when it is something the candidate gave a
  // note on, which a bullet proves.
  const claimed = new Set(users.filter((u) => !u.bare).map((u) => normalizeText(u.text)));
  const mentioned = (t: string) => claimed.has(normalizeText(t)) || mentionsTerm(offeredText, t);
  const listedOnly = terms.filter((t) => normalizeText(t) && !mentioned(t));
  const shownBySkills = (r: Requirement) => r.verdict !== "missing" && r.refs.length > 0 && r.refs.every((ref) => skillIds.has(ref)) && !mentioned(r.text);
  const skills = composeSkills(
    record.skills.map((s) => ({ name: s.name, category: s.category })),
    skillWanted(terms, askedFor(requirements).map((r) => r.text)),
    users.flatMap((u) => u.skills),
  );

  const seenWin = new Set<string>();
  const achievements: PlanAchievement[] = record.achievements
    .filter((a) => a.text.trim() && !seenWin.has(normalizeText(a.text)) && !!seenWin.add(normalizeText(a.text)))
    .map((a, i) => ({ alias: `a${i + 1}`, id: a.id, text: a.text.trim() }));

  return {
    roles,
    projects,
    skills,
    certifications: uniqueCertifications(record.certifications).map((c, i) => ({ alias: `c${i + 1}`, id: c.id, name: c.name, issuer: c.issuer, date: c.date })),
    users,
    achievements,
    interests: requirements.filter((r) => r.userHas && isInterest(r)).map((r) => ({ requirementId: r.id, text: r.text, note: r.note })),
    // With the user's note, which says how the condition is met ("relocating to Toronto"): the job's text alone does not.
    mentions: requirements.filter((r) => r.use === "logistics" && r.userHas).map((r) => (r.note.trim() ? `${r.text} (their note: ${r.note.trim()})` : r.text)),
    jobLocation: (job.location ?? "").trim(),
    conditionNotes: requirements.filter((r) => r.use === "logistics" && r.userHas && r.note.trim()).map((r) => r.note.trim()),
    education: pickEducation(record.education),
    terms,
    listedOnly,
    skillsOnly: requirements.filter(shownBySkills).map((r) => r.id),
    summaryProof,
    totalBullets,
    bulletChars,
  };
}

/**
 * A bullet that only has text, also accepted as the bare text. The writer asks for its JSON in the prompt (GLM-5.3 does
 * not think under structured outputs), which holds the model to the shape less strictly: once it wrote project bullets
 * as plain strings, and the whole draft was thrown away and written again. The prompt's schema still shows the object.
 */
const asObject = <T extends z.ZodType>(schema: T) => z.preprocess((v) => (typeof v === "string" ? { text: v } : v), schema);
/** A list the model may leave out, read as empty. */
const list = <T extends z.ZodType>(item: T) => z.array(item).default([]);

/**
 * The schema for one call. It is lenient on purpose: a draft costs minutes of thinking, and a strict schema threw whole
 * drafts away over one bullet past its length or one list sent as text. An id that was never offered, a list longer than
 * asked or a field left out is dealt with by `readWriting`, which drops what was not offered and cuts lists to size; a
 * bullet or summary past its length is flagged by the code checks for the revision to shorten.
 */
export function answerSchema(plan: WritingPlan) {
  const roles = plan.roles.map((r) => r.alias).join(", ");
  const projects = plan.projects.map((p) => p.alias).join(", ");
  const certifications = plan.certifications.map((c) => c.alias).join(", ");
  return z.object({
    summary: z.string(),
    // Its own field, so the summary's sentences cannot crowd it out: written when the user asked for a mention.
    mention: z.string().optional(),
    roles: list(
      z.object({
        role: z.string().describe(roles ? `One of ${roles}` : "A role id"),
        bullets: list(asObject(z.object({ facts: list(z.string()).describe("The ids it was written from"), text: z.string() }))),
      }),
    ),
    projects: list(
      z.object({
        project: z.string().describe(projects ? `One of ${projects}` : "A project id"),
        bullets: list(asObject(z.object({ facts: z.array(z.string()).optional().describe('The "u" ids it proves, if any'), text: z.string() }))),
      }),
    ),
    certifications: list(z.string().describe(certifications ? `One of ${certifications}` : "A certification id")),
    // Only read when the user gave interests; empty otherwise.
    interests: z.string().optional(),
  });
}
export type WriterAnswer = z.infer<ReturnType<typeof answerSchema>>;

export type WrittenBullet = {
  text: string;
  /** Record fact ids it was written from. */
  factIds: string[];
  /** Requirement ids of "I have this" items worked into it. */
  userRequirementIds: string[];
  /** How much of what the job asks for it answers. */
  relevance: number;
};
/** `fromRecord`: the draft left the role out, so it holds the role's strongest facts as the candidate worded them. */
export type WrittenRole = { plan: PlanRole; bullets: WrittenBullet[]; fromRecord?: boolean };
export type WrittenProject = { plan: PlanProject; bullets: WrittenBullet[] };
export type WrittenResume = {
  summary: string;
  roles: WrittenRole[];
  projects: WrittenProject[];
  skills: { category: string; items: string[] }[];
  certifications: PlanCertification[];
  achievements: string[];
  /** One short line about the candidate outside work, from what they ticked and their notes, or "" for none. */
  interests: string;
  education: Education[];
  /**
   * How the candidate meets the job's conditions, in their words ("Open to relocating to Toronto"), for the header next
   * to the contact details, where a reviewer looks for it. Empty when there is none, or when it is too long for the
   * header and closes the summary instead.
   */
  mention?: string;
  /** The job sets a location: a header that gives only a way of working ("Remote") then answers nothing. */
  locationAsked?: boolean;
};

/** The longest mention that goes in the header; a longer one closes the summary. */
export const HEADER_MENTION_CHARS = 70;

/**
 * The line on how the candidate meets the job's conditions, held to their own note: a place or other name the note does
 * not have is never written. Given the note "I can work remotely" for a job in "Canada, Remote", the writer put "In
 * Canada; can work remotely" in the header of a candidate in India. A line that adds a name gives way to the note itself,
 * without "I" ("Can work remotely"); with no note, the line stands, since a tick with nothing said meets the condition
 * as the job states it.
 */
export function headerMention(written: string, notes: string[]): string {
  const line = tidy(written).replace(/[.!]+$/, "");
  if (notes.length === 0) return line;
  const said = normalizeText(notes.join(" "));
  const added = namesIn(line).filter((n) => !containsPhrase(said, normalizeText(n)));
  if (line && added.length === 0) return line;
  const own = tidy(notes[0])
    .replace(/^i(?:'m| am)?\s+/i, "")
    .replace(/[.!]+$/, "");
  return own ? own[0].toUpperCase() + own.slice(1) : "";
}

/** Wording the model wrote, tidied: no list markers, one space, and a plain hyphen for any long dash. */
export function tidy(text: string): string {
  return text
    .replace(/^\s*[-*•·]\s+/, "")
    .replace(/\s*[—–]\s*/g, " - ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * A job term that names an area of work rather than a tool ("Video streaming", "Realtime voice agents") written in
 * lowercase inside a sentence: told to use the job's terms as written, the writer kept their capitals mid-sentence.
 * Names (Claude Code, MCP) and acronyms (the "AI" of "AI agents") keep theirs.
 */
export function inSentenceCase(text: string, terms: string[]): string {
  let out = text;
  for (const term of terms) {
    if (isNamed(term)) continue;
    const lowered = term
      .split(" ")
      .map((w) => (/^[A-Z][a-z]+$/.test(w) ? w.toLowerCase() : w))
      .join(" ");
    if (lowered === term) continue;
    const pattern = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
    out = out.replace(pattern, (found, at: number) => (at === 0 || /[.!?]\s*$/.test(out.slice(0, at)) ? found : lowered));
  }
  return out;
}

/** A bullet's text, tidied and without a closing full stop, so every bullet on the page ends the same way. */
export const bulletText = (text: string): string => tidy(text).replace(/(?<![.]{2})\.$/, "");

/**
 * A project bullet without the bracketed list of the project's own technologies ("platform (Next.js, TypeScript,
 * PostgreSQL) that..."): the Technologies line above the bullets already says it. A bracket that names mostly other
 * things is kept.
 */
export function withoutRepeatedStack(text: string, technologies: string[]): string {
  if (technologies.length === 0) return text;
  const stack = new Set(technologies.flatMap((t) => normalizeText(t).split(" ")));
  return text
    .replace(/\s*\(([^()]{3,200})\)/g, (whole, inside: string) => {
      const items = inside.split(/,|\band\b/).map((i) => normalizeText(i)).filter(Boolean);
      const known = items.filter((i) => i.split(" ").every((w) => stack.has(w) || w.length <= 2));
      return items.length >= 3 && known.length / items.length >= 0.6 ? "" : whole;
    })
    .replace(/\s+([,;:.])/g, "$1")
    .trim();
}

/**
 * The offered item a reference in the answer means: by its id, or else by its name, which the model sometimes writes
 * instead ("Job Search OS" for p1, "AWS Certified AI Practitioner" for c3). Read by id only, every project and
 * certification of one draft was silently dropped.
 */
export function offered<T extends { alias: string }>(ref: string, items: T[], names: (item: T) => string[]): T | undefined {
  const byAlias = items.find((i) => i.alias === ref.trim());
  if (byAlias) return byAlias;
  const key = normalizeText(ref);
  if (!key) return undefined;
  const exact = items.find((i) => names(i).some((n) => normalizeText(n) === key));
  if (exact) return exact;
  // The whole name inside what was written ("Job Search OS platform"), or two or more words of it: one word ("Cloud")
  // says too little.
  const several = key.split(" ").length >= 2;
  const close = items.filter((i) => names(i).some((n) => normalizeText(n) && (containsPhrase(key, normalizeText(n)) || (several && containsPhrase(normalizeText(n), key)))));
  return close.length === 1 ? close[0] : undefined;
}
const roleNames = (r: PlanRole) => [r.employer, `${r.title} at ${r.employer}`];
const projectNames = (p: PlanProject) => [p.name, p.name.split(/\s+-\s+|:\s+/)[0]];
const certificationNames = (c: PlanCertification) => [c.name, `${c.name}, ${c.issuer}`];

/**
 * Turns the model's answer into a resume. Roles come out in the plan's order, whatever order the model gave; a role it
 * left out keeps its two strongest facts as they were worded, so history is never silently missing; a repeated bullet
 * is dropped; and ids it was never given are ignored (the schema already refuses them).
 */
export function readWriting(answer: WriterAnswer, plan: WritingPlan): WrittenResume {
  const factByAlias = new Map(plan.roles.flatMap((r) => r.facts).map((f) => [f.alias, f]));
  const userByAlias = new Map(plan.users.map((u) => [u.alias, u]));

  // At most two facts and two claims a bullet: ids it was never given are ignored.
  const bulletOf = (text: string, aliases: string[]): WrittenBullet => {
    const facts = aliases.map((a) => factByAlias.get(a)).filter((f): f is PlanFact => !!f).slice(0, 2);
    const users = aliases.map((a) => userByAlias.get(a)).filter((u): u is PlanUser => !!u).slice(0, 2);
    const relevance = facts.reduce((n, f) => n + f.weight, 0) + users.reduce((n, u) => n + u.weight, 0);
    return {
      text: inSentenceCase(bulletText(text), plan.terms),
      factIds: facts.map((f) => f.factId),
      userRequirementIds: users.map((u) => u.requirementId),
      relevance,
    };
  };
  const unique = (bullets: WrittenBullet[]) => {
    const seen = new Set<string>();
    return bullets.filter((b) => b.text && !seen.has(normalizeText(b.text)) && seen.add(normalizeText(b.text)));
  };

  // A bullet tied to nothing it was given cannot be checked against the record, so it is dropped.
  const tied = (b: WrittenBullet) => b.text.length >= MIN_BULLET_CHARS && b.factIds.length + b.userRequirementIds.length > 0;
  const roles: WrittenRole[] = plan.roles.map((p) => {
    const given = (answer.roles.find((r) => offered(r.role, plan.roles, roleNames) === p)?.bullets ?? []).map((b) => bulletOf(b.text, b.facts)).filter(tied);
    const bullets =
      given.length > 0 ? given : p.facts.slice(0, 2).map((f) => ({ text: bulletText(f.texts[0]), factIds: [f.factId], userRequirementIds: [], relevance: f.weight }));
    // The model's order is kept: it was asked to lead with what proves the job's core, and a sum of weights cannot tell
    // which bullet does (a bullet citing two facts outranked the one that answered the job's first ask). A line split
    // into two stories gives a second bullet from the same fact, which does not take another fact's place: up to
    // MAX_SPLITS of them are on top of the count.
    const kept = unique(bullets);
    const splits = kept.filter((b, i) => b.factIds.length > 0 && kept.slice(0, i).some((e) => b.factIds.every((id) => e.factIds.includes(id)))).length;
    return { plan: p, bullets: kept.slice(0, p.budget + Math.min(splits, MAX_SPLITS)), ...(given.length === 0 ? { fromRecord: true } : {}) };
  });

  const projects: WrittenProject[] = [];
  for (const g of answer.projects) {
    const p = offered(g.project, plan.projects, projectNames);
    if (!p || projects.some((x) => x.plan === p) || projects.length >= MAX_PROJECTS) continue;
    // A project bullet may prove something the candidate said they have ("MCP", with a note on the MCP server they
    // built): without the claim tied to it, the check took the bullet for a rewrite and put the project's first line back.
    // A bullet that names such a claim without citing it is tied to it all the same.
    const bullets = g.bullets.map((b) => {
      const text = inSentenceCase(withoutRepeatedStack(bulletText(b.text), p.technologies), plan.terms);
      const cited = (b.facts ?? []).map((a) => userByAlias.get(a)).filter((u): u is PlanUser => !!u);
      const named = plan.users.filter((u) => !u.bare && !cited.includes(u) && containsPhrase(normalizeText(text), normalizeText(u.text)));
      return { text, factIds: [p.projectId], userRequirementIds: [...cited, ...named].slice(0, 2).map((u) => u.requirementId), relevance: 1 };
    });
    projects.push({ plan: p, bullets: unique(bullets.filter((b) => b.text.length >= MIN_BULLET_CHARS)).slice(0, PROJECT_BULLETS) });
  }

  const certs = answer.certifications.map((a) => offered(a, plan.certifications, certificationNames)).filter((c): c is PlanCertification => !!c);
  const summary = inSentenceCase(tidy(answer.summary), plan.terms);
  const mention = plan.mentions.length > 0 ? headerMention(answer.mention ?? "", plan.conditionNotes) : "";
  const inHeader = mention !== "" && mention.length <= HEADER_MENTION_CHARS;
  return {
    summary: inHeader || mention === "" ? summary : withMention(summary, mention, plan.mentions),
    mention: inHeader ? mention : "",
    locationAsked: plan.jobLocation !== "",
    roles,
    projects,
    skills: plan.skills.map((l) => ({ ...l, items: [...l.items] })),
    certifications: [...new Map(certs.map((c) => [c.id, c])).values()].slice(0, MAX_CERTIFICATIONS),
    // Wins (a hackathon, an award) are among the strongest signals a resume has, so every one goes on, not the model's pick.
    achievements: plan.achievements.slice(0, MAX_ACHIEVEMENTS).map((a) => a.text),
    // Never an interest the user did not give: with none ticked, whatever the model wrote is dropped.
    interests: plan.interests.length > 0 ? bulletText(answer.interests ?? "") : "",
    education: plan.education,
  };
}

/**
 * The conditions the user asked to mention ("willing to relocate") that the summary does not mention. A condition counts
 * as mentioned when the summary has one of its longer words, or a word that starts the same way ("relocating" for
 * "relocate").
 */
export function missingMentions(summary: string, mentions: string[]): string[] {
  const said = normalizeText(summary).split(" ");
  return mentions.filter((m) => {
    const key = normalizeText(m).split(" ").filter((w) => w.length >= 6 && w !== "willing");
    return key.length > 0 && !key.some((k) => said.some((w) => w.startsWith(k.slice(0, 6))));
  });
}

/** The summary closed by the mention line, unless there is nothing to mention or the summary already says it. */
export function withMention(summary: string, mention: string, mentions: string[]): string {
  const line = tidy(mention);
  if (mentions.length === 0 || !line || missingMentions(summary, mentions).length === 0) return summary;
  const end = (text: string) => (/[.!?]$/.test(text) ? text : `${text}.`);
  return summary ? `${end(summary)} ${end(line)}` : end(line);
}

/** Phrases that read as written by a machine or a student, beyond the ones the cold-email rules already ban. */
export const RESUME_BANNED_EXTRA = ["next stage of my career", "where all of this comes together", "the combination of", "the work I enjoy most", "I'd welcome the opportunity", "results-driven"];

/** Wording the style rules rule out, listed so the model can be asked to write it again. */
export function checkWriting(w: WrittenResume): string[] {
  const text = [w.summary, ...w.roles.flatMap((r) => r.bullets.map((b) => b.text)), ...w.projects.flatMap((p) => p.bullets.map((b) => b.text))].join("\n");
  return findBanned(text, RESUME_BANNED_EXTRA);
}

/**
 * What the writer is told. Kept short on purpose: each rule here is something the model weighs against every line while
 * it thinks, and as rules were added a draft's thinking grew from about 6,000 tokens to past 32,000 and ran out of room.
 * What code decides or checks (the skills section, names and dates, new numbers, copied posting wording, overused terms)
 * is said once or not at all: the code checks find it and the revision fixes it.
 */
export const SYSTEM = `You edit a candidate's own resume lines into a resume for a specific job. You are an editor, not a writer: the candidate wrote every line in their career record, and a hiring manager should hear the candidate, not a model. The candidate is qualified for this job: what it asks for that the record does not show is experience not yet written down, not a gap. Under "WHAT THE JOB ASKS FOR", prove the [Core] requirements first and the rest where the candidate's lines support them; what is "in the skills list only" is shown by the skills section, and no bullet has to prove it.
Editing:
- Start from the first wording given for each fact, word for word, and change only what this job needs: the posting's spelling of a tool or term, working in what the candidate says they have, cutting what does not matter here, moving what matters most to the front. A line that already works stays as it is.
- Lead with the result when the line states one, by moving the candidate's own clauses ("Increased user activation by 45% by rebuilding onboarding..."). Cut words that add tone and no evidence ("ruthlessly", "from first principles").
- Keep every name (tools, systems, products, customers, teams) and every number exactly as written; never replace a name with a category. Never add a number, or a result, purpose or benefit the candidate did not write ("so that", "enabling", "ensuring"). Never invent an employer, title, degree, certification, interest or hobby.
- One story per bullet: the problem or decision, what was built, and what came of it. A line that joins separate pieces of work (two results joined by a semicolon, or a list of separate systems) gives two bullets, each citing that fact, or keeps the one that matters for this job; such a second bullet does not count toward the role's bullets.
- Each bullet names in "facts" the ids it was written from, only ids you were given: the fact it tells, plus the "u" items it proves; a second fact only for the same piece of work.
What the candidate says they have (it is true; prove it, never question it):
- Under "THE CANDIDATE SAYS THEY HAVE THIS": show it as work done, in a bullet of the role or project their note places it in, told with its real product, tools and team and the specifics of their note. Extend the bullet it builds on or add one there, citing its u id (with the fact's id in a role). Never as a label in front of a sentence ("On realtime voice agents, built..."), and never with a number they did not give.
- Under "ALSO TRUE, NO DETAIL GIVEN": it is already in the skills section. Name it in a bullet only where that bullet's own lines describe that work; never a bullet of its own, never the summary, never in place of a fact.
Fitting the job:
- The terms under "JOB TERMS" are tools and skills the candidate has: use each in the line about the work that used it, about once. Never move one into a line about other work ("Claude Code" does not go in a line about a product's logging layer). The terms under "IN THE SKILLS SECTION ONLY" are already listed there and no line of the candidate's mentions them: leave them out of the bullets and the summary. Write an acronym out once, then the short form.
- Speak the posting's language, discreetly: where a fact is the work the posting describes, use the posting's own short phrases for it (up to four words: "production systems", "exposing APIs", "customer conversations") inside the candidate's sentence. Never copy its sentences or restate a responsibility as "I do X".
- The company's field may frame the summary in a few words and appears nowhere else. A way of working under "SHOW, DO NOT NAME" is shown by what was done, never named.
- Be thorough on purpose: the bullets that answer [Core] requirements keep their full detail (what was built, with which tools, for whom, the decision behind it, the result, and how it was checked when the line says so: tests, evals, an accuracy number, an approval step); the rest keep what matters for this job. Use the bullet counts given.
- The first bullet of each recent role proves a [Core] requirement with the strongest result the role has for it; the order you give is the order printed. A fact marked [keep] is one of the role's strongest results: it always gets a bullet, and a job term or claim never takes its place. Vary how sentences start and run.
- A project's technologies are printed above its bullets: never list them in a bullet. A project bullet says what was built and what came of it (users, tests, results), not a plan, when its lines give both.
The summary: up to three sentences. What kind of professional the candidate is, in plain words (never the posting's title), with the stack their bullets show; the result under "SUMMARY PROOF", in one clause of your own (the result and the work it came from, never the method list or a bullet's sentence), its numbers exactly as written and nothing from another line joined to it, with what they built and ran that answers the [Core] requirements; how they work, only from a note of the candidate's or a line of theirs that describes how they work, and with neither, no such sentence at all rather than a general one. Name only tools and work the bullets show or the candidate's notes give. Not a list of tools, and never the company's name or mission. What is under "MENTION BRIEFLY" goes in "mention" as a few words, not in the summary; with nothing there, leave "mention" out.
"interests": one short line from what is under "INTERESTS" and its notes only; with nothing there, leave it out.
No first person, filler, long dashes or runs of three adjectives. Names, titles, dates, schools, skills and achievements are filled in by code; you only choose which certifications to show.`;

/** The requirements the candidate can stand behind and that are for the resume: not a condition, not a field or a way of working, and not a gap the user left unticked. */
export function askedFor(requirements: Requirement[]): Requirement[] {
  return requirements.filter((r) => {
    if (r.kind === "company" || r.use === "logistics") return false;
    if (r.kind === "keyword") return requirementUse(r) === "skill" && (r.verdict === "met" || r.userHas);
    return r.verdict !== "missing" || r.userHas;
  });
}

/** What the model is asked, as text: the job, what it asks for, and the candidate by id. */
export function buildPrompt(plan: WritingPlan, job: JobInput, requirements: Requirement[], instructions?: GenerationInstructions | null): { system: string; user: string } {
  const listed = new Set(plan.skillsOnly);
  const where = (r: Requirement) =>
    r.userHas ? ", the candidate has this" : r.verdict === "missing" ? "" : listed.has(r.id) ? ", in the skills list only" : r.verdict === "met" ? ", in the record" : ", partly in the record";
  const reqLine = (r: Requirement) => `${r.id} [${r.core ? "Core, " : ""}${REQUIREMENT_KIND_LABEL[r.kind]}${where(r)}]: ${r.text}`;
  const dates = (r: PlanRole) => [r.start, r.current ? "Present" : r.end].filter(Boolean).join(" - ");

  const fields = requirements.filter((r) => r.kind === "keyword" && requirementUse(r) === "domain").map((r) => r.text);
  const traits = requirements.filter((r) => r.use === "trait").map((r) => r.text);
  const values = requirements.filter((r) => r.kind === "company").map((r) => r.text);
  const company = [
    fields.length ? `Field: ${fields.slice(0, 6).join(", ")}` : "",
    job.aboutCompany ? `About the company: ${clip(job.aboutCompany, 400)}` : "",
    values.length ? `What it values: ${values.join("; ")}` : "",
  ].filter(Boolean);

  const listedOnly = new Set(plan.listedOnly);
  const terms = plan.terms.filter((t) => !listedOnly.has(t));
  const sections = [
    `THE JOB\n${job.title} at ${job.company}${job.location ? `, ${job.location}` : ""}${job.responsibilities.length ? `\nResponsibilities (for understanding the role, never to be copied):\n${job.responsibilities.slice(0, 8).map((r) => `- ${clip(r, 200)}`).join("\n")}` : ""}`.trim(),
    `WHAT THE JOB ASKS FOR\n${askedFor(requirements).map(reqLine).join("\n")}`,
    terms.length > 0 ? `JOB TERMS (use them exactly as written, the first ones matter most)\n${terms.join(", ")}` : "",
    plan.listedOnly.length > 0 ? `IN THE SKILLS SECTION ONLY (listed there already; no line of the candidate's mentions them)\n${plan.listedOnly.join(", ")}` : "",
    company.length > 0 ? `THE COMPANY (for tone and context only; never quote it, never name it in the resume)\n${company.join("\n")}` : "",
    traits.length > 0 ? `SHOW, DO NOT NAME\n${traits.join(", ")}` : "",
    `THE CANDIDATE'S ROLES (most recent first; each fact shows the candidate's own wording, the one to start from first)\n${plan.roles
      .map(
        (r) =>
          `${r.alias}: ${r.title || "Role"} at ${r.employer}, ${dates(r)}. Write up to ${r.budget} bullets.\n${r.facts.map((f) => `  ${f.alias}${f.keep ? " [keep]" : ""}: ${f.texts.map((t) => `"${t}"`).join(" | ")}`).join("\n")}`,
      )
      .join("\n")}`,
    plan.projects.length ? `PROJECTS (include every one, chosen for this job; up to 2 bullets each, the ones that prove the most)\n${plan.projects.map((p) => `${p.alias}: ${p.name}. ${p.description} ${p.technologies.length ? `Technologies: ${p.technologies.join(", ")}.` : ""} ${p.texts.map((t) => `"${t}"`).join(" | ")}`.trim()).join("\n")}` : "",
    plan.certifications.length ? `CERTIFICATIONS (pick the relevant ones)\n${plan.certifications.map((c) => `${c.alias}: ${c.name}${c.issuer ? `, ${c.issuer}` : ""}`).join("\n")}` : "",
    plan.interests.length ? `INTERESTS (the candidate's own; write "interests" from these and their notes only)\n${plan.interests.map((i) => `${i.text}${i.note ? ` (their note: ${i.note})` : ""}`).join("\n")}` : "",
    plan.mentions.length ? `MENTION BRIEFLY (write "mention": a few words in the candidate's words, under ${HEADER_MENTION_CHARS} characters, for example "Open to relocating to San Francisco". It goes in the header, next to the contact details)\n${plan.mentions.join("\n")}` : "",
    plan.users.some((u) => !u.bare) ? `THE CANDIDATE SAYS THEY HAVE THIS\n${plan.users.filter((u) => !u.bare).map((u) => `${u.alias}: ${u.text} (their note: ${u.note})`).join("\n")}` : "",
    plan.users.some((u) => u.bare) ? `ALSO TRUE, NO DETAIL GIVEN\n${plan.users.filter((u) => u.bare).map((u) => `${u.alias}: ${u.text}`).join("\n")}` : "",
    plan.summaryProof ? `SUMMARY PROOF (the result the summary leads with, from ${plan.summaryProof.alias})\n${plan.summaryProof.text}` : "",
    `LENGTH\nAbout ${plan.totalBullets} bullets in all. The bullets that answer the [Core] requirements may use up to ${plan.bulletChars} characters; the others stay under about ${SUPPORT_BULLET_CHARS}. The summary stays under ${MAX_SUMMARY_CHARS} characters.${instructions?.tone ? ` Tone: ${instructions.tone}.` : ""}${instructions?.styleRules.trim() ? `\nThe candidate's own style rules: ${instructions.styleRules.trim()}` : ""}`,
  ];
  return { system: SYSTEM, user: sections.filter(Boolean).join("\n\n") };
}
