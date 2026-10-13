import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  LevelFormat,
  LineRuleType,
  Packer,
  Paragraph,
  TabStopType,
  TextRun,
  UnderlineType,
  type ParagraphChild,
} from "docx";
import type { DocJSON } from "../build";
import { ACCENT_COLORS, FONT_STACKS, resolveMetrics, type PageSettings } from "../page-settings";
import { children, firstOf, plainText } from "../read";

const TWIPS_PER_MM = 1440 / 25.4;
const A4_TWIPS = { width: 11906, height: 16838 };
/** Word counts text size in half points, and spacing in twentieths of a point. */
const half = (pt: number) => Math.round(pt * 2);
const twip = (pt: number) => Math.round(pt * 20);

/** The bullet character, built from its code point so no symbol character sits in the source. */
const BULLET = String.fromCharCode(0x2022);
/** Second level uses an en dash. */
const SUB_BULLET = String.fromCharCode(0x2013);
const LINK_COLOR = "0563C1";

type Style = { bold?: boolean; italics?: boolean; size?: number; color?: string };

/**
 * A document as a Word file: A4, the same fonts, sizes and spacing as the PDF (taken from the page settings), real
 * Word bullets and tab-aligned dates. The PDF is the exact layout; Word lays text out a little differently, so line
 * breaks may land in other places.
 */
export async function renderDocx(content: DocJSON, settings: PageSettings, opts: { title?: string } = {}): Promise<Buffer> {
  const m = resolveMetrics(settings);
  const accent = ACCENT_COLORS[settings.accent].slice(1);
  const margin = Math.round(m.marginMm * TWIPS_PER_MM);
  const textWidth = A4_TWIPS.width - 2 * margin;
  const base = m.fontSizePt;
  const line = { line: Math.round(m.lineHeight * 240), lineRule: LineRuleType.AUTO };
  const right = [{ type: TabStopType.RIGHT, position: textWidth }];

  /** The text of one block as runs, keeping bold, italic, underline and links. */
  function runs(block: DocJSON | undefined, style: Style = {}): ParagraphChild[] {
    const out: ParagraphChild[] = [];
    for (const n of children(block)) {
      if (n.type !== "text" || !n.text) continue;
      const marks = n.marks ?? [];
      const href = marks.find((x) => x.type === "link")?.attrs?.href;
      const underline = marks.some((x) => x.type === "underline") || typeof href === "string";
      const run = (text: string) =>
        new TextRun({
          text,
          bold: style.bold || marks.some((x) => x.type === "bold"),
          italics: style.italics || marks.some((x) => x.type === "italic"),
          underline: underline ? { type: UnderlineType.SINGLE } : undefined,
          size: style.size,
          color: typeof href === "string" ? LINK_COLOR : style.color,
        });
      out.push(typeof href === "string" ? new ExternalHyperlink({ link: href, children: [run(n.text)] }) : run(n.text));
    }
    return out;
  }

  const field = (n: DocJSON, type: string, style?: Style) => runs(firstOf(n, type), style);
  const isEmpty = (n: DocJSON, type: string) => plainText(firstOf(n, type)).trim() === "";

  function bullets(list: DocJSON | undefined, level: number, out: Paragraph[]) {
    for (const b of children(list)) {
      const p = children(b).find((c) => c.type === "paragraph");
      out.push(new Paragraph({ children: runs(p), numbering: { reference: "rs-bullets", level }, spacing: line }));
      bullets(children(b).find((c) => c.type === "bulletList"), level + 1, out);
    }
  }

  /** A line with something on the left and something right-aligned (a title and its dates). */
  function split(left: ParagraphChild[], rightSide: ParagraphChild[], before: number, extra: { keepNext?: boolean } = {}) {
    return new Paragraph({
      children: rightSide.length ? [...left, new TextRun({ text: "\t" }), ...rightSide] : left,
      tabStops: right,
      spacing: { ...line, before: twip(before) },
      keepNext: extra.keepNext,
    });
  }

  const out: Paragraph[] = [];

  function item(n: DocJSON, first: boolean) {
    const before = first ? 0 : m.itemGapPt;
    switch (n.type) {
      case "role": {
        // One line: "Title, Company, Location" on the left and the dates on the right.
        const left: ParagraphChild[] = [...field(n, "roleTitle", { bold: true })];
        if (!isEmpty(n, "roleCompany")) left.push(new TextRun({ text: left.length ? ", " : "" }), ...field(n, "roleCompany", { italics: true }));
        if (!isEmpty(n, "roleLocation")) left.push(new TextRun({ text: left.length ? ", " : "" }), ...field(n, "roleLocation"));
        out.push(split(left, field(n, "roleDates"), before, { keepNext: true }));
        bullets(children(n).find((c) => c.type === "bulletList"), 0, out);
        break;
      }
      case "education": {
        out.push(split(field(n, "eduInstitution", { bold: true }), field(n, "eduDates"), before, { keepNext: true }));
        for (const f of ["eduDegree", "eduDetails"]) if (!isEmpty(n, f)) out.push(split(field(n, f), [], 0));
        bullets(children(n).find((c) => c.type === "bulletList"), 0, out);
        break;
      }
      case "project": {
        // One line: "Name - what it is".
        const head: ParagraphChild[] = [...field(n, "projectName", { bold: true })];
        if (!isEmpty(n, "projectDetail")) head.push(new TextRun({ text: head.length ? " - " : "" }), ...field(n, "projectDetail"));
        out.push(split(head, [], before, { keepNext: true }));
        if (!isEmpty(n, "projectTech")) out.push(split(field(n, "projectTech", { italics: true }), [], 0));
        bullets(children(n).find((c) => c.type === "bulletList"), 0, out);
        break;
      }
      case "skillsLine":
        out.push(
          new Paragraph({
            children: [...field(n, "skillsLabel", { bold: true }), new TextRun({ text: ": " }), ...field(n, "skillsItems")],
            spacing: { ...line, before: first ? 0 : twip(m.itemGapPt * 0.35) },
          }),
        );
        break;
      case "bulletList":
        bullets(n, 0, out);
        break;
      case "paragraph":
        out.push(new Paragraph({ children: runs(n), spacing: { ...line, before: first ? 0 : twip(m.itemGapPt * 0.6) } }));
        break;
    }
  }

  function block(n: DocJSON, index: number) {
    switch (n.type) {
      case "header": {
        out.push(new Paragraph({ children: field(n, "headerName", { bold: true, size: half(base * 2), color: accent }), alignment: AlignmentType.CENTER, spacing: { line: Math.round(1.15 * 240), lineRule: LineRuleType.AUTO } }));
        if (!isEmpty(n, "headerHeadline")) out.push(new Paragraph({ children: field(n, "headerHeadline", { size: half(base * 1.05) }), alignment: AlignmentType.CENTER, spacing: line }));
        if (!isEmpty(n, "headerContact")) out.push(new Paragraph({ children: field(n, "headerContact", { size: half(base * 0.95) }), alignment: AlignmentType.CENTER, spacing: line }));
        break;
      }
      case "section": {
        const title = plainText(firstOf(n, "sectionTitle")).trim().toUpperCase();
        out.push(
          new Paragraph({
            children: [new TextRun({ text: title, bold: true, color: accent, characterSpacing: 12 })],
            border: { bottom: { style: BorderStyle.SINGLE, size: 6, space: 1, color: accent } },
            spacing: { ...line, before: twip(m.sectionGapPt), after: twip(m.itemGapPt * 0.8) },
            keepNext: true,
          }),
        );
        children(n)
          .filter((c) => c.type !== "sectionTitle")
          .forEach((c, i) => item(c, i === 0));
        break;
      }
      case "bulletList":
        bullets(n, 0, out);
        break;
      case "divider":
        out.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 4, space: 1, color: "999999" } }, spacing: { before: twip(m.itemGapPt), after: twip(m.itemGapPt) } }));
        break;
      case "paragraph":
        // In a letter, paragraphs are spaced apart; in a resume a loose paragraph sits close to what is above it.
        out.push(new Paragraph({ children: runs(n), spacing: { ...line, before: index === 0 ? 0 : twip(base * 0.85) } }));
        break;
    }
  }

  children(content).forEach(block);

  const indent = (level: number) => ({ left: Math.round(0.25 * 1440) + level * 360, hanging: 220 });
  const doc = new Document({
    title: opts.title,
    creator: "Job Search OS",
    styles: { default: { document: { run: { font: FONT_STACKS[settings.font].docx, size: half(base) } } } },
    numbering: {
      config: [
        {
          reference: "rs-bullets",
          levels: [
            { level: 0, format: LevelFormat.BULLET, text: BULLET, alignment: AlignmentType.LEFT, style: { paragraph: { indent: indent(0) } } },
            { level: 1, format: LevelFormat.BULLET, text: SUB_BULLET, alignment: AlignmentType.LEFT, style: { paragraph: { indent: indent(1) } } },
            { level: 2, format: LevelFormat.BULLET, text: SUB_BULLET, alignment: AlignmentType.LEFT, style: { paragraph: { indent: indent(2) } } },
          ],
        },
      ],
    },
    sections: [{ properties: { page: { size: A4_TWIPS, margin: { top: margin, bottom: margin, left: margin, right: margin } } }, children: out }],
  });
  return Packer.toBuffer(doc);
}
