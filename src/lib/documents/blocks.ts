import { emptyBullets, newId, paragraph, section, textField, type DocJSON, type IdGen } from "./build";
import type { SectionKind } from "./nodes";

// Empty blocks to insert while writing: what the slash menu and the Enter key add.

export const emptyRole = (id: IdGen = newId): DocJSON => ({
  type: "role",
  attrs: { id: id() },
  content: [textField("roleTitle", ""), textField("roleDates", ""), textField("roleCompany", ""), textField("roleLocation", "")],
});

export const emptyProject = (id: IdGen = newId): DocJSON => ({
  type: "project",
  attrs: { id: id() },
  content: [textField("projectName", ""), textField("projectDetail", ""), textField("projectTech", "")],
});

export const emptyEducation = (id: IdGen = newId): DocJSON => ({
  type: "education",
  attrs: { id: id() },
  content: [textField("eduInstitution", ""), textField("eduDates", ""), textField("eduDegree", ""), textField("eduDetails", "")],
});

export const emptySkillsLine = (id: IdGen = newId): DocJSON => ({
  type: "skillsLine",
  attrs: { id: id() },
  content: [textField("skillsLabel", ""), textField("skillsItems", "")],
});

export const emptyParagraph = (): DocJSON => paragraph("");

export const emptyHeader = (): DocJSON => ({
  type: "header",
  content: [textField("headerName", ""), textField("headerContact", "")],
});

/** What a new section of each kind starts with, so it is ready to type into. */
const STARTERS: Record<SectionKind, (id: IdGen) => DocJSON[]> = {
  summary: () => [emptyParagraph()],
  experience: (id) => [emptyRole(id)],
  projects: (id) => [emptyProject(id)],
  skills: (id) => [emptySkillsLine(id)],
  education: (id) => [emptyEducation(id)],
  certifications: (id) => [emptyBullets(id)],
  achievements: (id) => [emptyBullets(id)],
  custom: () => [emptyParagraph()],
};

export const SECTION_TITLES: Record<SectionKind, string> = {
  summary: "Summary",
  experience: "Experience",
  projects: "Projects",
  skills: "Skills",
  education: "Education",
  certifications: "Certifications",
  achievements: "Achievements",
  custom: "",
};

export function emptySection(kind: SectionKind, title = SECTION_TITLES[kind], id: IdGen = newId): DocJSON {
  return section(kind, title, STARTERS[kind](id), id);
}
