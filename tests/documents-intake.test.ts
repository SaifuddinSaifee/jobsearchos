import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { documents, files } from "@/lib/db/schema";
import { htmlToResumeText } from "@/lib/documents/convert/html-to-text";
import { docToText } from "@/lib/documents/convert/doc-to-text";
import { textToDoc } from "@/lib/documents/convert/text-to-doc";
import { extractForDocument } from "@/lib/documents/extract";
import { blankContent, contentFromText, createFromUpload, findBySha, sha256, splitSubject } from "@/lib/documents/intake";
import { latestVersion } from "@/lib/documents/service";
import { validateDoc } from "@/lib/documents/schema";
import { DOCX_MIME, makeDocx } from "./docx";
import { resetDb, testDb } from "./helpers";

process.env.DATABASE_URL ??= "postgres://unused";
const queued = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/lib/documents/queue", () => ({ enqueueAfterCreate: queued }));

const db = testDb();
let dir: string;
beforeEach(async () => {
  await resetDb(db);
  queued.mockClear();
  dir = await mkdtemp(path.join(tmpdir(), "jt-intake-"));
});
afterAll(async () => {
  await db.$client.end();
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe("htmlToResumeText", () => {
  const html = `<h1>Jane Doe</h1><p>jane@doe.dev</p><h2>Experience</h2><p><strong>Staff Engineer</strong>, Acme</p>
    <ul><li>Cut costs by 30%<ul><li>Across three teams</li></ul></li><li>Led the migration</li></ul>
    <table><tr><td><p>Skills</p></td><td><p>TypeScript, Go</p></td></tr></table><p></p><p>Closing  line</p>`;

  it("keeps list items as bullets, nested ones included", () => {
    const { text } = htmlToResumeText(html);
    expect(text).toContain("- Cut costs by 30%\n- Across three teams\n- Led the migration");
  });

  it("reports lines in a heading style, and reads tables cell by cell", () => {
    const { text, headings } = htmlToResumeText(html);
    expect([...headings]).toEqual(["Jane Doe", "Experience"]);
    expect(text).toContain("Skills\nTypeScript, Go");
    expect(text).toContain("Closing line");
  });

  it("is turned into sections by textToDoc", () => {
    const { text, headings } = htmlToResumeText(html);
    const doc = textToDoc(text, { headings });
    expect(validateDoc(doc).ok).toBe(true);
    const kinds = doc.content!.filter((n) => n.type === "section").map((s) => s.attrs?.kind);
    expect(kinds).toEqual(["experience", "skills"]);
  });

  it("treats a line the file marked as a heading as one, even with an unusual name", () => {
    const doc = textToDoc("JANE\n\nTalks and Writing\nGave a talk\n", { headings: new Set(["Talks and Writing"]) });
    expect(doc.content!.some((n) => n.type === "section" && n.attrs?.kind === "custom")).toBe(true);
  });
});

describe("extractForDocument", () => {
  it("reads a docx", async () => {
    const out = await extractForDocument(await makeDocx(["Jane Doe", "Staff Engineer at Acme"]), "jane.docx", DOCX_MIME);
    expect(out).toMatchObject({ kind: "docx", mime: DOCX_MIME });
    expect(out.text).toContain("Staff Engineer at Acme");
  });

  it("refuses other types and oversize files", async () => {
    await expect(extractForDocument(Buffer.from("x"), "notes.txt", "text/plain")).rejects.toThrow(/PDF and DOCX/);
    await expect(extractForDocument(Buffer.alloc(11 * 1024 * 1024), "big.pdf", "application/pdf")).rejects.toThrow(/10 MB/);
  });
});

describe("text to content", () => {
  it("splits the subject off a pasted email", () => {
    expect(splitSubject("Subject: Hello there\n\nHi Sam,\n\nBody")).toEqual({ subject: "Hello there", body: "Hi Sam,\n\nBody" });
    expect(splitSubject("Hi Sam")).toEqual({ subject: "", body: "Hi Sam" });
  });

  it("reads each kind the way it is written", () => {
    expect(contentFromText("email", "Subject: Hi\n\nHello").subject).toBe("Hi");
    const resume = contentFromText("resume", "JANE DOE\n\nEXPERIENCE\nEngineer").content;
    expect(resume.content?.some((n) => n.type === "section")).toBe(true);
    const letter = contentFromText("cover_letter", "Dear team,\n\nHello").content;
    expect(letter.content?.every((n) => n.type === "paragraph")).toBe(true);
  });

  it("makes blank documents the editor accepts", () => {
    for (const kind of ["resume", "cover_letter", "email"] as const) {
      const check = validateDoc(blankContent(kind));
      expect(check.ok, check.ok ? "" : check.error).toBe(true);
    }
  });
});

describe("createFromUpload", () => {
  const upload = async (over: Partial<Parameters<typeof createFromUpload>[0]> = {}) =>
    createFromUpload({ bytes: await makeDocx(["Jane Doe", "EXPERIENCE", "Staff Engineer at Acme"]), name: "jane.docx", mime: DOCX_MIME, kind: "resume", ...over }, { db });

  it("files a resume with its content, details and hash, keeps no file, and queues indexing", async () => {
    const out = await upload({ title: "For Acme", targetRole: "Engineer", jdText: "We hire" });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const [doc] = await db.select().from(documents).where(eq(documents.id, out.id));
    expect(doc).toMatchObject({ kind: "resume", origin: "uploaded", title: "For Acme", targetRole: "Engineer", jdText: "We hire", sourceName: "jane.docx", sourceMime: DOCX_MIME, isBase: false });
    expect(doc.sourceSha256).toHaveLength(64);
    // Only content is kept: the file would be stored only if it left the app as an attachment.
    expect(doc.sourceFileId).toBeNull();
    expect(await db.select().from(files)).toHaveLength(0);
    const v = await latestVersion(out.id, db);
    expect(v).toMatchObject({ version: 1, reason: "upload" });
    expect(docToText(v!.content)).toContain("Staff Engineer at Acme");
    expect(queued).toHaveBeenCalledWith(out.id, db);
  });

  it("names the document after the file when no title is given", async () => {
    const out = await upload();
    if (!out.ok) throw new Error("upload failed");
    const [doc] = await db.select().from(documents).where(eq(documents.id, out.id));
    expect(doc.title).toBe("jane");
  });

  it("reports the same file twice, and adds it again only when forced", async () => {
    const first = await upload();
    if (!first.ok) throw new Error("upload failed");
    const again = await upload();
    expect(again).toEqual({ ok: false, duplicateOf: { id: first.id, title: "jane" } });
    expect(await db.select().from(documents)).toHaveLength(1);
    expect((await upload({ force: true })).ok).toBe(true);
    expect(await db.select().from(documents)).toHaveLength(2);
  });

  it("files a cover letter the same way, findable by its hash", async () => {
    const out = await upload({ kind: "cover_letter" });
    if (!out.ok) throw new Error("upload failed");
    const [doc] = await db.select().from(documents).where(eq(documents.id, out.id));
    expect(doc.kind).toBe("cover_letter");
    expect(await findBySha(doc.sourceSha256!, db)).toMatchObject({ id: out.id });
  });

  it("rejects what it cannot read, without leaving anything behind", async () => {
    await expect(createFromUpload({ bytes: Buffer.from("hello"), name: "a.txt", mime: "text/plain", kind: "resume" }, { db })).rejects.toThrow(/PDF and DOCX/);
    expect(await db.select().from(documents)).toHaveLength(0);
    expect(await db.select().from(files)).toHaveLength(0);
  });

  it("hashes bytes", () => {
    expect(sha256(Buffer.from("a"))).toBe("ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb");
  });
});
