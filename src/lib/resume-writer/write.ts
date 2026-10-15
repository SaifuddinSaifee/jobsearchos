import { z } from "zod";
import { wordingFitsFraming } from "@/lib/career/framing";
import { pickEducation, uniqueCertifications } from "@/lib/career/dedupe";
import { guessAngle } from "@/lib/career/match";
import { balanceBrackets, normalizeText, skillKey, textSimilarity, titleSimilarity, tokens } from "@/lib/career/normalize";
import { toSpan } from "@/lib/career/dates";
import type { CareerRecord, Education, Framing, Role } from "@/lib/career/schema";
import { findBanned } from "@/lib/outreach/checks";
import type { GenerationInstructions } from "@/lib/profile/schema";
import { clip, containsPhrase, indexSource, jobTerms, type JobInput } from "./context";
import { REQUIREMENT_KIND_LABEL, requirementUse, type Requirement } from "./types";

// What the resume is written from, and how the model is asked. Code chooses what the model may draw on (which roles,
// which facts and which of their wordings, in what order, how many bullets) and the model edits the candidate's own
// wording for the job: it does not write new text. Everything it writes is tied back to the record by id: a bullet names
// the facts it came from, and employers, titles, dates, schools, certifications and achievements are filled in from the
// record by code, so the model never types any of them. The loop that writes, reviews and revises is in writer.ts.

export const DEFAULT_TOTAL_BULLETS = 14;
/** The longest a bullet may be. Most stay far shorter; the ones that answer the job's top requirements may use this much. */
export const DEFAULT_BULLET_CHARS = 420;
/** About how long the supporting bullets should stay, in characters. */
export const SUPPORT_BULLET_CHARS = 200;
export const MAX_ROLES = 5;
const MAX_PROJECTS = 2;
const MAX_ACHIEVEMENTS = 4;
const MAX_SKILLS_SHOWN = 80;
const TEXTS_PER_FACT = 2;
const WORDING_CHARS = 600;
const MAX_SUMMARY_CHARS = 400;
/** The closing line of the summary for the conditions the user asked to mention. */
const MAX_MENTION_CHARS = 200;
const MAX_INTERESTS_CHARS = 200;

/**
 * A must-have or nice-to-have that is about a field rather than work ("you're into fandom, reading or fanfiction"). When
 * the user ticks it, it is an interest of theirs: it goes in the Interests line, never in a bullet.
 */
export const isInterest = (r: Pick<Requirement, "kind" | "use">): boolean => (r.kind === "must" || r.kind === "nice") && r.use === "domain";

export type PlanFact = { alias: string; factId: string; texts: string[]; weight: number };
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
export type PlanSkill = { alias: string; text: string; category: string };
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
  /** How it reads in a skills line ("Kafka", not "Experience with Kafka"), or null when it is not a skill. */
  skill: string | null;
  /** How much the requirement counts toward the job, so a bullet that covers it ranks with the rest. */
  weight: number;
};

export type WritingPlan = {
  roles: PlanRole[];
  projects: PlanProject[];
  skills: PlanSkill[];
  certifications: PlanCertification[];
  users: PlanUser[];
  achievements: PlanAchievement[];
  /** What the user ticked about themselves outside work, for one short Interests line and nowhere else. */
  interests: PlanInterest[];
  /** Conditions of the job the user asked to mention ("willing to relocate"), for one short line of the summary. */
  mentions: string[];
  education: Education[];
  /** The tools and skills the job names that the candidate has, in the job's wording: what the resume is asked to use. */
  terms: string[];
  /** What the job asks for that the candidate has, in the job's wording and normalized, to put the matching skills first on each skills line. */
  jobTerms: string[];
  totalBullets: number;
  bulletChars: number;
};

/** The framing of a role that suits the job best: the same angle, then the closest title or target role. */
export function pickFraming(role: Role, jobTitle: string): Framing | null {
  if (role.framings.length <= 1) return role.framings[0] ?? null;
  const angle = guessAngle(jobTitle).toLowerCase();
  const score = (f: Framing) =>
    (angle && f.angle.toLowerCase() === angle ? 1 : 0) + Math.max(titleSimilarity(f.title, jobTitle), ...f.targetRoles.map((t) => titleSimilarity(t, jobTitle)), 0);
  return [...role.framings].sort((a, b) => score(b) - score(a))[0];
}

/**
 * Bullets for each role, most recent first: more for the latest role, fewer for older ones, within the total. A small
 * total shrinks every role in proportion; any leftover is taken from the oldest roles first. Never less than one.
 */
export function budgets(roleCount: number, total: number): number[] {
  const base = (roleCount <= 3 ? [5, 4, 3] : [5, 4, 3, 2, 2]).slice(0, roleCount);
  const sum = base.reduce((n, b) => n + b, 0);
  if (sum <= total) return base;
  const out = base.map((b) => Math.max(1, Math.round((b * total) / sum)));
  for (let i = out.length - 1; out.reduce((n, b) => n + b, 0) > total && out.some((b) => b > 1); i = i === 0 ? out.length - 1 : i - 1) {
    if (out[i] > 1) out[i]--;
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
 * What a requirement the user has reads as in a skills line: the technology it names, or the keyword itself when the job
 * means it as a skill. A field ("Books apps") or a way of working ("Adaptability") is never a skill.
 */
export function skillTerm(r: Pick<Requirement, "text" | "kind" | "use">, technologies: string[]): string | null {
  const key = normalizeText(r.text);
  const named = technologies.filter((t) => containsPhrase(key, normalizeText(t))).sort((a, b) => b.length - a.length)[0];
  if (named) return named;
  if (requirementUse(r) !== "skill") return null;
  return r.kind === "keyword" || r.text.split(/\s+/).length <= 2 ? r.text : null;
}

const limitFor = (instructions: GenerationInstructions | null | undefined, name: RegExp) => instructions?.sectionLimits.find((l) => name.test(l.section));

/** A line that lists tools ("Technologies: Python, SQL") is a skills line kept as a bullet, not something that was done. */
const isSkillsLine = (text: string) => /^\s*(technologies|tech stack|skills)\s*:/i.test(text);

/**
 * What the model may draw on, chosen by code. For each of the most recent roles: the framing that fits the job, and
 * only the facts that have wording for it (a role told both as engineering and as product keeps its engineering facts for
 * an engineering job), the ones that answer the most weighty requirements first. Plus the projects that answer the job,
 * the skills and certifications with repeats and broken brackets mended, the education a resume carries, and what the
 * user says they have.
 */
export function planWriting(record: CareerRecord, job: Pick<JobInput, "title"> & Partial<Pick<JobInput, "technologies">>, requirements: Requirement[], instructions?: GenerationInstructions | null): WritingPlan {
  const experience = limitFor(instructions, /experience|work/i);
  const totalBullets = experience?.maxBullets ?? DEFAULT_TOTAL_BULLETS;
  const bulletChars = experience?.maxChars ?? DEFAULT_BULLET_CHARS;

  const weightOf = (id: string) => requirements.filter((r) => r.refs.includes(id)).reduce((n, r) => n + r.weight, 0);

  const candidates = record.employers.flatMap((e) => e.roles.map((role) => ({ employer: e.name, role }))).filter((c) => c.role.facts.length > 0);
  const chosen = candidates.sort(byRecency).slice(0, MAX_ROLES);
  const budget = budgets(chosen.length, totalBullets);

  // A technology the job names only inside a sentence is the candidate's when the record says it.
  const items = indexSource(record);
  const terms = jobTerms({ technologies: job.technologies ?? [] }, requirements, (key) => items.some((i) => containsPhrase(i.normalized, key)));
  // Of a fact's wordings, the one that says the most of what the job asks for comes first: the model starts from it.
  const wantedWords = tokens([...terms, ...askedFor(requirements).map((r) => r.text)].join(" "));
  const fitScore = (text: string) => [...tokens(text)].filter((t) => wantedWords.has(t)).length;

  let factN = 0;
  const roles: PlanRole[] = chosen.map(({ employer, role }, i) => {
    const framing = pickFraming(role, job.title);
    const read = (strict: boolean) =>
      role.facts
        .map((f, order) => {
          const bullets = f.wordings.filter((w) => w.form === "bullet" && !isSkillsLine(w.text));
          const fitting = framing ? bullets.filter((w) => wordingFitsFraming(role, w, framing.id)) : bullets;
          const texts = (strict ? fitting : fitting.length > 0 ? fitting : bullets)
            .map((w, n) => ({ w, n, score: fitScore(w.text) }))
            .sort((a, b) => b.score - a.score || a.n - b.n)
            .slice(0, TEXTS_PER_FACT)
            .map(({ w }) => clip(w.text, WORDING_CHARS));
          return { factId: f.id, texts, weight: weightOf(f.id), order };
        })
        .filter((f) => f.texts.length > 0);
    // A role none of whose facts fit the framing is still part of the history, so it falls back to all of its wording.
    const picked = read(true).length > 0 ? read(true) : read(false);
    const facts: PlanFact[] = picked
      .sort((a, b) => b.weight - a.weight || a.order - b.order)
      .slice(0, Math.max(6, budget[i] * 2))
      .map((f) => ({ alias: `f${++factN}`, factId: f.factId, texts: f.texts, weight: f.weight }));
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
      texts: p.wordings.slice(0, 3).map((w) => clip(w.text, WORDING_CHARS)),
    }));

  const skillScore = (name: string) => (terms.map(normalizeText).some((t) => containsPhrase(t, normalizeText(name)) || containsPhrase(normalizeText(name), t)) || requirements.some((r) => textSimilarity(r.text, name) > 0) ? 1 : 0);
  const seenSkill = new Set<string>();
  const skills: PlanSkill[] = [...record.skills]
    .map((s, order) => ({ text: balanceBrackets(s.name), category: s.category, order }))
    .filter((s) => s.text && !seenSkill.has(skillKey(s.text)) && !!seenSkill.add(skillKey(s.text)))
    .map((s) => ({ ...s, score: skillScore(s.text) }))
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, MAX_SKILLS_SHOWN)
    .map((s, i) => ({ alias: `s${i + 1}`, text: s.text, category: s.category }));

  const users: PlanUser[] = requirements
    .filter((r) => r.userHas && r.use !== "logistics" && !isInterest(r))
    .map((r, i) => ({ alias: `u${i + 1}`, requirementId: r.id, text: r.text, note: r.note, skill: skillTerm(r, job.technologies ?? []), weight: r.weight }));

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
    mentions: requirements.filter((r) => r.use === "logistics" && r.userHas).map((r) => r.text),
    education: pickEducation(record.education),
    terms,
    jobTerms: [...terms.map(normalizeText), ...askedFor(requirements).map((r) => normalizeText(r.text))],
    totalBullets,
    bulletChars,
  };
}

/**
 * A schema field that accepts only the given values. With none (a candidate with no projects), any text is accepted and
 * `readWriting` drops it: a model that adds a project anyway should not fail the whole draft.
 */
const oneOf = (values: string[]) => (values.length > 0 ? z.enum(values as [string, ...string[]]) : z.string());

/**
 * A bullet that only has text, also accepted as the bare text. The writer asks for its JSON in the prompt (GLM-5.3 does
 * not think under structured outputs), which holds the model to the shape less strictly: once it wrote project bullets
 * as plain strings, and the whole draft was thrown away and written again. The prompt's schema still shows the object.
 */
const asObject = <T extends z.ZodType>(schema: T) => z.preprocess((v) => (typeof v === "string" ? { text: v } : v), schema);

/** The schema for one call, built from the aliases sent, so the only ids the model can return are ones it was given. */
export function answerSchema(plan: WritingPlan) {
  const factAliases = [...plan.roles.flatMap((r) => r.facts.map((f) => f.alias)), ...plan.users.map((u) => u.alias)];
  const skillAliases = [...plan.skills.map((s) => s.alias), ...plan.users.filter((u) => u.skill).map((u) => u.alias)];
  const text = z.string().min(10).max(plan.bulletChars + 60);
  return z.object({
    summary: z.string().max(MAX_SUMMARY_CHARS),
    // Its own field, so the summary's two sentences cannot crowd it out: required when the user asked for a mention.
    mention: z.string().max(MAX_MENTION_CHARS).optional(),
    roles: z.array(
      z.object({
        role: oneOf(plan.roles.map((r) => r.alias)),
        bullets: z.array(z.object({ facts: z.array(oneOf(factAliases)).min(1).max(2), text })).min(1).max(Math.max(...plan.roles.map((r) => r.budget), 1)),
      }),
    ),
    projects: z.array(z.object({ project: oneOf(plan.projects.map((p) => p.alias)), bullets: z.array(asObject(z.object({ text }))).max(2) })).max(MAX_PROJECTS),
    skills: z.array(z.object({ category: z.string().min(2).max(40), items: z.array(oneOf(skillAliases)).min(1).max(14) })).max(5),
    certifications: z.array(oneOf(plan.certifications.map((c) => c.alias))).max(4),
    // Only read when the user gave interests; empty otherwise.
    interests: z.string().max(MAX_INTERESTS_CHARS).optional(),
  }).refine((a) => plan.mentions.length === 0 || (a.mention ?? "").trim().length >= 10, { path: ["mention"], message: "Write the mention: the candidate asked for it" });
}
export type WriterAnswer = z.infer<ReturnType<typeof answerSchema>>;

export type WrittenBullet = {
  text: string;
  /** Record fact ids it was written from. */
  factIds: string[];
  /** Requirement ids of "I have this" items worked into it. */
  userRequirementIds: string[];
  /** How much of what the job asks for it answers. Bullets of a role are ordered by it, most first. */
  relevance: number;
};
export type WrittenRole = { plan: PlanRole; bullets: WrittenBullet[] };
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
};

/** Wording the model wrote, tidied: no list markers, one space, and a plain hyphen for any long dash. */
export function tidy(text: string): string {
  return text
    .replace(/^\s*[-*•·]\s+/, "")
    .replace(/\s*[—–]\s*/g, " - ")
    .replace(/\s+/g, " ")
    .trim();
}

/** A bullet's text, tidied and without a closing full stop, so every bullet on the page ends the same way. */
export const bulletText = (text: string): string => tidy(text).replace(/(?<![.]{2})\.$/, "");

/** Drops a skill another one already covers: "TypeScript" goes when "TypeScript/JavaScript" is also listed. */
export function withoutCovered(lines: { category: string; items: string[] }[]): { category: string; items: string[] }[] {
  const words = (item: string) => new Set(normalizeText(item).split(" ").filter(Boolean));
  const all = lines.flatMap((l) => l.items.map(words));
  const covered = (item: string) => {
    const mine = words(item);
    return all.some((other) => other.size > mine.size && [...mine].every((w) => other.has(w)));
  };
  return lines.map((l) => ({ ...l, items: l.items.filter((i) => !covered(i)) })).filter((l) => l.items.length > 0);
}

/**
 * Turns the model's answer into a resume. Roles come out in the plan's order, whatever order the model gave; a role it
 * left out keeps its two strongest facts as they were worded, so history is never silently missing; a repeated bullet
 * is dropped; and ids it was never given are ignored (the schema already refuses them).
 */
export function readWriting(answer: WriterAnswer, plan: WritingPlan): WrittenResume {
  const factByAlias = new Map(plan.roles.flatMap((r) => r.facts).map((f) => [f.alias, f]));
  const userByAlias = new Map(plan.users.map((u) => [u.alias, u]));

  const bulletOf = (text: string, aliases: string[]): WrittenBullet => {
    const facts = aliases.map((a) => factByAlias.get(a)).filter((f): f is PlanFact => !!f);
    const users = aliases.map((a) => userByAlias.get(a)).filter((u): u is PlanUser => !!u);
    const relevance = facts.reduce((n, f) => n + f.weight, 0) + users.reduce((n, u) => n + u.weight, 0);
    return {
      text: bulletText(text),
      factIds: facts.map((f) => f.factId),
      userRequirementIds: users.map((u) => u.requirementId),
      relevance,
    };
  };
  const unique = (bullets: WrittenBullet[]) => {
    const seen = new Set<string>();
    return bullets.filter((b) => b.text && !seen.has(normalizeText(b.text)) && seen.add(normalizeText(b.text)));
  };

  const roles: WrittenRole[] = plan.roles.map((p) => {
    const given = answer.roles.find((r) => r.role === p.alias);
    const bullets = given
      ? given.bullets.map((b) => bulletOf(b.text, b.facts))
      : p.facts.slice(0, 2).map((f) => ({ text: bulletText(f.texts[0]), factIds: [f.factId], userRequirementIds: [], relevance: f.weight }));
    // The bullets that answer the most of the job come first; ones that tie keep the order the model gave them.
    return { plan: p, bullets: unique(bullets).slice(0, p.budget).sort((a, b) => b.relevance - a.relevance) };
  });

  const projects: WrittenProject[] = [];
  for (const g of answer.projects) {
    const p = plan.projects.find((x) => x.alias === g.project);
    if (!p || projects.some((x) => x.plan === p)) continue;
    projects.push({ plan: p, bullets: unique(g.bullets.map((b) => ({ text: bulletText(b.text), factIds: [p.projectId], userRequirementIds: [], relevance: 1 }))) });
  }

  const skillText = new Map([...plan.skills.map((s) => [s.alias, s.text] as const), ...plan.users.filter((u) => u.skill).map((u) => [u.alias, balanceBrackets(u.skill!)] as const)]);
  const seenSkill = new Set<string>();
  // What the job asks for comes first on each line, and the line with the most of it comes first.
  const wanted = (item: string) => plan.jobTerms.some((t) => containsPhrase(t, normalizeText(item)));
  const skills = withoutCovered(answer.skills
    .map((s) => ({
      category: tidy(s.category),
      items: s.items
        .map((a) => skillText.get(a))
        .filter((t): t is string => !!t && !seenSkill.has(skillKey(t)) && !!seenSkill.add(skillKey(t)))
        .sort((a, b) => Number(wanted(b)) - Number(wanted(a))),
    }))
    .filter((s) => s.items.length > 0)
    .sort((a, b) => b.items.filter(wanted).length - a.items.filter(wanted).length));

  const certs = answer.certifications.map((a) => plan.certifications.find((c) => c.alias === a)).filter((c): c is PlanCertification => !!c);
  return {
    summary: withMention(tidy(answer.summary), answer.mention ?? "", plan.mentions),
    roles,
    projects,
    skills,
    certifications: [...new Map(certs.map((c) => [c.id, c])).values()],
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

export const SYSTEM = `You edit a candidate's own resume lines into a resume for a specific job. You are an editor, not a writer: the candidate wrote every line in their career record, and a hiring manager should hear the candidate, not a model.
The candidate is qualified for this job. Their record is shorter than their real experience, so something the job asks for that the record does not show is experience that has not been written down yet, not a gap. Cover everything listed under "WHAT THE JOB ASKS FOR".
How to edit:
- Each fact is given with one or two of the candidate's own wordings. Start from the first one, word for word, and change only what this job needs: the posting's spelling of a tool or term, working in something the candidate says they have, cutting what does not matter for this job, or moving what matters most to the front. If a line already works, keep it as it is.
- Keep the specifics: the names of tools, systems, products, customers and teams, and every number, exactly as the candidate wrote them. A named thing is never replaced by a category ("Attio, Crisp and Userlist" never becomes "business systems").
- Never add a result, a purpose or a benefit the candidate did not write: no "so that", "giving the team", "enabling", "ensuring" or "which meant" clause of your own. If the source states no result, the bullet ends at what was done.
- Never add a number. Never invent a certification, a degree, an employer or a title.
- Never say the candidate has an interest, a hobby, a passion or a background they did not give. The company's field describes the company, not the candidate: "a storytelling app" can frame the summary, "a lifelong reader of fanfiction" cannot. What the candidate gives under "INTERESTS" goes in "interests" only, as one short line in their words with the specifics of their note, and never in the summary or a bullet. With nothing under "INTERESTS", leave "interests" empty.
Rules:
- You are given the record as numbered items. Every bullet names the item ids it was written from in "facts". Never use an id you were not given.
- One bullet tells one thing the candidate did. Name two ids only when they are the same piece of work, or when a "u" item builds on the fact it extends. Never join separate achievements into one sentence.
- Something under "THE CANDIDATE SAYS THEY HAVE THIS" is true of them: work every one in. Extend the bullet of the role it fits best, or add a bullet there (name its u id in "facts", together with the id of the item it builds on), or put it in the skills lines when it is a skill. With no number to give, say plainly what was done.
- The terms under "JOB TERMS" are tools and skills the candidate has. Use each once, where it belongs. The first three may also go in the summary and the skills lines. Never repeat a term to please a keyword scanner, and never tack one onto a bullet it does not belong to. Write an acronym out once with its short form after it, then use the short form.
- The field the company works in is context, not a skill. It may frame the summary in a few words ("consumer storytelling products") and appears nowhere else. A way of working under "SHOW, DO NOT NAME" is shown by what the candidate did and its name is never written. Never put either in the skills lines.
- Never copy sentences from the posting or from the company's text, and never turn a responsibility line into "I do X".
- The summary is two sentences at most, in plain words: what kind of professional the candidate is, said with the job's title as the posting words it, and one concrete proof point from the record (a number or a named result). It is not a list of tools, it does not name the company and it does not repeat its mission. What is under "MENTION BRIEFLY" goes in "mention", one short sentence in the candidate's words, which is put after the summary; do not say it in the summary too. With nothing there, leave "mention" empty.
- Vary the length with importance. In each role, the one or two bullets that answer the job's most important requirements keep their full detail; the rest are one line. Vary how sentences start and how they are built: not every bullet is "Verb X, Y and Z, which...".
- Lead each role with the bullets that matter most for this job, and put the skills the job asks for first on each skills line.
- No first person, no filler, no long dashes, no run of three adjectives.
- Do not write names, titles, dates, schools, certifications or achievements of your own. They are filled in for you; you only choose which certifications to show.
- Keep to the bullet counts given. Fewer, stronger bullets beat more.`;

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
  const reqLine = (r: Requirement) => `${r.id} [${REQUIREMENT_KIND_LABEL[r.kind]}${r.userHas ? ", the candidate has this" : r.verdict === "met" ? ", in the record" : r.verdict === "partial" ? ", partly in the record" : ""}]: ${r.text}`;
  const dates = (r: PlanRole) => [r.start, r.current ? "Present" : r.end].filter(Boolean).join(" - ");

  const fields = requirements.filter((r) => r.kind === "keyword" && requirementUse(r) === "domain").map((r) => r.text);
  const traits = requirements.filter((r) => r.use === "trait").map((r) => r.text);
  const values = requirements.filter((r) => r.kind === "company").map((r) => r.text);
  const company = [
    fields.length ? `Field: ${fields.slice(0, 6).join(", ")}` : "",
    job.aboutCompany ? `About the company: ${clip(job.aboutCompany, 400)}` : "",
    values.length ? `What it values: ${values.join("; ")}` : "",
  ].filter(Boolean);

  const terms = plan.terms;
  const sections = [
    `THE JOB\n${job.title} at ${job.company}${job.location ? `, ${job.location}` : ""}${job.responsibilities.length ? `\nResponsibilities (for understanding the role, never to be copied):\n${job.responsibilities.slice(0, 8).map((r) => `- ${clip(r, 200)}`).join("\n")}` : ""}`.trim(),
    `WHAT THE JOB ASKS FOR\n${askedFor(requirements).map(reqLine).join("\n")}`,
    terms.length > 0 ? `JOB TERMS (use them exactly as written, the first ones matter most)\n${terms.join(", ")}` : "",
    company.length > 0 ? `THE COMPANY (for tone and context only; never quote it, never name it in the resume)\n${company.join("\n")}` : "",
    traits.length > 0 ? `SHOW, DO NOT NAME\n${traits.join(", ")}` : "",
    `THE CANDIDATE'S ROLES (most recent first; each fact shows the candidate's own wording, the one to start from first)\n${plan.roles
      .map(
        (r) =>
          `${r.alias}: ${r.title || "Role"} at ${r.employer}, ${dates(r)}. Write up to ${r.budget} bullets.\n${r.facts.map((f) => `  ${f.alias}: ${f.texts.map((t) => `"${t}"`).join(" | ")}`).join("\n")}`,
      )
      .join("\n")}`,
    plan.projects.length ? `PROJECTS (include the ones that answer the job; up to 2 bullets each)\n${plan.projects.map((p) => `${p.alias}: ${p.name}. ${p.description} ${p.technologies.length ? `Technologies: ${p.technologies.join(", ")}.` : ""} ${p.texts.map((t) => `"${t}"`).join(" | ")}`.trim()).join("\n")}` : "",
    `SKILLS (pick the ones that matter for this job, grouped under short category names)\n${plan.skills.map((s) => `${s.alias}: ${s.text}${s.category ? ` (${s.category})` : ""}`).join("\n")}${plan.users.filter((u) => u.skill).map((u) => `\n${u.alias}: ${u.skill}`).join("")}`,
    plan.certifications.length ? `CERTIFICATIONS (pick the relevant ones)\n${plan.certifications.map((c) => `${c.alias}: ${c.name}${c.issuer ? `, ${c.issuer}` : ""}`).join("\n")}` : "",
    plan.interests.length ? `INTERESTS (the candidate's own; write "interests" from these and their notes only)\n${plan.interests.map((i) => `${i.text}${i.note ? ` (their note: ${i.note})` : ""}`).join("\n")}` : "",
    plan.mentions.length ? `MENTION BRIEFLY (write "mention": one short sentence in the candidate's words, for example "Open to relocating to San Francisco." It closes the summary)\n${plan.mentions.join("\n")}` : "",
    plan.users.length ? `THE CANDIDATE SAYS THEY HAVE THIS\n${plan.users.map((u) => `${u.alias}: ${u.text}${u.note ? ` (their note: ${u.note})` : ""}`).join("\n")}` : "",
    `LENGTH\nAbout ${plan.totalBullets} bullets in all. The one or two bullets per role that answer the most important requirements may use up to ${plan.bulletChars} characters; the others stay under about ${SUPPORT_BULLET_CHARS}.${instructions?.tone ? ` Tone: ${instructions.tone}.` : ""}${instructions?.styleRules.trim() ? `\nThe candidate's own style rules: ${instructions.styleRules.trim()}` : ""}`,
  ];
  return { system: SYSTEM, user: sections.filter(Boolean).join("\n\n") };
}
