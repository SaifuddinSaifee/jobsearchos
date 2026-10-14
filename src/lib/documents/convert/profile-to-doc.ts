import type { Profile } from "@/lib/profile/schema";
import {
  bulletList,
  inline,
  linkMark,
  newId,
  paragraph,
  safeHref,
  section,
  textField,
  type DocJSON,
  type IdGen,
  type Mark,
} from "../build";

/** The separator between pieces of the contact line, and between dates. Plain ASCII so it survives every format. */
export const CONTACT_SEP = " | ";
export const DATE_SEP = " - ";

export function formatDates(start: string, end: string, current: boolean): string {
  const last = current ? "Present" : end;
  return [start, last].map((s) => s.trim()).filter(Boolean).join(DATE_SEP);
}

/** Shows a web address without its scheme ("https://github.com/x" becomes "github.com/x"). */
const display = (href: string) => href.replace(/^(https?:\/\/|mailto:)/i, "").replace(/\/$/, "");

function contactLine(c: Profile["contact"]): DocJSON {
  const pieces: DocJSON[][] = [];
  if (c.email.trim()) pieces.push(inline(c.email.trim(), safeHref(c.email) ? [linkMark(`mailto:${c.email.trim()}`)] : undefined));
  if (c.phone.trim()) pieces.push(inline(c.phone.trim()));
  if (c.location.trim()) pieces.push(inline(c.location.trim()));
  for (const link of c.links) {
    const href = safeHref(link);
    if (href) pieces.push(inline(display(href), [linkMark(href)] as Mark[]));
    else if (link.trim()) pieces.push(inline(link.trim()));
  }
  const content = pieces.flatMap((p, i) => (i === 0 ? p : [...inline(CONTACT_SEP), ...p]));
  // Adjacent text nodes with the same marks would merge on load; build them already separated by the plain separator.
  return { type: "headerContact", ...(content.length ? { content } : {}) };
}

/**
 * A structured resume as an editor document. Sections with nothing in them are left out. The inverse is
 * `docToProfile`; they agree on everything the profile can hold.
 */
export function profileToDoc(p: Profile, id: IdGen = newId): DocJSON {
  const sections: DocJSON[] = [];

  if (p.summary.trim()) sections.push(section("summary", "Summary", [paragraph(p.summary.trim())], id));

  if (p.experience.length > 0) {
    sections.push(
      section(
        "experience",
        "Experience",
        p.experience.map((e) => {
          const list = bulletList(e.bullets, id);
          return {
            type: "role",
            attrs: { id: id() },
            content: [
              textField("roleTitle", e.title.trim()),
              textField("roleDates", formatDates(e.start, e.end, e.current)),
              textField("roleCompany", e.company.trim()),
              textField("roleLocation", e.location.trim()),
              ...(list ? [list] : []),
            ],
          };
        }),
        id,
      ),
    );
  }

  if (p.projects.length > 0) {
    sections.push(
      section(
        "projects",
        "Projects",
        p.projects.map((pr) => {
          const href = pr.url.trim() ? safeHref(pr.url) : null;
          const list = bulletList(pr.bullets, id);
          return {
            type: "project",
            attrs: { id: id() },
            content: [
              textField("projectName", pr.name.trim(), href ? [linkMark(href)] : undefined),
              textField("projectDetail", pr.description.trim()),
              textField("projectTech", pr.technologies.length ? `Technologies: ${pr.technologies.join(", ")}` : ""),
              ...(list ? [list] : []),
            ],
          };
        }),
        id,
      ),
    );
  }

  const skillLines: DocJSON[] = p.skills
    .filter((s) => s.items.length > 0)
    .map((s) => ({
      type: "skillsLine",
      attrs: { id: id() },
      content: [textField("skillsLabel", s.category.trim()), textField("skillsItems", s.items.join(", "))],
    }));
  // The flat technology list mostly repeats the skills, so it is only shown when there are no skills lines to show.
  if (p.technologies.length > 0 && skillLines.length === 0) {
    skillLines.push({
      type: "skillsLine",
      attrs: { id: id() },
      content: [textField("skillsLabel", "Technologies"), textField("skillsItems", p.technologies.join(", "))],
    });
  }
  if (skillLines.length > 0) sections.push(section("skills", "Skills", skillLines, id));

  if (p.education.length > 0) {
    sections.push(
      section(
        "education",
        "Education",
        p.education.map((ed) => ({
          type: "education",
          attrs: { id: id() },
          content: [
            textField("eduInstitution", ed.institution.trim()),
            textField("eduDates", formatDates(ed.start, ed.end, false)),
            textField("eduDegree", [ed.degree.trim(), ed.field.trim()].filter(Boolean).join(" in ")),
            textField("eduDetails", ed.details.trim()),
          ],
        })),
        id,
      ),
    );
  }

  const certs = bulletList(p.certifications.map((c) => [c.name, c.issuer, c.date].map((s) => s.trim()).filter(Boolean).join(", ")), id);
  if (certs) sections.push(section("certifications", "Certifications", [certs], id));

  const wins = bulletList(p.achievements, id);
  if (wins) sections.push(section("achievements", "Achievements", [wins], id));

  const c = p.contact;
  const header: DocJSON = {
    type: "header",
    content: [textField("headerName", c.name.trim()), contactLine(c)],
  };

  return { type: "doc", content: [header, ...sections] };
}
