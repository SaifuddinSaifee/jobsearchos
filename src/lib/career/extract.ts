import type { Profile } from "@/lib/profile/schema";
import type { DocJSON } from "@/lib/documents/build";
import { parseDates } from "@/lib/documents/convert/doc-to-profile";
import { children, plainText, sectionsOf, textOf } from "@/lib/documents/read";
import { cleanDatesText, formatDates } from "./dates";

// Reads a source into plain pieces for merging. Unlike `docToProfile`, this keeps the id of every role, project,
// skills line and bullet, so a wording in the record can point back at the exact block it came from.

export type ExtractedBullet = { blockId: string | null; text: string };

export type ExtractedRole = {
  blockId: string | null;
  title: string;
  company: string;
  location: string;
  /** The dates as written, for notes. */
  datesText: string;
  start: string;
  end: string;
  current: boolean;
  bullets: ExtractedBullet[];
};

export type ExtractedProject = {
  blockId: string | null;
  name: string;
  description: string;
  url: string;
  technologies: string[];
  bullets: ExtractedBullet[];
};

export type ExtractedSkill = { blockId: string | null; category: string; name: string };

export type ExtractedEducation = {
  blockId: string | null;
  institution: string;
  degree: string;
  field: string;
  start: string;
  end: string;
  details: string;
};

export type ExtractedCertification = { blockId: string | null; name: string; issuer: string; date: string };
export type ExtractedAchievement = { blockId: string | null; text: string };

/** A paragraph of a cover letter. No block id: letters are plain paragraphs. */
export type ExtractedParagraph = { blockId: string | null; text: string };

export type SourceExtract = {
  roles: ExtractedRole[];
  projects: ExtractedProject[];
  skills: ExtractedSkill[];
  education: ExtractedEducation[];
  certifications: ExtractedCertification[];
  achievements: ExtractedAchievement[];
  paragraphs: ExtractedParagraph[];
};

export function emptyExtract(): SourceExtract {
  return { roles: [], projects: [], skills: [], education: [], certifications: [], achievements: [], paragraphs: [] };
}

/** Lines shorter than this ("Dear team,", "Sincerely,") say nothing worth keeping and are not put to the model. */
export const MIN_PARAGRAPH_CHARS = 40;

/** The paragraphs of a cover letter, word for word. Bullets in a letter count as paragraphs of their own. */
export function extractCoverLetter(doc: DocJSON): SourceExtract {
  const out = emptyExtract();
  const add = (text: string) => {
    const t = text.replace(/\s+/g, " ").trim();
    if (t.length >= MIN_PARAGRAPH_CHARS) out.paragraphs.push({ blockId: null, text: t });
  };
  for (const block of children(doc)) {
    if (block.type === "paragraph") add(plainText(block));
    else if (block.type === "bulletList") for (const b of bulletsOf(block)) add(b.text);
  }
  return out;
}

const idOf = (n: DocJSON): string | null => {
  const id = n.attrs?.id;
  return typeof id === "string" && id ? id : null;
};

/** Bullets of a list with their own ids; nested bullets follow their parent. */
function bulletsOf(list: DocJSON | undefined): ExtractedBullet[] {
  const out: ExtractedBullet[] = [];
  const walk = (l: DocJSON | undefined) => {
    for (const b of children(l)) {
      const text = plainText(children(b).find((c) => c.type === "paragraph")).trim();
      if (text) out.push({ blockId: idOf(b), text });
      walk(children(b).find((c) => c.type === "bulletList"));
    }
  };
  walk(list);
  return out;
}

const listBullets = (section: DocJSON) =>
  children(section)
    .filter((c) => c.type === "bulletList")
    .flatMap((l) => bulletsOf(l));

function splitItems(text: string): string[] {
  return text
    .split(/\s*,\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** An editor document as pieces for the career record. No model call. Custom sections and summaries are not read. */
export function extractFromDoc(doc: DocJSON): SourceExtract {
  const out = emptyExtract();
  for (const s of sectionsOf(doc)) {
    const kind = String(s.attrs?.kind ?? "custom");
    if (kind === "experience") {
      for (const r of children(s).filter((c) => c.type === "role")) {
        const datesText = cleanDatesText(textOf(r, "roleDates"));
        out.roles.push({
          blockId: idOf(r),
          title: textOf(r, "roleTitle"),
          company: textOf(r, "roleCompany"),
          location: textOf(r, "roleLocation"),
          datesText,
          ...parseDates(datesText),
          bullets: bulletsOf(children(r).find((c) => c.type === "bulletList")),
        });
      }
    } else if (kind === "projects") {
      for (const p of children(s).filter((c) => c.type === "project")) {
        const tech = textOf(p, "projectTech").replace(/^technologies:\s*/i, "");
        const name = children(p).find((c) => c.type === "projectName");
        const href = name?.content?.flatMap((n) => n.marks ?? []).find((m) => m.type === "link")?.attrs?.href;
        out.projects.push({
          blockId: idOf(p),
          name: textOf(p, "projectName"),
          description: textOf(p, "projectDetail"),
          url: typeof href === "string" ? href : "",
          technologies: splitItems(tech),
          bullets: bulletsOf(children(p).find((c) => c.type === "bulletList")),
        });
      }
    } else if (kind === "skills") {
      for (const line of children(s).filter((c) => c.type === "skillsLine")) {
        const category = textOf(line, "skillsLabel") || "Skills";
        for (const name of splitItems(textOf(line, "skillsItems"))) {
          out.skills.push({ blockId: idOf(line), category, name });
        }
      }
    } else if (kind === "education") {
      for (const e of children(s).filter((c) => c.type === "education")) {
        const dates = parseDates(cleanDatesText(textOf(e, "eduDates")));
        const [degree, ...field] = textOf(e, "eduDegree").split(/\s+in\s+/);
        out.education.push({
          blockId: idOf(e),
          institution: textOf(e, "eduInstitution"),
          degree: degree ?? "",
          field: field.join(" in "),
          start: dates.start,
          end: dates.current ? "Present" : dates.end,
          details: textOf(e, "eduDetails"),
        });
      }
    } else if (kind === "certifications") {
      for (const b of listBullets(s)) out.certifications.push({ blockId: b.blockId, name: b.text, issuer: "", date: "" });
    } else if (kind === "achievements") {
      for (const b of listBullets(s)) out.achievements.push({ blockId: b.blockId, text: b.text });
    }
  }
  return out;
}

const bullets = (items: string[]): ExtractedBullet[] =>
  items.map((t) => t.trim()).filter(Boolean).map((text) => ({ blockId: null, text }));

/** A structured profile (the Profile page, or a parsed LinkedIn print) as pieces. Nothing has a block id. */
export function extractFromProfile(profile: Profile): SourceExtract {
  const out = emptyExtract();
  for (const e of profile.experience) {
    out.roles.push({
      blockId: null,
      title: e.title,
      company: e.company,
      location: e.location,
      datesText: formatDates(e),
      start: e.start,
      end: e.end,
      current: e.current,
      bullets: bullets(e.bullets),
    });
  }
  for (const p of profile.projects) {
    out.projects.push({
      blockId: null,
      name: p.name,
      description: p.description,
      url: p.url,
      technologies: p.technologies,
      bullets: bullets(p.bullets),
    });
  }
  for (const g of profile.skills) {
    for (const name of g.items) if (name.trim()) out.skills.push({ blockId: null, category: g.category || "Skills", name: name.trim() });
  }
  for (const name of profile.technologies) if (name.trim()) out.skills.push({ blockId: null, category: "Technologies", name: name.trim() });
  for (const e of profile.education) {
    out.education.push({
      blockId: null,
      institution: e.institution,
      degree: e.degree,
      field: e.field,
      start: e.start,
      end: e.end,
      details: e.details,
    });
  }
  for (const c of profile.certifications) out.certifications.push({ blockId: null, ...c });
  for (const a of profile.achievements) if (a.trim()) out.achievements.push({ blockId: null, text: a.trim() });
  return out;
}
