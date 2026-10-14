import { contentHeightPx, MAX_DENSITY, resolveMetrics, type PageSettings } from "./page-settings";

// Safe to import from client code. All lengths are CSS pixels.

/** Room for the content on one page. */
export function pageLimitPx(settings: PageSettings): number {
  return contentHeightPx(settings);
}

/** Height of one line of text at these settings. */
export function linePx(settings: PageSettings): number {
  const m = resolveMetrics(settings);
  return ((m.fontSizePt * 96) / 72) * m.lineHeight;
}

/** How many whole lines the content runs past one page (0 when it fits). */
export function linesOver(contentPx: number, settings: PageSettings): number {
  const over = contentPx - pageLimitPx(settings);
  return over > 0.5 ? Math.ceil(over / linePx(settings)) : 0;
}

/** Pages the content needs, at least one. */
export function pagesNeeded(contentPx: number, settings: PageSettings): number {
  return Math.max(1, Math.ceil((contentPx - 0.5) / contentHeightPx(settings)));
}

export type FitOutcome = {
  settings: PageSettings;
  fits: boolean;
  /** Pixels over one page at the settings chosen; 0 when it fits. */
  overPx: number;
};

/** The fine controls that spacing does not decide: a margin typed in by hand stays. */
const keepMargin = (s: PageSettings): PageSettings["overrides"] => (s.overrides.marginMm === undefined ? {} : { marginMm: s.overrides.marginMm });

/**
 * Finds the loosest density, from the current one to the tightest, at which the content fits on one page. `measure`
 * returns the height of the content laid out with the given settings. It never loosens the layout and never touches
 * the text: if even the tightest density does not fit, it says so and leaves the choice to the user. The fine controls
 * for font size and line spacing are cleared, because they would override what each density step sets; a margin set by
 * hand is kept.
 */
export function fitToPage(settings: PageSettings, measure: (candidate: PageSettings) => number): FitOutcome {
  let last: FitOutcome | null = null;
  for (let density = settings.density; density <= MAX_DENSITY; density++) {
    const candidate: PageSettings = { ...settings, density, overrides: keepMargin(settings) };
    const overPx = Math.max(0, measure(candidate) - pageLimitPx(candidate));
    last = { settings: candidate, fits: overPx <= 0.5, overPx };
    if (last.fits) return last;
  }
  return last ?? { settings, fits: false, overPx: 0 };
}
