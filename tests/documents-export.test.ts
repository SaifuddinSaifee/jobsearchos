import { existsSync } from "node:fs";
import JSZip from "jszip";
import mammoth from "mammoth";
import { chromium } from "playwright";
import { extractText, getDocumentProxy } from "unpdf";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closeBrowser } from "@/lib/browser";
import type { DocJSON } from "@/lib/documents/build";
import { profileToDoc } from "@/lib/documents/convert/profile-to-doc";
import { textToDoc } from "@/lib/documents/convert/text-to-doc";
import { renderDocx } from "@/lib/documents/export/docx";
import { exportDocument, exportFilename, formatsFor } from "@/lib/documents/export";
import { renderPdf } from "@/lib/documents/export/pdf";
import { defaultPageSettings } from "@/lib/documents/page-settings";
import { createDocument, listVersions, saveDraft } from "@/lib/documents/service";
import { emptyProfile, type Profile } from "@/lib/profile/schema";
import { resetDb, testDb } from "./helpers";

process.env.DATABASE_URL ??= "postgres://unused";
vi.mock("@/lib/llm/client", () => ({ together: () => ({}) }));

const db = testDb();
beforeEach(() => resetDb(db));
afterAll(async () => {
  await closeBrowser();
  await db.$client.end();
});

const settings = defaultPageSettings();

function profile(roles = 2, bullets = 3): Profile {
  const p = emptyProfile();
  p.contact = { name: "Ada Lovelace", email: "ada@example.com", phone: "+44 20 7946 0000", location: "London, UK", links: ["https://github.com/ada"] };
  p.summary = "Engineer who builds calculating machines.";
  p.experience = Array.from({ length: roles }, (_, r) => ({
    company: `Company ${r + 1}`,
    title: `Engineer ${r + 1}`,
    location: "Remote",
    start: `${2010 + r * 2}`,
    end: `${2012 + r * 2}`,
    current: false,
    bullets: Array.from({ length: bullets }, (_, b) => `Role ${r + 1} bullet ${b + 1}: shipped a measurable improvement to the system`),
  }));
  p.projects = [{ name: "Engine", description: "A mechanical computer", technologies: ["Brass", "Steam"], bullets: ["Built the first prototype"], url: "" }];
  p.skills = [{ category: "Languages", items: ["TypeScript", "Python"] }];
  p.education = [{ institution: "University of London", degree: "BSc", field: "Mathematics", start: "2006", end: "2010", details: "" }];
  return p;
}

const resume = (p = profile()): DocJSON => profileToDoc(p);

describe("exportFilename", () => {
  it("joins name, company and role, leaving out what is missing", () => {
    expect(exportFilename({ name: "Ada Lovelace", title: "t", company: "Acme", role: "Engineer" }, "pdf")).toBe("Ada Lovelace - Acme - Engineer.pdf");
    expect(exportFilename({ name: "Ada Lovelace", title: "t", company: null, role: "Engineer" }, "docx")).toBe("Ada Lovelace - Engineer.docx");
    expect(exportFilename({ name: "", title: "Cover letter for Acme", company: "Acme" }, "md")).toBe("Cover letter for Acme.md");
  });

  it("removes characters that are not allowed in file names", () => {
    expect(exportFilename({ name: 'A/B: "C"', title: "t", company: "X*Y?" }, "pdf")).toBe("A B C - X Y.pdf");
    expect(exportFilename({ title: "", name: "" }, "txt")).toBe("document.txt");
  });

  it("offers an email only the text formats", () => {
    expect(formatsFor("email")).toEqual(["md", "txt"]);
    expect(formatsFor("resume")).toEqual(["pdf", "docx", "md", "txt"]);
  });
});

describe("exportDocument", () => {
  const fakePdf = vi.fn(async () => ({ bytes: Buffer.from("%PDF-fake"), pages: 1 }));
  const fakeDocx = vi.fn(async () => Buffer.from("docx-fake"));
  const deps = { db, pdf: fakePdf, docx: fakeDocx };
  beforeEach(() => {
    fakePdf.mockClear();
    fakeDocx.mockClear();
  });

  it("names the file after the person, company and role, and returns the page count", async () => {
    const { document } = await createDocument({ kind: "resume", origin: "blank", title: "R", content: resume(), companyName: "Acme", targetRole: "Engineer" }, db);
    const out = await exportDocument(document.id, { format: "pdf" }, deps);
    expect(out).toMatchObject({ filename: "Ada Lovelace - Acme - Engineer.pdf", mime: "application/pdf", pages: 1 });
    expect(out.bytes.toString()).toBe("%PDF-fake");
  });

  it("saves a version for a PDF or Word file only when something changed since the last one", async () => {
    const { document } = await createDocument({ kind: "resume", origin: "blank", title: "R", content: resume() }, db);
    const first = await exportDocument(document.id, { format: "pdf" }, deps);
    expect(first.versionCreated).toBe(false);
    expect(first.version?.version).toBe(1);

    await saveDraft(document.id, { content: resume({ ...profile(), summary: "Changed." }), revision: 1 }, db);
    const second = await exportDocument(document.id, { format: "docx" }, deps);
    expect(second).toMatchObject({ versionCreated: true });
    expect(second.version).toMatchObject({ version: 2, reason: "export" });
    expect((await listVersions(document.id, db)).map((v) => v.version)).toEqual([2, 1]);
  });

  it("does not save a version for Markdown or text", async () => {
    const { document } = await createDocument({ kind: "resume", origin: "blank", title: "R", content: resume() }, db);
    await saveDraft(document.id, { content: resume({ ...profile(), summary: "Edited." }), revision: 1 }, db);
    const md = await exportDocument(document.id, { format: "md" }, deps);
    expect(md.version).toBeUndefined();
    expect(md.bytes.toString()).toContain("Edited.");
    expect((await listVersions(document.id, db)).length).toBe(1);
  });

  it("exports an older version as it was, with the page settings it was made with", async () => {
    const { document, version } = await createDocument({ kind: "resume", origin: "blank", title: "R", content: resume(), pageSettings: { density: 7 } }, db);
    await saveDraft(document.id, { content: resume({ ...profile(), summary: "Newer." }), revision: 1 }, db);
    const out = await exportDocument(document.id, { format: "txt", versionId: version.id }, deps);
    expect(out.bytes.toString()).toContain("Engineer who builds calculating machines.");
    expect(out.bytes.toString()).not.toContain("Newer.");
    const pdf = await exportDocument(document.id, { format: "pdf", versionId: version.id }, deps);
    expect(pdf.settings.density).toBe(7);
    expect((fakePdf.mock.calls[0] as unknown[])[1]).toMatchObject({ density: 7 });
  });

  it("puts an email's subject first, and refuses PDF and Word for it", async () => {
    const { document } = await createDocument({ kind: "email", origin: "blank", title: "E", content: textToDoc("Hi Sam,\n\nA short note.", { mode: "letter" }), subject: "Quick question" }, db);
    const txt = await exportDocument(document.id, { format: "txt" }, deps);
    expect(txt.bytes.toString().startsWith("Subject: Quick question\n\nHi Sam,")).toBe(true);
    expect(txt.filename).toBe("E.txt");
    await expect(exportDocument(document.id, { format: "pdf" }, deps)).rejects.toMatchObject({ code: "blocked" });
  });

  it("refuses another document's version and an unknown document", async () => {
    const a = await createDocument({ kind: "resume", origin: "blank", title: "A", content: resume() }, db);
    const b = await createDocument({ kind: "resume", origin: "blank", title: "B", content: resume() }, db);
    await expect(exportDocument(a.document.id, { format: "md", versionId: b.version.id }, deps)).rejects.toMatchObject({ code: "not_found" });
    await expect(exportDocument("00000000-0000-4000-8000-000000000000", { format: "md" }, deps)).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("renderDocx", () => {
  const bulletsInOrder = ["Role 1 bullet 1", "Role 1 bullet 2", "Role 1 bullet 3", "Role 2 bullet 1"];

  it("makes an A4 Word file with the text in order", async () => {
    const bytes = await renderDocx(resume(), settings, { title: "Ada" });
    const zip = await JSZip.loadAsync(bytes);
    const xml = await zip.file("word/document.xml")!.async("string");
    expect(xml).toMatch(/<w:pgSz[^>]*w:w="11906"[^>]*w:h="16838"/);

    const text = (await mammoth.extractRawText({ buffer: bytes })).value;
    let at = -1;
    for (const b of ["Ada Lovelace", "EXPERIENCE", "Engineer 1", "Company 1", ...bulletsInOrder, "EDUCATION", "University of London"]) {
      const next = text.indexOf(b, at + 1);
      expect(next, `"${b}" should come after the previous part`).toBeGreaterThan(at);
      at = next;
    }
  });

  it("uses real Word bullets, the chosen font and the page margins", async () => {
    const bytes = await renderDocx(resume(), { ...settings, font: "tinos", density: 8 }, {});
    const zip = await JSZip.loadAsync(bytes);
    const numbering = await zip.file("word/numbering.xml")!.async("string");
    expect(numbering).toContain(String.fromCharCode(0x2022));
    const styles = await zip.file("word/styles.xml")!.async("string");
    expect(styles).toContain("Times New Roman");
    const xml = await zip.file("word/document.xml")!.async("string");
    expect(xml).toContain("<w:numPr>");
    // Half-inch margins by default (12.7 mm is 720 twips), whatever the spacing.
    expect(xml).toMatch(/w:top="720"/);
    const wide = await JSZip.loadAsync(await renderDocx(resume(), { ...settings, margins: "wide" }, {}));
    expect(await wide.file("word/document.xml")!.async("string")).toMatch(/w:top="1440"/);
  });

  it("keeps links and text marks, and aligns dates on a right tab", async () => {
    const bytes = await renderDocx(resume(), settings, {});
    const zip = await JSZip.loadAsync(bytes);
    const xml = await zip.file("word/document.xml")!.async("string");
    expect(xml).toContain("<w:hyperlink");
    expect(xml).toContain('w:val="right"');
    const rels = await zip.file("word/_rels/document.xml.rels")!.async("string");
    expect(rels).toContain("mailto:ada@example.com");
  });

  it("writes the role as one line: title, company, location, then the dates", async () => {
    const text = (await mammoth.extractRawText({ buffer: await renderDocx(resume(), settings, {}) })).value;
    expect(text).toMatch(/Engineer 1, Company 1, Remote\s+2010/);
  });

  it("writes a project as one line: name, then what it is", async () => {
    const text = (await mammoth.extractRawText({ buffer: await renderDocx(resume(), settings, {}) })).value;
    expect(text).toContain("Engine - A mechanical computer");
  });

  it("makes a letter from plain paragraphs", async () => {
    const letter = textToDoc("Dear team,\n\nI would like to apply.\n\n- Point one\n- Point two", { mode: "letter" });
    const text = (await mammoth.extractRawText({ buffer: await renderDocx(letter, settings, {}) })).value;
    expect(text).toContain("Dear team,");
    expect(text).toContain("Point two");
  });
});

const hasChromium = (() => {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();

describe.skipIf(!hasChromium)("renderPdf", () => {
  const pdfText = async (bytes: Buffer) => (await extractText(await getDocumentProxy(new Uint8Array(bytes)), { mergePages: true })).text;

  it("makes a one page A4 PDF with real text in order", async () => {
    const out = await renderPdf(resume(), settings, { title: "Ada" });
    expect(out.pages).toBe(1);
    expect(out.bytes.subarray(0, 4).toString()).toBe("%PDF");
    const pdf = await getDocumentProxy(new Uint8Array(out.bytes));
    const page = await pdf.getPage(1);
    const [w, h] = [page.view[2], page.view[3]];
    expect(Math.round(w)).toBe(595);
    expect(Math.round(h)).toBe(842);

    const text = await pdfText(out.bytes);
    // A style that strips list indentation would put bullet text level with the role title and leave no room for markers.
    const items = (await page.getTextContent()).items as { str: string; transform: number[] }[];
    const x = (s: string) => items.find((i) => i.str.includes(s))!.transform[4];
    expect(x("Role 1 bullet 1")).toBeGreaterThan(x("Engineer 1") + 8);
    let at = -1;
    for (const b of ["Ada Lovelace", "EXPERIENCE", "Engineer 1", ...bulletsOf(2)]) {
      const next = text.indexOf(b, at + 1);
      expect(next, `"${b}" should come after the previous part`).toBeGreaterThan(at);
      at = next;
    }
  }, 60_000);

  it("puts title, company and location on one line with the dates at the right, and leaves no gap for a missing headline", async () => {
    const out = await renderPdf(resume(), settings, { title: "Ada" });
    const page = await (await getDocumentProxy(new Uint8Array(out.bytes))).getPage(1);
    const items = ((await page.getTextContent()).items as { str: string; transform: number[] }[]).filter((i) => i.str.trim());
    const at = (s: string) => items.find((i) => i.str.includes(s))!.transform;
    const [title, company, location, dates] = [at("Engineer 1"), at("Company 1"), at("Remote"), at("2010")];
    expect(Math.abs(company[5] - title[5])).toBeLessThan(1);
    expect(Math.abs(location[5] - title[5])).toBeLessThan(1);
    expect(Math.abs(dates[5] - title[5])).toBeLessThan(1);
    expect(company[4]).toBeGreaterThan(title[4]);
    expect(location[4]).toBeGreaterThan(company[4]);
    expect(dates[4]).toBeGreaterThan(location[4] + 100);
    // A project's name and its short description share a line, and the technologies are on the next one.
    const [name, detail, tech] = [items.find((i) => i.str.trim() === "Engine")!.transform, at("A mechanical computer"), at("Technologies")];
    expect(Math.abs(detail[5] - name[5])).toBeLessThan(1);
    expect(detail[4]).toBeGreaterThan(name[4]);
    expect(name[5] - tech[5]).toBeGreaterThan(8);
    // The contact line sits directly under the name: about one line, not two.
    expect(at("Ada Lovelace")[5] - at("ada@example.com")[5]).toBeLessThan(32);
  }, 60_000);

  it("runs to a second page when the content is long, and tighter spacing brings it back to one", async () => {
    const long = resume(profile(6, 5));
    const roomy = await renderPdf(long, { ...settings, density: 0 }, { title: "Long" });
    expect(roomy.pages).toBeGreaterThan(1);
    const tight = await renderPdf(long, { ...settings, density: 8 }, { title: "Long" });
    expect(tight.pages).toBeLessThanOrEqual(roomy.pages);
    expect(await pdfText(roomy.bytes)).toContain("Role 6 bullet 5");
  }, 60_000);

  it("uses the bundled font and loads nothing from the network", async () => {
    const out = await renderPdf(resume(), settings, { title: "Ada" });
    const raw = out.bytes.toString("latin1");
    expect(raw).toMatch(/Carlito/);
  }, 60_000);
});

function bulletsOf(roles: number) {
  return Array.from({ length: roles }, (_, r) => `Role ${r + 1} bullet 1`);
}
