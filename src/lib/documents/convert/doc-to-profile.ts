import { emptyProfile, type Profile } from "@/lib/profile/schema";
import type { DocJSON } from "../build";
import { bulletTexts, children, headerOf, plainText, sectionsOf, textOf } from "../read";
import { CONTACT_SEP } from "./profile-to-doc";

const PRESENT = /^(present|current|now|ongoing|today)$/i;

/** "Jan 2022 - Present" back into its parts. A single date is a start date, except for an open "Present". */
export function parseDates(text: string): { start: string; end: string; current: boolean } {
  const t = text.trim();
  if (!t) return { start: "", end: "", current: false };
  const parts = t.split(/\s+(?:-|to)\s+|\s*[–—]\s*/i);
  let start = parts[0]?.trim() ?? "";
  let end = parts.slice(1).join(" - ").trim();
  if (parts.length === 1) {
    const open = t.match(/^(.+?)\s*-\s*(present|current|now|ongoing)$/i);
    if (open) {
      start = open[1].trim();
      end = open[2];
    }
  }
  const current = PRESENT.test(end);
  return { start, end: current ? "" : end, current };
}

const looksLikePhone = (s: string) => /^[+()\d][\d\s().+-]{6,}$/.test(s);
const looksLikeLink = (s: string) => /^(https?:\/\/|www\.)/i.test(s) || /^[\w-]+(\.[\w-]+)+\/\S*$/.test(s) || /(linkedin|github|gitlab|behance|medium)\./i.test(s);

/** Splits the contact line on the separator and sorts the pieces by what they look like. */
function parseContact(line: string, name: string): Profile["contact"] {
  const contact = { ...emptyProfile().contact, name };
  for (const raw of line.split(CONTACT_SEP).map((s) => s.trim()).filter(Boolean)) {
    if (!contact.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) contact.email = raw;
    else if (!contact.phone && looksLikePhone(raw)) contact.phone = raw;
    else if (looksLikeLink(raw)) contact.links.push(raw);
    else if (!contact.location) contact.location = raw;
    else contact.links.push(raw);
  }
  return contact;
}

const listItems = (section: DocJSON) => children(section).filter((c) => c.type === "bulletList").flatMap((l) => bulletTexts(l));
const paragraphs = (section: DocJSON) =>
  children(section)
    .filter((c) => c.type === "paragraph")
    .map((p) => plainText(p).trim())
    .filter(Boolean);

/**
 * An editor document as a structured resume, with no model call. Everything a profile can hold comes back; custom
 * sections, the headline and nesting of bullets have no place in a profile and are dropped (use `chunkDocument` to
 * keep custom sections searchable).
 */
export function docToProfile(doc: DocJSON): Profile {
  const profile = emptyProfile();
  const header = headerOf(doc);
  if (header) profile.contact = parseContact(textOf(header, "headerContact"), textOf(header, "headerName"));

  for (const s of sectionsOf(doc)) {
    const kind = String(s.attrs?.kind ?? "custom");
    if (kind === "summary") {
      profile.summary = paragraphs(s).join("\n\n");
    } else if (kind === "experience") {
      for (const r of children(s).filter((c) => c.type === "role")) {
        const dates = parseDates(textOf(r, "roleDates"));
        profile.experience.push({
          company: textOf(r, "roleCompany"),
          title: textOf(r, "roleTitle"),
          location: textOf(r, "roleLocation"),
          ...dates,
          bullets: bulletTexts(children(r).find((c) => c.type === "bulletList")),
        });
      }
    } else if (kind === "projects") {
      for (const p of children(s).filter((c) => c.type === "project")) {
        const tech = textOf(p, "projectTech").replace(/^technologies:\s*/i, "");
        const name = children(p).find((c) => c.type === "projectName");
        const href = name?.content?.flatMap((n) => n.marks ?? []).find((m) => m.type === "link")?.attrs?.href;
        profile.projects.push({
          name: textOf(p, "projectName"),
          description: textOf(p, "projectDetail"),
          technologies: tech ? tech.split(/\s*,\s*/).filter(Boolean) : [],
          bullets: bulletTexts(children(p).find((c) => c.type === "bulletList")),
          url: typeof href === "string" ? href : "",
        });
      }
    } else if (kind === "skills") {
      for (const line of children(s).filter((c) => c.type === "skillsLine")) {
        const label = textOf(line, "skillsLabel");
        const items = textOf(line, "skillsItems").split(/\s*,\s*/).filter(Boolean);
        if (label.toLowerCase() === "technologies") profile.technologies.push(...items);
        else profile.skills.push({ category: label || "Skills", items });
      }
    } else if (kind === "education") {
      for (const e of children(s).filter((c) => c.type === "education")) {
        const dates = parseDates(textOf(e, "eduDates"));
        const [degree, ...field] = textOf(e, "eduDegree").split(/\s+in\s+/);
        profile.education.push({
          institution: textOf(e, "eduInstitution"),
          degree: degree ?? "",
          field: field.join(" in "),
          start: dates.start,
          end: dates.current ? "Present" : dates.end,
          details: textOf(e, "eduDetails"),
        });
      }
    } else if (kind === "certifications") {
      for (const t of listItems(s)) profile.certifications.push({ name: t, issuer: "", date: "" });
    } else if (kind === "achievements") {
      profile.achievements.push(...listItems(s));
    }
  }
  return profile;
}
