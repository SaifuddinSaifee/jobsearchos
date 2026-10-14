import { describe, expect, it } from "vitest";
import type { DocJSON } from "@/lib/documents/build";
import { chunkDocument } from "@/lib/documents/convert/chunk-document";
import { docToMarkdown } from "@/lib/documents/convert/doc-to-markdown";
import { docToProfile, parseDates } from "@/lib/documents/convert/doc-to-profile";
import { docToText } from "@/lib/documents/convert/doc-to-text";
import { normalizeDoc } from "@/lib/documents/convert/normalize";
import { profileToDoc } from "@/lib/documents/convert/profile-to-doc";
import { textToDoc } from "@/lib/documents/convert/text-to-doc";
import { validateDoc } from "@/lib/documents/schema";
import { emptyProfile, type Profile } from "@/lib/profile/schema";

const counter = () => {
  let n = 0;
  return () => `id${++n}`;
};

const profile: Profile = {
  contact: { name: "Ada Lovelace", email: "ada@example.com", phone: "+44 20 7946 0000", location: "London, UK", links: ["https://github.com/ada", "linkedin.com/in/ada"] },
  summary: "Engineer who builds calculating machines.",
  experience: [
    { company: "Acme Corp", title: "Staff Engineer", location: "Remote", start: "Jan 2022", end: "", current: true, bullets: ["Cut p95 latency by 40%", "Led a team of 5"] },
    { company: "Initech", title: "Engineer", location: "Austin, TX", start: "2018", end: "2021", current: false, bullets: ["Shipped the billing rewrite"] },
  ],
  skills: [{ category: "Languages", items: ["TypeScript", "Python"] }],
  technologies: [],
  projects: [{ name: "Engine", description: "A mechanical computer", technologies: ["Brass", "Steam"], bullets: ["Built the first prototype"], url: "https://example.com/engine" }],
  education: [{ institution: "University of London", degree: "BSc", field: "Mathematics", start: "2012", end: "2016", details: "First class honours" }],
  certifications: [{ name: "AWS Solutions Architect", issuer: "", date: "" }],
  achievements: ["Won the national maths prize"],
};

describe("profileToDoc and docToProfile", () => {
  it("round trips everything a profile can hold", () => {
    const back = docToProfile(profileToDoc(profile, counter()));
    expect(back.contact).toEqual({ ...profile.contact, links: ["github.com/ada", "linkedin.com/in/ada"] });
    expect(back.summary).toBe(profile.summary);
    expect(back.experience).toEqual(profile.experience);
    expect(back.skills).toEqual(profile.skills);
    expect(back.technologies).toEqual(profile.technologies);
    expect(back.projects).toEqual(profile.projects);
    expect(back.education).toEqual(profile.education);
    expect(back.certifications).toEqual(profile.certifications);
    expect(back.achievements).toEqual(profile.achievements);
  });

  it("shows the flat technology list only when there are no skills lines to repeat it", () => {
    const withSkills = docToText(profileToDoc({ ...profile, technologies: ["Postgres"] }, counter()));
    expect(withSkills).not.toContain("Technologies: Postgres");
    const alone = profileToDoc({ ...profile, skills: [], technologies: ["Postgres", "Docker"] }, counter());
    expect(docToText(alone)).toContain("Technologies: Postgres, Docker");
    expect(docToProfile(alone).technologies).toEqual(["Postgres", "Docker"]);
  });

  it("produces a document the editor schema accepts", () => {
    const check = validateDoc(profileToDoc(profile, counter()));
    expect(check.ok, check.ok ? "" : check.error).toBe(true);
  });

  it("leaves out sections with nothing in them", () => {
    const doc = profileToDoc({ ...emptyProfile(), summary: "Hello" }, counter());
    const titles = doc.content!.filter((n) => n.type === "section").map((s) => s.attrs?.kind);
    expect(titles).toEqual(["summary"]);
    expect(validateDoc(doc).ok).toBe(true);
  });

  it("gives every section, role and bullet its own id", () => {
    const ids: string[] = [];
    const walk = (n: DocJSON) => {
      if (n.attrs?.id) ids.push(String(n.attrs.id));
      n.content?.forEach(walk);
    };
    walk(profileToDoc(profile, counter()));
    expect(ids.length).toBeGreaterThan(8);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("parseDates", () => {
  it.each([
    ["Jan 2022 - Present", { start: "Jan 2022", end: "", current: true }],
    ["2018 - 2021", { start: "2018", end: "2021", current: false }],
    ["2018 to 2021", { start: "2018", end: "2021", current: false }],
    ["2018–2021", { start: "2018", end: "2021", current: false }],
    ["Jan 2022-Present", { start: "Jan 2022", end: "", current: true }],
    ["2021", { start: "2021", end: "", current: false }],
    ["", { start: "", end: "", current: false }],
  ])("reads %j", (text, want) => {
    expect(parseDates(text)).toEqual(want);
  });
});

describe("docToText and docToMarkdown", () => {
  const doc = profileToDoc(profile, counter());

  it("writes every line of the resume as plain text", () => {
    const text = docToText(doc);
    expect(text).toContain("Ada Lovelace");
    expect(text).toContain("Staff Engineer\nJan 2022 - Present\nAcme Corp\nRemote\n  - Cut p95 latency by 40%");
    expect(text).toContain("Languages: TypeScript, Python");
  });

  it("writes Markdown with headings, bullets and links", () => {
    const md = docToMarkdown(doc);
    expect(md).toContain("# Ada Lovelace");
    expect(md).toContain("## Experience");
    expect(md).toContain("### Staff Engineer, Acme Corp, Remote");
    expect(md).toContain("*Jan 2022 - Present*");
    expect(md).toContain("- Cut p95 latency by 40%");
    expect(md).toContain("**Languages:** TypeScript, Python");
    expect(md).toContain("### [Engine](https://example.com/engine) - A mechanical computer");
    expect(md).toContain("[ada@example.com](mailto:ada@example.com)");
  });

  it("escapes characters that would become formatting", () => {
    const d: DocJSON = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "5 * 3 and [x]" }] }] };
    expect(docToMarkdown(d)).toBe("5 \\* 3 and \\[x\\]");
  });
});

describe("textToDoc", () => {
  const resume = `JANE DOE
jane@doe.dev | +1 555 123 4567 | github.com/jane
Backend engineer

SUMMARY
Builds reliable systems.

WORK EXPERIENCE
Staff Engineer, Acme  2020 - Present
• Cut costs by 30%
• Led the migration to
  Postgres across teams
- Mentored four engineers

Skills:
TypeScript, Go

REFERENCES
On request`;

  it("finds the name, contact line, headline and sections", () => {
    const doc = textToDoc(resume, { id: counter() });
    expect(validateDoc(doc).ok).toBe(true);
    const header = doc.content![0];
    expect(header.type).toBe("header");
    expect(docToText(doc)).toContain("JANE DOE");
    const kinds = doc.content!.filter((n) => n.type === "section").map((s) => s.attrs?.kind);
    expect(kinds).toEqual(["summary", "experience", "skills", "custom"]);
    const profile = docToProfile(doc);
    expect(profile.contact.email).toBe("jane@doe.dev");
    expect(profile.contact.phone).toBe("+1 555 123 4567");
    expect(profile.contact.links).toEqual(["github.com/jane"]);
    expect(profile.summary).toBe("Builds reliable systems.");
  });

  it("makes bullets, joins wrapped lines and uses title case for shouted headings", () => {
    const text = docToText(textToDoc(resume, { id: counter() }));
    expect(text).toContain("Work Experience");
    expect(text).toContain("- Cut costs by 30%");
    expect(text).toContain("- Led the migration to Postgres across teams");
    expect(text).toContain("- Mentored four engineers");
  });

  it("makes only paragraphs and bullets in letter mode", () => {
    const doc = textToDoc("Dear team,\n\nI am writing about the role.\n\n- Point one\n- Point two\n\nThanks", { mode: "letter", id: counter() });
    expect(validateDoc(doc).ok).toBe(true);
    expect(doc.content!.map((n) => n.type)).toEqual(["paragraph", "paragraph", "bulletList", "paragraph"]);
  });

  it("copes with text that has no headings", () => {
    const doc = textToDoc("Just a few words", { id: counter() });
    expect(validateDoc(doc).ok).toBe(true);
    expect(docToText(doc)).toContain("Just a few words");
  });
});

describe("normalizeDoc", () => {
  it("adds missing fields and ids without changing content", () => {
    const broken: DocJSON = {
      type: "doc",
      content: [
        {
          type: "section",
          attrs: { kind: "nonsense" },
          content: [
            { type: "sectionTitle", content: [{ type: "text", text: "Experience" }] },
            { type: "role", content: [{ type: "roleCompany", content: [{ type: "text", text: "Acme" }] }] },
          ],
        },
      ],
    };
    expect(validateDoc(broken).ok).toBe(false);
    const fixed = normalizeDoc(broken, counter());
    const check = validateDoc(fixed);
    expect(check.ok, check.ok ? "" : check.error).toBe(true);
    const section = fixed.content![0];
    expect(section.attrs).toMatchObject({ kind: "custom" });
    const role = section.content![1];
    expect(role.content!.map((c) => c.type)).toEqual(["roleTitle", "roleDates", "roleCompany", "roleLocation"]);
    expect(role.attrs?.id).toBeTruthy();
    expect(docToText(fixed)).toContain("Acme");
  });

  it("replaces duplicate ids", () => {
    const doc: DocJSON = {
      type: "doc",
      content: [{ type: "bulletList", content: [1, 2].map(() => ({ type: "bullet", attrs: { id: "same" }, content: [{ type: "paragraph" }] })) }],
    };
    const ids = normalizeDoc(doc, counter()).content![0].content!.map((b) => b.attrs?.id);
    expect(new Set(ids).size).toBe(2);
  });
});

describe("chunkDocument", () => {
  it("chunks a structured resume like chunkProfile does", () => {
    const chunks = chunkDocument(profileToDoc(profile, counter()));
    expect(chunks.map((c) => c.section)).toEqual(expect.arrayContaining(["summary", "experience", "projects", "skills", "education"]));
    const staff = chunks.find((c) => c.label === "Staff Engineer at Acme Corp");
    expect(staff?.text).toContain("- Cut p95 latency by 40%");
  });

  it("keeps the text of a resume that was only split into headings and bullets", () => {
    const doc = textToDoc("JANE DOE\n\nEXPERIENCE\nStaff Engineer, Acme\n- Cut costs by 30%\n\nHOBBIES\nChess and rowing", { id: counter() });
    const chunks = chunkDocument(doc);
    expect(chunks.find((c) => c.section === "experience")?.text).toContain("Cut costs by 30%");
    expect(chunks.find((c) => c.section === "custom")?.text).toContain("Chess and rowing");
  });

  it("splits a cover letter by paragraph", () => {
    const chunks = chunkDocument(textToDoc("Dear team,\n\nThis is my letter.", { mode: "letter", id: counter() }));
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].text).toContain("Dear team");
  });
});
