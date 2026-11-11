import mammoth from "mammoth";
import { detectKind, extractResumeText, MAX_RESUME_BYTES, normalizeText } from "@/lib/resume/extract";
import { htmlToResumeText } from "./convert/html-to-text";
import { markdownToResumeText } from "./convert/markdown-to-text";

export type Extracted = {
  text: string;
  /** Lines the file marked as headings (a DOCX heading style or a Markdown "#"). */
  headings: Set<string>;
  mime: string;
  kind: "pdf" | "docx" | "md";
};

/**
 * Reads an uploaded PDF or DOCX (and Markdown, when `markdown` is on) into text for the library. A DOCX is read through
 * its HTML form, which keeps bullets and heading styles; if that comes out empty the plain text is used. Markdown
 * keeps its "#" headings and list items. Scanned PDFs are refused.
 */
export async function extractForDocument(
  bytes: Buffer,
  name: string,
  mime: string,
  options: { markdown?: boolean } = {},
): Promise<Extracted> {
  if (bytes.length > MAX_RESUME_BYTES) throw new Error("File is larger than 10 MB");
  if (options.markdown && isMarkdown(name, mime)) {
    const { text, headings } = markdownToResumeText(bytes.toString("utf8"));
    const clean = normalizeText(text);
    if (!clean) throw new Error("No text found in that Markdown file.");
    return { text: clean, headings, mime: MARKDOWN, kind: "md" };
  }
  const kind = detectKind(name, mime);
  if (!kind) throw new Error(options.markdown ? "Only PDF, DOCX and Markdown files are supported" : "Only PDF and DOCX files are supported");

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

const MARKDOWN = "text/markdown";

/** Whether a file is Markdown, by extension or type (browsers often send no type for .md). */
export const isMarkdown = (name: string, mime: string) => /\.(md|markdown)$/i.test(name) || /^text\/(x-)?markdown$/i.test(mime);

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
