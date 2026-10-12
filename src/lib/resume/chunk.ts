import type { Profile } from "@/lib/profile/schema";

export type ResumeChunk = {
  /** Which part of the resume this came from: "summary", "experience", "projects", "skills", "education", ... */
  section: string;
  /** A short name for the piece, for showing in lists: "Staff Engineer at Acme". */
  label: string;
  text: string;
};

/** Longest piece kept whole. Longer text is split on blank lines, then on sentences, so no embedding is truncated. */
const MAX_CHARS = 1800;

const clean = (s: string) => s.trim();
const nonEmpty = (xs: string[]) => xs.map(clean).filter(Boolean);
const dates = (start: string, end: string, current: boolean) => {
  const e = current ? "Present" : end;
  return [start, e].filter(Boolean).join(" to ");
};

/**
 * Splits a structured resume into pieces that each mean something on their own: one per job, project and
 * education entry, plus the summary, the skills and the achievements. A job is kept together with its bullets,
 * because a bullet alone ("Cut p95 latency by 40%") says nothing about where it happened.
 */
export function chunkProfile(p: Profile): ResumeChunk[] {
  const out: ResumeChunk[] = [];
  const add = (section: string, label: string, lines: string[]) => {
    const text = nonEmpty(lines).join("\n");
    if (text) out.push(...split({ section, label, text }));
  };

  add("summary", "Summary", [p.summary]);

  for (const e of p.experience) {
    const head = [e.title, e.company].filter(Boolean).join(" at ");
    add("experience", head || "Experience", [head, [dates(e.start, e.end, e.current), e.location].filter(Boolean).join(", "), ...e.bullets.map((b) => `- ${b}`)]);
  }

  for (const pr of p.projects) {
    add("projects", pr.name || "Project", [
      pr.name,
      pr.description,
      pr.technologies.length ? `Technologies: ${pr.technologies.join(", ")}` : "",
      ...pr.bullets.map((b) => `- ${b}`),
    ]);
  }

  const skills = p.skills.map((s) => `${s.category}: ${s.items.join(", ")}`);
  if (p.technologies.length > 0) skills.push(`Technologies: ${p.technologies.join(", ")}`);
  add("skills", "Skills", skills);

  for (const ed of p.education) {
    const head = [ed.degree, ed.field].filter(Boolean).join(" in ");
    add("education", [head, ed.institution].filter(Boolean).join(", ") || "Education", [head, ed.institution, dates(ed.start, ed.end, false), ed.details]);
  }

  add("certifications", "Certifications", p.certifications.map((c) => [c.name, c.issuer, c.date].filter(Boolean).join(", ")));
  add("achievements", "Achievements", p.achievements.map((a) => `- ${a}`));
  return out;
}

/**
 * Fallback when the resume could not be structured: paragraphs, packed together up to the size limit, labelled by
 * their first words. Worse than `chunkProfile` (a job may be cut in two) but still searchable.
 */
export function chunkText(text: string): ResumeChunk[] {
  const paragraphs = text.split(/\n{2,}/).map(clean).filter(Boolean);
  const out: ResumeChunk[] = [];
  let current = "";
  const flush = () => {
    if (current) out.push(...split({ section: "text", label: current.slice(0, 50).replace(/\s+/g, " "), text: current }));
    current = "";
  };
  for (const para of paragraphs) {
    if (current && current.length + para.length + 2 > MAX_CHARS) flush();
    current = current ? `${current}\n\n${para}` : para;
  }
  flush();
  return out;
}

/** Keeps a piece under the size limit by splitting on lines, then on sentences. Numbers the parts of a split piece. */
function split(chunk: ResumeChunk): ResumeChunk[] {
  if (chunk.text.length <= MAX_CHARS) return [chunk];
  const units = chunk.text.split("\n").flatMap((line) => (line.length <= MAX_CHARS ? [line] : line.split(/(?<=[.!?])\s+/)));
  const parts: string[] = [];
  let current = "";
  for (const unit of units) {
    // A single unit that is still too long is cut at the limit; resumes should never get here.
    for (let i = 0; i < unit.length || i === 0; i += MAX_CHARS) {
      const piece = unit.slice(i, i + MAX_CHARS);
      if (current && current.length + piece.length + 1 > MAX_CHARS) {
        parts.push(current);
        current = "";
      }
      current = current ? `${current}\n${piece}` : piece;
    }
  }
  if (current) parts.push(current);
  return parts.map((text, i) => ({ ...chunk, label: parts.length > 1 ? `${chunk.label} (part ${i + 1})` : chunk.label, text }));
}
