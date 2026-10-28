import { factLine } from "./facts";
import type { CareerRecord, Detail, Role } from "./schema";

// The career record as a model reads it: one line per fact with its details, no ids, no alternate wordings. It is sent
// as the first message of every career step (`prefix` in chatStructured), so it must come out byte for byte the same
// for the same record: no dates of export, no version, nothing random, and the record's own order throughout.

const detailText = (d: Detail) => (d.kind === "metric" && d.measures.trim() ? `${d.text} (${d.measures.trim()})` : d.text);

function roleLines(role: Role): string[] {
  const titles = [...new Set(role.framings.map((f) => f.title.trim()).filter(Boolean))].join(" / ") || "Role";
  const dates = [role.start.trim(), role.current ? "Present" : role.end.trim()].filter(Boolean).join(" - ");
  const out = [`#### ${titles}${dates ? `, ${dates}` : ""}`];
  if (role.technologies.length > 0) out.push(`Technologies: ${role.technologies.join(", ")}`);
  for (const fact of role.facts) {
    const line = factLine(fact).replace(/\s+/g, " ").trim();
    if (!line) continue;
    out.push(`- ${line}`);
    if (fact.details.length > 0) out.push(`  Details: ${fact.details.map(detailText).join("; ")}`);
  }
  return out;
}

/** The record for a prompt. About a third of the size of the Markdown export once the record is compacted. */
export function recordForPrompt(record: CareerRecord): string {
  const out: string[] = ["# Career record of the candidate"];
  if (record.employers.length > 0) {
    out.push("", "## Experience");
    for (const e of record.employers) {
      out.push("", `### ${e.name.trim()}`);
      for (const role of e.roles) out.push(...roleLines(role));
    }
  }
  if (record.projects.length > 0) {
    out.push("", "## Projects");
    for (const p of record.projects) {
      out.push("", `### ${p.name.trim()}${p.description.trim() ? `: ${p.description.trim()}` : ""}`);
      if (p.technologies.length > 0) out.push(`Technologies: ${p.technologies.join(", ")}`);
      for (const w of p.wordings) out.push(`- ${w.text.replace(/\s+/g, " ").trim()}`);
    }
  }
  if (record.skills.length > 0) {
    out.push("", "## Skills");
    const byCategory = new Map<string, string[]>();
    for (const s of record.skills) byCategory.set(s.category.trim(), [...(byCategory.get(s.category.trim()) ?? []), s.name]);
    for (const [category, names] of byCategory) out.push(`- ${category ? `${category}: ` : ""}${names.join(", ")}`);
  }
  if (record.education.length > 0) {
    out.push("", "## Education");
    for (const e of record.education) out.push(`- ${[e.institution, [e.degree, e.field].filter(Boolean).join(", "), e.end].filter((x) => x.trim()).join("; ")}`);
  }
  if (record.certifications.length > 0) {
    out.push("", "## Certifications");
    for (const c of record.certifications) out.push(`- ${[c.name, c.issuer].filter((x) => x.trim()).join(", ")}`);
  }
  if (record.achievements.length > 0) {
    out.push("", "## Achievements");
    for (const a of record.achievements) out.push(`- ${a.text}`);
  }
  return out.join("\n") + "\n";
}
