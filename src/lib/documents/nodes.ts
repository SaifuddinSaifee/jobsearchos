import { Node, type Extensions } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";

// No React and no DOM in this file: the server loads it to render the PDF and to check content.
// Fields (a role's title, dates...) are plain text blocks, so the browser gives undo, selection, spell check and
// paste for free; the role line layout is CSS on the class names below.

export const SECTION_KINDS = [
  "summary",
  "experience",
  "projects",
  "skills",
  "education",
  "certifications",
  "achievements",
  "custom",
] as const;
export type SectionKind = (typeof SECTION_KINDS)[number];

/** Nodes that carry a stable id, so later features (career record, fit highlights) can point at them. */
export const ID_NODE_TYPES = ["section", "role", "project", "education", "skillsLine", "bullet"] as const;

/** Required text fields of a container, in order. */
export const FIELD_SEQUENCES = {
  header: ["headerName", "headerHeadline", "headerContact"],
  section: ["sectionTitle"],
  role: ["roleTitle", "roleDates", "roleCompany", "roleLocation"],
  project: ["projectName", "projectDetail", "projectTech"],
  education: ["eduInstitution", "eduDates", "eduDegree", "eduDetails"],
  skillsLine: ["skillsLabel", "skillsItems"],
} as const;

/** Fields a container may do without. They are never added for you, and the writer can delete them. */
export const OPTIONAL_FIELDS: ReadonlySet<string> = new Set(["headerHeadline"]);

export const FIELD_TYPES: readonly string[] = Object.values(FIELD_SEQUENCES).flat();

/** Everything a resume, cover letter or email can contain. */
export const NODE_TYPES = [
  "doc",
  "text",
  "paragraph",
  "bulletList",
  "bullet",
  "divider",
  "header",
  "section",
  "role",
  "project",
  "education",
  "skillsLine",
  ...FIELD_TYPES,
] as const;

export const MARK_TYPES = ["bold", "italic", "underline", "link"] as const;

const MARKS = "bold italic underline link";

const idAttribute = {
  id: {
    default: null as string | null,
    parseHTML: (el: HTMLElement) => el.getAttribute("data-id"),
    renderHTML: (attrs: Record<string, unknown>) => (attrs.id ? { "data-id": String(attrs.id) } : {}),
  },
};

/** A single-line text block. `marks: ""` means no formatting is allowed inside it. */
function field(name: string, tag: string, cls: string, marks = MARKS) {
  return Node.create({
    name,
    content: "inline*",
    marks,
    parseHTML: () => [{ tag: `${tag}.${cls}` }],
    renderHTML: ({ HTMLAttributes }) => [tag, { ...HTMLAttributes, class: cls }, 0],
  });
}

/** A block made of fixed fields and, optionally, a bullet list. */
function container(opts: {
  name: string;
  tag: string;
  cls: string;
  content: string;
  kindAttr?: boolean;
}) {
  return Node.create({
    name: opts.name,
    content: opts.content,
    defining: true,
    addAttributes() {
      return {
        ...idAttribute,
        ...(opts.kindAttr
          ? {
              kind: {
                default: "custom",
                parseHTML: (el: HTMLElement) => el.getAttribute("data-kind") ?? "custom",
                renderHTML: (attrs: Record<string, unknown>) => ({ "data-kind": String(attrs.kind ?? "custom") }),
              },
            }
          : {}),
      };
    },
    parseHTML: () => [{ tag: `${opts.tag}.${opts.cls}` }],
    renderHTML: ({ HTMLAttributes }) => [opts.tag, { ...HTMLAttributes, class: opts.cls }, 0],
  });
}

const Doc = Node.create({
  name: "doc",
  topNode: true,
  // A resume has a header and sections; a cover letter or email is just paragraphs and bullets.
  content: "header? (section | paragraph | bulletList | divider)*",
});

const Header = container({
  name: "header",
  tag: "header",
  cls: "rs-header",
  content: "headerName headerHeadline? headerContact",
});

const Section = container({
  name: "section",
  tag: "section",
  cls: "rs-section",
  content: "sectionTitle (role | project | education | skillsLine | paragraph | bulletList)*",
  kindAttr: true,
});

const Role = container({ name: "role", tag: "div", cls: "rs-role", content: "roleTitle roleDates roleCompany roleLocation bulletList?" });
const Project = container({ name: "project", tag: "div", cls: "rs-project", content: "projectName projectDetail projectTech bulletList?" });
const Education = container({ name: "education", tag: "div", cls: "rs-edu", content: "eduInstitution eduDates eduDegree eduDetails bulletList?" });
const SkillsLine = container({ name: "skillsLine", tag: "div", cls: "rs-skills", content: "skillsLabel skillsItems" });

const BulletList = Node.create({
  name: "bulletList",
  content: "bullet+",
  parseHTML: () => [{ tag: "ul.rs-bullets" }],
  renderHTML: ({ HTMLAttributes }) => ["ul", { ...HTMLAttributes, class: "rs-bullets" }, 0],
});

const Bullet = Node.create({
  name: "bullet",
  content: "paragraph bulletList?",
  defining: true,
  addAttributes: () => idAttribute,
  parseHTML: () => [{ tag: "li.rs-bullet" }],
  renderHTML: ({ HTMLAttributes }) => ["li", { ...HTMLAttributes, class: "rs-bullet" }, 0],
});

const Divider = Node.create({
  name: "divider",
  group: "block",
  atom: true,
  selectable: true,
  parseHTML: () => [{ tag: "hr.rs-divider" }],
  renderHTML: ({ HTMLAttributes }) => ["hr", { ...HTMLAttributes, class: "rs-divider" }],
});

const fields = [
  field("headerName", "h1", "rs-name", ""),
  field("headerHeadline", "div", "rs-headline", "bold italic"),
  field("headerContact", "div", "rs-contact", "link"),
  field("sectionTitle", "h2", "rs-section-title", ""),
  field("roleTitle", "div", "rs-role-title"),
  field("roleDates", "div", "rs-role-dates", ""),
  field("roleCompany", "div", "rs-role-company"),
  field("roleLocation", "div", "rs-role-location", ""),
  field("projectName", "div", "rs-project-name"),
  field("projectDetail", "div", "rs-project-detail"),
  field("projectTech", "div", "rs-project-tech", ""),
  field("eduInstitution", "div", "rs-edu-institution"),
  field("eduDates", "div", "rs-edu-dates", ""),
  field("eduDegree", "div", "rs-edu-degree"),
  field("eduDetails", "div", "rs-edu-details"),
  field("skillsLabel", "span", "rs-skills-label", "bold"),
  field("skillsItems", "span", "rs-skills-items"),
];

/** Mark rules shared by the editor, the PDF and the checks: links go to http, https or mailto only. */
export const SAFE_LINK = /^(https?:|mailto:)/i;

/** Hint text shown in an empty field while editing. Never part of the export. */
export const PLACEHOLDERS: Record<string, string> = {
  headerName: "Your name",
  headerHeadline: "Headline",
  headerContact: "Email | phone | location | links",
  sectionTitle: "Section title",
  roleTitle: "Job title",
  roleDates: "Jan 2022 - Present",
  roleCompany: "Company",
  roleLocation: "Location",
  projectName: "Project name",
  projectDetail: "What it is",
  projectTech: "Technologies: ...",
  eduInstitution: "School",
  eduDates: "2018 - 2022",
  eduDegree: "Degree",
  eduDetails: "Details",
  skillsLabel: "Label",
  skillsItems: "Skill, skill, skill",
  paragraph: "Type / for blocks",
};

/** The schema: every node and mark, with the same rendering the editor and the PDF use. */
export const documentExtensions: Extensions = [
  Doc,
  Header,
  Section,
  Role,
  Project,
  Education,
  SkillsLine,
  BulletList,
  Bullet,
  Divider,
  ...fields,
  StarterKit.configure({
    document: false,
    heading: false,
    blockquote: false,
    codeBlock: false,
    code: false,
    strike: false,
    orderedList: false,
    bulletList: false,
    listItem: false,
    listKeymap: false,
    horizontalRule: false,
    hardBreak: false,
    trailingNode: false,
    link: {
      openOnClick: false,
      autolink: false,
      linkOnPaste: true,
      isAllowedUri: (url) => SAFE_LINK.test(url),
      HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" },
    },
  }),
];
