import { splitOutsideBrackets } from "@/lib/career/normalize";
import { emptyProfile, type Profile } from "@/lib/profile/schema";
import type { DocJSON } from "../build";
import { bulletTexts, children, firstOf, headerOf, plainText, sectionsOf, textOf } from "../read";
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

/** One piece of the contact line: its text, and the address it links to when it is a link. */
export type ContactPiece = { text: string; href: string | null };

/**
 * The contact line in pieces, split on the separator, each with the address of any link on it. A resume often shows a
 * link as a label ("GitHub", "LinkedIn") with the address only in the link, so the text alone loses it.
 */
export function contactPieces(line: DocJSON | undefined): ContactPiece[] {
  const pieces: ContactPiece[] = [{ text: "", href: null }];
  for (const node of children(line)) {
    if (node.type !== "text") continue;
    const link = (node.marks ?? []).find((m) => m.type === "link");
    const href = typeof link?.attrs?.href === "string" && link.attrs.href.trim() ? link.attrs.href.trim() : null;
    (node.text ?? "").split(CONTACT_SEP.trim()).forEach((part, i) => {
      if (i > 0) pieces.push({ text: "", href: null });
      const piece = pieces[pieces.length - 1];
      piece.text += part;
      if (href && part.trim()) piece.href = href;
    });
  }
  return pieces.map((p) => ({ text: p.text.trim(), href: p.href })).filter((p) => p.text || p.href);
}

/** Sorts the pieces of the contact line by what they are. A linked piece keeps its address, not its label. */
function parseContact(pieces: ContactPiece[], name: string): Profile["contact"] {
  const contact = { ...emptyProfile().contact, name };
  for (const { text: raw, href } of pieces) {
    if (href && /^mailto:/i.test(href)) {
      if (!contact.email) contact.email = href.replace(/^mailto:/i, "").split("?")[0];
      continue;
    }
    // A label ("GitHub") stands for its address; text that is an address already is kept as written.
    if (href && /^(https?:\/\/|www\.)/i.test(href)) {
      contact.links.push(looksLikeLink(raw) ? raw : href);
      continue;
    }
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
 * sections, the headline and nesting of bullets have no place in a profile and are dropped.
 */
export function docToProfile(doc: DocJSON): Profile {
  const profile = emptyProfile();
  const header = headerOf(doc);
  if (header) profile.contact = parseContact(contactPieces(firstOf(header, "headerContact")), textOf(header, "headerName"));

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
          technologies: tech ? splitOutsideBrackets(tech) : [],
          bullets: bulletTexts(children(p).find((c) => c.type === "bulletList")),
          url: typeof href === "string" ? href : "",
        });
      }
    } else if (kind === "skills") {
      for (const line of children(s).filter((c) => c.type === "skillsLine")) {
        const label = textOf(line, "skillsLabel");
        const items = splitOutsideBrackets(textOf(line, "skillsItems"));
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
