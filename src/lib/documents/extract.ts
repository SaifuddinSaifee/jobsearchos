import mammoth from "mammoth";
import { detectKind, extractResumeText, MAX_RESUME_BYTES, normalizeText } from "@/lib/resume/extract";
import { htmlToResumeText } from "./convert/html-to-text";

export type Extracted = {
  text: string;
  /** Lines the file marked with a heading style (DOCX only). */
  headings: Set<string>;
  mime: string;
  kind: "pdf" | "docx";
};

/**
 * Reads an uploaded PDF or DOCX into text for the library. A DOCX is read through its HTML form, which keeps bullets
 * and heading styles; if that comes out empty the plain text is used. Scanned PDFs are refused.
 */
export async function extractForDocument(bytes: Buffer, name: string, mime: string): Promise<Extracted> {
  if (bytes.length > MAX_RESUME_BYTES) throw new Error("File is larger than 10 MB");
  const kind = detectKind(name, mime);
  if (!kind) throw new Error("Only PDF and DOCX files are supported");

  if (kind === "docx") {
    try {
      const { value } = await mammoth.convertToHtml({ buffer: bytes });
      const { text, headings } = htmlToResumeText(value);
      const clean = normalizeText(text);
      if (clean) return { text: clean, headings, mime: DOCX, kind };
    } catch {
      // Fall through to the plain text reading below, which reports a clear error if the file is unreadable.
    }
  }
  const plain = await extractResumeText(bytes, name, mime);
  return { text: plain.text, headings: new Set(), mime: plain.mime, kind };
}

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
