import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db as defaultDb, type Db } from "@/lib/db";
import { documents } from "@/lib/db/schema";
import { emptyBullets, newId, paragraph, section, textField, type DocJSON } from "./build";
import { textToDoc } from "./convert/text-to-doc";
import { extractForDocument } from "./extract";
import { enqueueAfterCreate } from "./queue";
import { createDocument, type NewDocument } from "./service";
import type { DocumentKind } from "./types";

// How text and files become library documents: shared by the upload route, the paste and blank actions, and the
// email composer's upload.

/** An email pasted as "Subject: ..." then the body gives the subject its own field. */
export function splitSubject(text: string): { subject: string; body: string } {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const first = lines.findIndex((l) => l.trim() !== "");
  const m = first >= 0 ? lines[first].match(/^\s*subject\s*:\s*(.*)$/i) : null;
  if (!m) return { subject: "", body: text };
  return { subject: m[1].trim(), body: lines.slice(first + 1).join("\n").replace(/^\s*\n/, "") };
}

/** Text as editor content: a resume is read for headings and bullets, anything else is paragraphs and bullets. */
export function contentFromText(kind: DocumentKind, text: string, headings?: ReadonlySet<string>): { content: DocJSON; subject: string } {
  if (kind === "resume") return { content: textToDoc(text, { headings }), subject: "" };
  if (kind === "email") {
    const { subject, body } = splitSubject(text);
    return { content: textToDoc(body, { mode: "letter" }), subject };
  }
  return { content: textToDoc(text, { mode: "letter" }), subject: "" };
}

/** A new, empty document of this kind. A resume starts with a header and an Experience section to type into. */
export function blankContent(kind: DocumentKind): DocJSON {
  if (kind !== "resume") return { type: "doc", content: [paragraph("")] };
  return {
    type: "doc",
    content: [
      {
        type: "header",
        content: [textField("headerName", ""), textField("headerContact", "")],
      },
      section("summary", "Summary", [paragraph("")]),
      section("experience", "Experience", [
        {
          type: "role",
          attrs: { id: newId() },
          content: [textField("roleTitle", ""), textField("roleDates", ""), textField("roleCompany", ""), textField("roleLocation", ""), emptyBullets()],
        },
      ]),
    ],
  };
}

export const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

export async function findBySha(hash: string, db: Db = defaultDb()): Promise<{ id: string; title: string } | null> {
  const [row] = await db
    .select({ id: documents.id, title: documents.title })
    .from(documents)
    .where(and(eq(documents.sourceSha256, hash), isNull(documents.deletedAt)))
    .limit(1);
  return row ?? null;
}

export type Details = Pick<NewDocument, "title" | "jobId" | "targetRole" | "writtenOn" | "jdText" | "jdUrl" | "companyName">;

export type UploadResult = { ok: true; id: string } | { ok: false; duplicateOf: { id: string; title: string } };

/**
 * Reads an uploaded resume or cover letter and files it in the library. The same file twice is reported, not added,
 * unless `force`. Only the content is kept (the file's name, type and hash are recorded, to spot the same upload
 * twice); the file itself is stored only if it later leaves the app as an email attachment.
 */
export async function createFromUpload(
  input: { bytes: Buffer; name: string; mime: string; kind: "resume" | "cover_letter"; force?: boolean } & Partial<Details>,
  deps: { db?: Db } = {},
): Promise<UploadResult> {
  const db = deps.db ?? defaultDb();
  const hash = sha256(input.bytes);
  if (!input.force) {
    const dup = await findBySha(hash, db);
    if (dup) return { ok: false, duplicateOf: dup };
  }

  const extracted = await extractForDocument(input.bytes, input.name, input.mime);
  const { content } = contentFromText(input.kind, extracted.text, extracted.headings);

  const { document } = await createDocument(
    {
      kind: input.kind,
      origin: "uploaded",
      title: input.title?.trim() || input.name.replace(/\.[^.]+$/, ""),
      content,
      jobId: input.jobId ?? null,
      companyName: input.companyName ?? null,
      targetRole: input.targetRole ?? null,
      writtenOn: input.writtenOn ?? null,
      jdText: input.jdText ?? null,
      jdUrl: input.jdUrl ?? null,
      sourceName: input.name,
      sourceMime: extracted.mime,
      sourceSha256: hash,
    },
    db,
  );
  await enqueueAfterCreate(document.id, db);
  return { ok: true, id: document.id };
}
