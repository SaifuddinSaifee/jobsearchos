import {
  bulletList,
  newId,
  paragraph,
  safeHref,
  section,
  textField,
  linkMark,
  inline,
  type DocJSON,
  type IdGen,
} from "../build";
import type { SectionKind } from "../nodes";
import { CONTACT_SEP } from "./profile-to-doc";

// The fallback when a resume could not be structured: headings and bullets recovered from plain text by rules.
// Bullet characters are written as escapes so no symbol characters appear in the source.
const BULLET = /^\s*([•●▪■◦·‣⁃*\-–—])\s+(\S.*)$/;

const HEADINGS: [RegExp, SectionKind][] = [
  [/^(professional )?summary$|^profile$|^objective$|^about( me)?$/i, "summary"],
  [/^((professional|work|relevant) )?experience$|^employment( history)?$|^work history$/i, "experience"],
  [/^(personal |selected |side )?projects?$/i, "projects"],
  [/^(technical |key )?skills?$|^core competencies$|^technologies$/i, "skills"],
  [/^education( and training)?$|^academic background$/i, "education"],
  [/^(certifications?|licenses?( and certifications?)?)$/i, "certifications"],
  [/^(achievements?|awards?( and honors)?|honors)$/i, "achievements"],
  [/^(publications|languages|interests|volunteer(ing)?( experience)?)$/i, "custom"],
];

const clean = (s: string) => s.replace(/:\s*$/, "").trim();

function headingKind(line: string, marked?: ReadonlySet<string>): SectionKind | null {
  const t = clean(line);
  if (!t) return null;
  for (const [re, kind] of HEADINGS) if (re.test(t)) return kind;
  // A line the source file itself marked as a heading (a Word "Heading" style) is one, whatever it says.
  if (marked?.has(line.trim())) return "custom";
  const letters = t.replace(/[^A-Za-z]/g, "");
  const allCaps = letters.length >= 3 && t === t.toUpperCase() && t.length <= 40 && !/[.@]/.test(t);
  return allCaps ? "custom" : null;
}

const titleCase = (s: string) => (s === s.toUpperCase() ? s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()) : s);

const isContactLine = (s: string) => /@|https?:\/\/|www\.|linkedin\.|github\.|^[+()\d][\d\s().+-]{6,}/i.test(s);

type Item = { kind: "text"; text: string } | { kind: "bullet"; text: string } | { kind: "gap" };

/**
 * Lines to items: bullets, paragraphs and gaps. A line continues the one before it when it starts in lower case, or
 * is indented under a bullet (pasted text keeps its indentation; text read from a file does not).
 */
function itemsOf(lines: string[]): Item[] {
  const out: Item[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      if (out.length && out[out.length - 1].kind !== "gap") out.push({ kind: "gap" });
      continue;
    }
    const b = line.match(BULLET);
    const prev = out[out.length - 1];
    if (b) out.push({ kind: "bullet", text: b[2].trim() });
    else if (prev && prev.kind !== "gap" && (/^[a-z(]/.test(line) || (prev.kind === "bullet" && /^\s+\S/.test(raw)))) prev.text = `${prev.text} ${line}`;
    else out.push({ kind: "text", text: line });
  }
  return out;
}

function blocksOf(items: Item[], id: IdGen): DocJSON[] {
  const blocks: DocJSON[] = [];
  let run: string[] = [];
  const flush = () => {
    const list = bulletList(run, id);
    if (list) blocks.push(list);
    run = [];
  };
  for (const item of items) {
    if (item.kind === "bullet") run.push(item.text);
    else {
      flush();
      if (item.kind === "text") blocks.push(paragraph(item.text));
    }
  }
  flush();
  return blocks;
}

/**
 * Plain text to an editor document. `letter` mode (cover letters, emails) only makes paragraphs and bullets.
 * `resume` mode also recovers the name, contact line, section headings and bullets.
 */
export function textToDoc(text: string, opts: { mode?: "resume" | "letter"; id?: IdGen; headings?: ReadonlySet<string> } = {}): DocJSON {
  const id = opts.id ?? newId;
  const lines = text.replace(/\r\n?/g, "\n").split("\n");

  if (opts.mode === "letter") return { type: "doc", content: blocksOf(itemsOf(lines), id) };

  let i = 0;
  while (i < lines.length && !lines[i].trim()) i++;
  const nameLine = i < lines.length && !BULLET.test(lines[i]) && lines[i].trim().length <= 60 && !isContactLine(lines[i]) ? lines[i].trim() : "";
  if (nameLine) i++;

  // Everything before the first heading: contact pieces, maybe a headline, anything else stays as paragraphs.
  const head: string[] = [];
  while (i < lines.length && headingKind(lines[i], opts.headings) === null) head.push(lines[i++]);
  const contactPieces: string[] = [];
  const rest: string[] = [];
  let headline = "";
  for (const raw of head) {
    const line = raw.trim();
    if (!line) continue;
    if (isContactLine(line) && line.length <= 160) contactPieces.push(...line.split(/\s*[|•·]\s*/).map((s) => s.trim()).filter(Boolean));
    else if (!headline && rest.length === 0 && line.length <= 100) headline = line;
    else rest.push(line);
  }

  const content: DocJSON[] = [];
  const contact: DocJSON[] = contactPieces.flatMap((piece, n) => {
    const href = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(piece) || /^(https?:\/\/|www\.)/i.test(piece) ? safeHref(piece) : null;
    return [...(n > 0 ? inline(CONTACT_SEP) : []), ...inline(piece, href ? [linkMark(href)] : undefined)];
  });
  if (nameLine || contact.length > 0 || headline) {
    content.push({
      type: "header",
      content: [
        textField("headerName", nameLine),
        ...(headline ? [textField("headerHeadline", headline)] : []),
        { type: "headerContact", ...(contact.length ? { content: contact } : {}) },
      ],
    });
  }
  content.push(...blocksOf(itemsOf(rest), id));

  while (i < lines.length) {
    const heading = lines[i];
    const kind = headingKind(heading, opts.headings) ?? "custom";
    i++;
    const body: string[] = [];
    while (i < lines.length && headingKind(lines[i], opts.headings) === null) body.push(lines[i++]);
    content.push(section(kind, titleCase(clean(heading)), blocksOf(itemsOf(body), id), id));
  }

  return { type: "doc", content };
}
