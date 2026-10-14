import { z } from "zod";

// Safe to import from client code: no server-only modules.

export const FONTS = ["carlito", "arimo", "tinos"] as const;
export const ACCENTS = ["none", "slate", "navy", "teal", "burgundy"] as const;
export const MARGINS = ["narrow", "normal", "wide"] as const;
export const MAX_DENSITY = 8;

/** Page margins in millimetres: half an inch, three quarters, one inch. */
export const MARGIN_MM: Record<(typeof MARGINS)[number], number> = { narrow: 12.7, normal: 19.05, wide: 25.4 };
export const MARGIN_LABELS: Record<(typeof MARGINS)[number], string> = { narrow: "Narrow (0.5 in)", normal: "Normal (0.75 in)", wide: "Wide (1 in)" };

export const PageSettingsSchema = z.object({
  template: z.literal("classic").default("classic"),
  /** A literal, so adding Letter later is a schema change and not a rewrite. */
  paper: z.literal("A4").default("A4"),
  font: z.enum(FONTS).default("carlito"),
  /** 0 is roomy, 8 is the tightest size that still reads well. */
  density: z.number().int().min(0).max(MAX_DENSITY).default(3),
  /** Space around the page. Separate from spacing, so tightening to fit a page never changes it. */
  margins: z.enum(MARGINS).default("narrow"),
  accent: z.enum(ACCENTS).default("none"),
  /**
   * Keep the document to one page. On: the editor shows where page one ends and tightens the spacing, never the text,
   * as you write, and exports warn when it runs over. Off: no limit, no warnings.
   */
  fitOnePage: z.boolean().default(true),
  /** Fine controls. Each one, when set, wins over the value the density step gives. */
  overrides: z
    .object({
      fontSizePt: z.number().min(8).max(14),
      lineHeight: z.number().min(1).max(2),
      marginMm: z.number().min(6).max(30),
    })
    .partial()
    .default({}),
});

export type PageSettings = z.infer<typeof PageSettingsSchema>;

export const defaultPageSettings = (): PageSettings => PageSettingsSchema.parse({});

/** Tolerant read for stored JSON: anything unreadable falls back to the defaults. */
export function parsePageSettings(raw: unknown): PageSettings {
  const parsed = PageSettingsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : defaultPageSettings();
}

export type DensityStep = {
  fontSizePt: number;
  lineHeight: number;
  /** Space above a section title, in points. */
  sectionGapPt: number;
  /** Space between entries (roles, projects), in points. */
  itemGapPt: number;
};

export const DENSITY_STEPS: readonly DensityStep[] = [
  { fontSizePt: 11, lineHeight: 1.34, sectionGapPt: 12, itemGapPt: 7 },
  { fontSizePt: 10.8, lineHeight: 1.31, sectionGapPt: 11, itemGapPt: 6.5 },
  { fontSizePt: 10.6, lineHeight: 1.28, sectionGapPt: 10, itemGapPt: 6 },
  { fontSizePt: 10.4, lineHeight: 1.26, sectionGapPt: 9, itemGapPt: 5.5 },
  { fontSizePt: 10.2, lineHeight: 1.24, sectionGapPt: 8, itemGapPt: 5 },
  { fontSizePt: 10, lineHeight: 1.22, sectionGapPt: 7, itemGapPt: 4.5 },
  { fontSizePt: 9.8, lineHeight: 1.2, sectionGapPt: 6, itemGapPt: 4 },
  { fontSizePt: 9.6, lineHeight: 1.18, sectionGapPt: 5, itemGapPt: 3.5 },
  { fontSizePt: 9.5, lineHeight: 1.15, sectionGapPt: 4, itemGapPt: 3 },
];

/** The numbers the layout actually uses: the density step and the margins, with any fine controls laid on top. */
export function resolveMetrics(s: PageSettings): DensityStep & { marginMm: number } {
  const step = DENSITY_STEPS[Math.min(Math.max(s.density, 0), MAX_DENSITY)];
  return {
    ...step,
    fontSizePt: s.overrides.fontSizePt ?? step.fontSizePt,
    lineHeight: s.overrides.lineHeight ?? step.lineHeight,
    marginMm: s.overrides.marginMm ?? MARGIN_MM[s.margins],
  };
}

export const FONT_STACKS: Record<(typeof FONTS)[number], { label: string; family: string; docx: string }> = {
  carlito: { label: "Calibri style", family: '"Carlito", Calibri, "Helvetica Neue", Arial, sans-serif', docx: "Calibri" },
  arimo: { label: "Arial style", family: '"Arimo", Arial, "Helvetica Neue", sans-serif', docx: "Arial" },
  tinos: { label: "Times style", family: '"Tinos", "Times New Roman", Times, serif', docx: "Times New Roman" },
};

export const ACCENT_COLORS: Record<(typeof ACCENTS)[number], string> = {
  none: "#111111",
  slate: "#475569",
  navy: "#1e3a5f",
  teal: "#0f6b6b",
  burgundy: "#7a1f3d",
};

/** A4 in CSS pixels at 96 dpi (the unit the browser lays out in). */
export const A4_MM = { width: 210, height: 297 } as const;
export const MM_TO_PX = 96 / 25.4;
export const A4_PX = { width: A4_MM.width * MM_TO_PX, height: A4_MM.height * MM_TO_PX } as const;

/** CSS custom properties for the page, shared by the editor, the measuring copy and the PDF. */
export function styleVars(s: PageSettings): Record<string, string> {
  const m = resolveMetrics(s);
  return {
    "--rs-font": FONT_STACKS[s.font].family,
    "--rs-font-size": `${m.fontSizePt}pt`,
    "--rs-line-height": String(m.lineHeight),
    "--rs-margin": `${m.marginMm}mm`,
    "--rs-section-gap": `${m.sectionGapPt}pt`,
    "--rs-item-gap": `${m.itemGapPt}pt`,
    "--rs-accent": ACCENT_COLORS[s.accent],
  };
}

/** Height available for content on one page, in CSS pixels. */
export function contentHeightPx(s: PageSettings): number {
  return A4_PX.height - 2 * resolveMetrics(s).marginMm * MM_TO_PX;
}
