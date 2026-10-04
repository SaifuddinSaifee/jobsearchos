import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";

export const MAX_RESUME_BYTES = 10 * 1024 * 1024;

const PDF = "application/pdf";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export function detectKind(name: string, mime: string): "pdf" | "docx" | null {
  const lower = name.toLowerCase();
  if (mime === PDF || lower.endsWith(".pdf")) return "pdf";
  if (mime === DOCX || lower.endsWith(".docx")) return "docx";
  return null;
}

export function normalizeText(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function extractResumeText(
  bytes: Buffer,
  name: string,
  mime: string,
): Promise<{ text: string; mime: string }> {
  if (bytes.length > MAX_RESUME_BYTES) throw new Error("File is larger than 10 MB");
  const kind = detectKind(name, mime);
  if (!kind) throw new Error("Only PDF and DOCX files are supported");

  let text: string;
  if (kind === "pdf") {
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const result = await extractText(pdf, { mergePages: true });
    text = result.text;
  } else {
    text = (await mammoth.extractRawText({ buffer: bytes })).value;
  }

  text = normalizeText(text);
  if (!text) throw new Error("No text found. Scanned PDFs are not supported yet.");
  return { text, mime: kind === "pdf" ? PDF : DOCX };
}
