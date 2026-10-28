import type { CareerRecord, Framing, Role, Wording } from "./schema";

// The whole career record as one Markdown file, for reading, keeping or handing to another tool. Pure and
// client-safe. Every employer, role, framing, fact and wording comes out as stored; ids, sources and the list of
// things the user removed are internal and are left out.

/** Keeps a multi-line text inside its list item. */
const indent = (text: string, by: string) => text.trim().split(/\r?\n/).map((l, n) => (n === 0 ? l : `${by}${l}`)).join("\n");

const dates = (r: Role) => {
  const start = r.start.trim();
  const end = r.current ? "Present" : r.end.trim();
  return [start, end].filter(Boolean).join(" - ");
};

const framingLine = (f: Framing) => {
  const parts = [f.title.trim() || "Untitled", f.angle.trim() && `angle: ${f.angle.trim()}`, f.targetRoles.length > 0 && `target roles: ${f.targetRoles.join(", ")}`];
  return `- ${parts.filter(Boolean).join("; ")}`;
};

function wordingLines(w: Wording, framings: Map<string, string>, lead: string): string {
  const tags = [w.form === "paragraph" ? "story" : "", w.framingId ? (framings.get(w.framingId) ?? "") : ""].filter(Boolean);
  const tag = tags.length > 0 ? ` (${tags.join(", ")})` : "";
  return `${lead}${indent(w.text, lead.startsWith(" ") ? "    " : "  ")}${tag}`;
}

function roleSection(role: Role): string[] {
  const lines: string[] = [];
  const titles = role.framings.map((f) => f.title.trim()).filter(Boolean);
  const heading = [titles[0] ?? "Role", dates(role)].filter(Boolean).join(", ");
  lines.push(`#### ${heading}`, "");
  if (role.location.trim()) lines.push(`Location: ${role.location.trim()}`, "");
  if (role.framings.length > 1 || role.framings.some((f) => f.angle.trim() || f.targetRoles.length > 0)) {
    lines.push("Told as:", ...role.framings.map(framingLine), "");
  }
  if (role.dateNotes.length > 0) lines.push("Date notes:", ...role.dateNotes.map((n) => `- ${n}`), "");
  if (role.technologies.length > 0) lines.push(`Technologies: ${role.technologies.join(", ")}`, "");

  const framings = new Map(role.framings.map((f) => [f.id, f.title.trim()]));
  for (const fact of role.facts) {
    // A fact with a statement leads with it, then its details and the wordings kept for each framing.
    if (fact.statement.trim()) {
      lines.push(`- ${indent(fact.statement, "  ")}`);
      if (fact.details.length > 0) lines.push(`  - Details: ${fact.details.map((d) => d.text).join("; ")}`);
      for (const w of fact.wordings) lines.push(wordingLines(w, framings, "  - Worded: "));
      continue;
    }
    const [first, ...rest] = fact.wordings;
    if (!first) continue;
    lines.push(wordingLines(first, framings, "- "));
    for (const w of rest) lines.push(wordingLines(w, framings, "  - Also worded: "));
  }
  if (role.facts.some((f) => f.wordings.length > 0 || f.statement.trim())) lines.push("");
  return lines;
}

/** The record as Markdown. `exportedOn` is the day written at the top, as "YYYY-MM-DD". */
export function recordToMarkdown(record: CareerRecord, meta: { version: number | null; exportedOn: string }): string {
  const out: string[] = ["# Career record", ""];
  out.push(`Exported ${meta.exportedOn}${meta.version ? `, version ${meta.version}` : ""}.`, "");

  const employers = record.employers.filter((e) => e.roles.length > 0 || e.name.trim());
  if (employers.length > 0) {
    out.push("## Experience", "");
    for (const e of employers) {
      out.push(`### ${e.name.trim()}`, "");
      for (const role of e.roles) out.push(...roleSection(role));
    }
  }

  if (record.skills.length > 0) {
    out.push("## Skills", "");
    const byCategory = new Map<string, string[]>();
    for (const s of record.skills) byCategory.set(s.category.trim(), [...(byCategory.get(s.category.trim()) ?? []), s.name]);
    for (const [category, names] of byCategory) out.push(category ? `- ${category}: ${names.join(", ")}` : `- ${names.join(", ")}`);
    out.push("");
  }

  if (record.projects.length > 0) {
    out.push("## Projects", "");
    for (const p of record.projects) {
      out.push(`### ${p.name}`, "");
      if (p.url.trim()) out.push(p.url.trim(), "");
      if (p.description.trim()) out.push(p.description.trim(), "");
      if (p.technologies.length > 0) out.push(`Technologies: ${p.technologies.join(", ")}`, "");
      for (const w of p.wordings) out.push(wordingLines(w, new Map(), "- "));
      if (p.wordings.length > 0) out.push("");
    }
  }

  if (record.education.length > 0) {
    out.push("## Education", "");
    for (const e of record.education) {
      const what = [e.degree.trim(), e.field.trim()].filter(Boolean).join(", ");
      const when = [e.start.trim(), e.end.trim()].filter(Boolean).join(" - ");
      out.push(`- ${[e.institution, what, when].filter(Boolean).join("; ")}`);
      if (e.details.trim()) out.push(`  - ${indent(e.details, "    ")}`);
    }
    out.push("");
  }

  if (record.certifications.length > 0) {
    out.push("## Certifications", "");
    for (const c of record.certifications) out.push(`- ${[c.name, c.issuer.trim(), c.date.trim()].filter(Boolean).join("; ")}`);
    out.push("");
  }

  if (record.achievements.length > 0) {
    out.push("## Achievements", "");
    for (const a of record.achievements) out.push(`- ${indent(a.text, "  ")}`);
    out.push("");
  }

  if (record.motivations.length > 0) {
    out.push("## Reasons for applying", "");
    for (const m of record.motivations) {
      const scope = m.scope === "company" && m.companyName.trim() ? ` (${m.companyName.trim()})` : "";
      out.push(`- ${indent(m.text, "  ")}${scope}`);
    }
    out.push("");
  }

  return `${out.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}
